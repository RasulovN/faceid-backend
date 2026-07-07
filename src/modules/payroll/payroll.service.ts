import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Raw, Repository } from 'typeorm';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Holiday } from '../../entities/holiday.entity';
import { PayrollAdjustment } from '../../entities/payroll-adjustment.entity';
import { PayrollRecord } from '../../entities/payroll-record.entity';
import { BonusRule, OvertimeRule, PenaltyRule } from '../../entities/rules.entities';
import { WorkDay } from '../../entities/work-day.entity';
import { AppException } from '../../common/exceptions/app.exception';
import {
  EmployeeStatus,
  PayrollAdjustmentType,
  PayrollStatus,
  PenaltyType,
  WorkDayStatus,
} from '../../common/enums';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { WorkDayService } from '../workdays/workday.service';
import {
  calcPayroll,
  defaultPolicy,
  PayrollCalcResult,
  PayrollPenaltyPolicy,
  PayrollPolicy,
} from './payroll-calc';
import { monthBounds, monthScheduleStats } from './month-schedule';

export interface PayrollListQuery extends PaginationDto {
  month?: string;
  branchId?: string;
  status?: PayrollStatus;
}

interface CompanyPayrollContext {
  policy: PayrollPolicy;
  bonusRules: BonusRule[];
  holidaySet: Set<string>;
  monthHolidays: string[];
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    @InjectRepository(PayrollRecord)
    private readonly payrollRepository: Repository<PayrollRecord>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(WorkDay) private readonly workDayRepository: Repository<WorkDay>,
    @InjectRepository(PenaltyRule)
    private readonly penaltyRepository: Repository<PenaltyRule>,
    @InjectRepository(BonusRule) private readonly bonusRepository: Repository<BonusRule>,
    @InjectRepository(OvertimeRule)
    private readonly overtimeRepository: Repository<OvertimeRule>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(Holiday) private readonly holidayRepository: Repository<Holiday>,
    @InjectRepository(PayrollAdjustment)
    private readonly adjustmentRepository: Repository<PayrollAdjustment>,
    private readonly workDayService: WorkDayService,
    private readonly auditService: AuditService,
  ) {}

  // ---------- Siyosat (rules → policy) ----------

  /**
   * Jarima qoidalarini VAQT=PUL siyosatiga aylantirish.
   * Faqat vaqtga asoslangan turlar ishlatiladi; legacy flat turlar (LATE_FIXED,
   * LATE_PER_MINUTE, ABSENT) mavjud bo'lsa ular ham vaqt-asosli gate sifatida
   * o'qiladi (threshold saqlanadi, flat summa e'tiborsiz) — foizsiz, koeffitsiyentsiz.
   */
  private buildPolicy(penaltyRules: PenaltyRule[], overtimeRule: OvertimeRule | null): PayrollPolicy {
    const pick = (...types: PenaltyType[]): PayrollPenaltyPolicy => {
      // Vaqt-asosli tur ustuvor; topilmasa legacy turdan gate olinadi
      for (const type of types) {
        const rule = penaltyRules.find((r) => r.type === type);
        if (rule) {
          return {
            active: rule.isActive,
            thresholdMinutes: rule.thresholdMinutes ?? 0,
            // multiplier faqat *_SALARY turlarida ma'noli; legacy'da 1
            multiplier:
              type === PenaltyType.LATE_SALARY ||
              type === PenaltyType.EARLY_LEAVE_SALARY ||
              type === PenaltyType.ABSENT_SALARY
                ? rule.multiplier || 1
                : 1,
          };
        }
      }
      // Qoida yo'q — standart: faol, chegarasiz, 1x (vaqt qiymati)
      return { active: true, thresholdMinutes: 0, multiplier: 1 };
    };

    return defaultPolicy({
      overtimeActive: overtimeRule?.isActive ?? true,
      weekdayOvertimeMultiplier: overtimeRule?.multiplier ?? 1.5,
      weekendMultiplier: overtimeRule?.weekendMultiplier ?? 2,
      holidayMultiplier: overtimeRule?.holidayMultiplier ?? 2,
      late: pick(PenaltyType.LATE_SALARY, PenaltyType.LATE_PER_MINUTE, PenaltyType.LATE_FIXED),
      earlyLeave: pick(PenaltyType.EARLY_LEAVE_SALARY),
      absent: pick(PenaltyType.ABSENT_SALARY, PenaltyType.ABSENT),
    });
  }

  private async buildContext(companyId: string, month: string): Promise<CompanyPayrollContext> {
    const [penaltyRules, bonusRules, overtimeRule, holidays] = await Promise.all([
      this.penaltyRepository.find({ where: { companyId } }),
      this.bonusRepository.find({ where: { companyId, isActive: true } }),
      this.overtimeRepository.findOne({ where: { companyId } }),
      this.holidayRepository.find({ where: { companyId } }),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    return {
      policy: this.buildPolicy(penaltyRules, overtimeRule),
      bonusRules,
      holidaySet,
      monthHolidays: holidays.map((h) => h.date).filter((d) => d.startsWith(month)),
    };
  }

  /** Bitta xodim uchun oy hisobi (saqlamasdan) */
  private async calcForEmployee(
    employee: Employee,
    month: string,
    ctx: CompanyPayrollContext,
  ): Promise<PayrollCalcResult> {
    const { monthStart, nextMonthStart } = monthBounds(month);
    const [workDays, schedule, adjustments] = await Promise.all([
      this.workDayRepository.find({
        where: {
          employeeId: employee.id,
          date: Raw((alias) => `${alias} >= :monthStart AND ${alias} < :nextMonthStart`, {
            monthStart,
            nextMonthStart,
          }),
        },
        order: { date: 'ASC' },
      }),
      this.workDayService.resolveSchedule(employee),
      this.adjustmentRepository.find({
        where: { employeeId: employee.id, periodMonth: month },
        order: { createdAt: 'ASC' },
      }),
    ]);

    // Oyning to'liq kutilgan ish vaqti — grafikdan; grafik bo'lmasa WorkDay
    // qatorlaridan fallback (eski xatti-harakat bilan moslik).
    let stats = schedule
      ? monthScheduleStats(schedule.days, month, ctx.holidaySet)
      : { expectedMinutes: 0, workingDays: 0 };
    if (stats.workingDays === 0) {
      const scheduledRows = workDays.filter(
        (d) => d.scheduledMinutes > 0 && !ctx.holidaySet.has(d.date),
      );
      stats = {
        expectedMinutes: scheduledRows.reduce((s, d) => s + d.scheduledMinutes, 0),
        workingDays: scheduledRows.length,
      };
    }

    return calcPayroll({
      salaryType: employee.salaryType,
      salaryAmount: employee.salaryAmount,
      monthExpectedMinutes: stats.expectedMinutes,
      monthWorkingDays: stats.workingDays,
      holidayDates: ctx.monthHolidays,
      workDays,
      policy: ctx.policy,
      bonusRules: ctx.bonusRules,
      adjustments: adjustments.map((a) => ({ type: a.type, amount: a.amount, note: a.note })),
    });
  }

  private async activeEmployees(companyId: string): Promise<Employee[]> {
    return this.employeeRepository.find({
      where: {
        companyId,
        deletedAt: IsNull(),
        status: In([EmployeeStatus.ACTIVE, EmployeeStatus.VACATION]),
      },
      order: { lastName: 'ASC' },
    });
  }

  // ---------- Generatsiya ----------

  /** Bitta kompaniya uchun oy bo'yicha DRAFT PayrollRecord'lar */
  async generateForCompany(
    companyId: string,
    month: string,
    generatedByUserId?: string,
  ): Promise<number> {
    const ctx = await this.buildContext(companyId, month);
    const employees = await this.activeEmployees(companyId);

    let generated = 0;
    for (const employee of employees) {
      try {
        const result = await this.calcForEmployee(employee, month, ctx);

        const existing = await this.payrollRepository.findOne({
          where: { employeeId: employee.id, periodMonth: month },
        });
        if (existing && existing.status !== PayrollStatus.DRAFT) {
          // Tasdiqlangan/to'langan yozuvni qayta yozmaymiz
          continue;
        }
        const record =
          existing ??
          this.payrollRepository.create({ employeeId: employee.id, periodMonth: month });
        Object.assign(record, {
          baseSalary: result.baseSalary,
          workedMinutes: result.workedMinutes,
          overtimeAmount: result.overtimeAmount,
          penaltyAmount: result.penaltyAmount,
          bonusAmount: result.bonusAmount,
          totalAmount: result.totalAmount,
          status: PayrollStatus.DRAFT,
          breakdown: result.breakdown,
          generatedAt: new Date(),
        });
        await this.payrollRepository.save(record);
        generated++;
      } catch (err) {
        this.logger.error(
          `Payroll xato (employee=${employee.id}, month=${month}): ${(err as Error).message}`,
        );
      }
    }

    // Audit: kim, qachon, qaysi oy uchun, nechta yozuv hisobladi
    await this.auditService.log({
      userId: generatedByUserId ?? null,
      companyId,
      action: 'payroll.generate',
      entityType: 'PayrollRecord',
      newValue: {
        month,
        generated,
        engine: 'time-v2',
        generatedAt: new Date().toISOString(),
      },
    });

    return generated;
  }

  /** Barcha kompaniyalar uchun (oylik cron) */
  async generateForAllCompanies(month: string): Promise<number> {
    const companies = await this.companyRepository.find();
    let total = 0;
    for (const company of companies) {
      total += await this.generateForCompany(company.id, month);
    }
    return total;
  }

  // ---------- Preview (yopishdan oldin ko'rish) ----------

  /** Oy hisobini SAQLAMASDAN ko'rsatish — payroll yopilishidan oldingi preview */
  async previewForCompany(companyId: string, month: string) {
    const ctx = await this.buildContext(companyId, month);
    const employees = await this.activeEmployees(companyId);

    const rows: Array<Record<string, unknown>> = [];
    const totals = { gross: 0, base: 0, penalty: 0, overtime: 0, bonus: 0, deductions: 0, net: 0 };

    for (const employee of employees) {
      try {
        const r = await this.calcForEmployee(employee, month, ctx);
        const t = (r.breakdown as { totals: Record<string, number> }).totals;
        rows.push({
          employeeId: employee.id,
          fullName: employee.fullName,
          position: employee.position,
          salaryType: employee.salaryType,
          salaryAmount: employee.salaryAmount,
          workedMinutes: r.workedMinutes,
          base: r.baseSalary,
          penalty: r.penaltyAmount,
          overtime: r.overtimeAmount,
          bonus: r.bonusAmount,
          deductions: t.deductions,
          net: r.totalAmount,
          summary: (r.breakdown as { summary: unknown }).summary,
        });
        totals.gross += t.gross;
        totals.base += r.baseSalary;
        totals.penalty += r.penaltyAmount;
        totals.overtime += r.overtimeAmount;
        totals.bonus += r.bonusAmount;
        totals.deductions += t.deductions;
        totals.net += r.totalAmount;
      } catch (err) {
        this.logger.error(
          `Payroll preview xato (employee=${employee.id}): ${(err as Error).message}`,
        );
      }
    }

    return { month, employees: rows, totals, employeeCount: rows.length };
  }

  // ---------- Dashboard summary ----------

  /** Oy bo'yicha kompaniya statistikasi: kartalar + chart ma'lumotlari */
  async summary(companyId: string, month: string, branchId?: string) {
    const { monthStart, nextMonthStart } = monthBounds(month);

    const records = await this.payrollRepository.find({
      where: {
        periodMonth: month,
        employee: { companyId, ...(branchId ? { branchId } : {}) },
      },
      relations: { employee: true },
    });

    const workDays = await this.workDayRepository.find({
      where: {
        employee: { companyId, ...(branchId ? { branchId } : {}), deletedAt: IsNull() },
        date: Raw((alias) => `${alias} >= :monthStart AND ${alias} < :nextMonthStart`, {
          monthStart,
          nextMonthStart,
        }),
      },
    });

    // Kunlik trendlar: davomat / kechikish / overtime
    const byDate = new Map<
      string,
      { present: number; late: number; absent: number; lateMinutes: number; overtimeMinutes: number }
    >();
    for (const d of workDays) {
      const row =
        byDate.get(d.date) ??
        { present: 0, late: 0, absent: 0, lateMinutes: 0, overtimeMinutes: 0 };
      if (d.status === WorkDayStatus.LATE) {
        row.late++;
        row.present++;
      } else if (d.status === WorkDayStatus.PRESENT && d.scheduledMinutes > 0) {
        row.present++;
      } else if (d.status === WorkDayStatus.ABSENT && !d.isExcused) {
        row.absent++;
      }
      row.lateMinutes += d.isExcused ? 0 : d.lateMinutes;
      row.overtimeMinutes += d.overtimeMinutes;
      byDate.set(d.date, row);
    }
    const daily = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    // Kartalar va taqsimot
    const totals = {
      employees: records.length,
      base: records.reduce((s, r) => s + r.baseSalary, 0),
      penalty: records.reduce((s, r) => s + r.penaltyAmount, 0),
      overtime: records.reduce((s, r) => s + r.overtimeAmount, 0),
      bonus: records.reduce((s, r) => s + r.bonusAmount, 0),
      net: records.reduce((s, r) => s + r.totalAmount, 0),
      workedMinutes: records.reduce((s, r) => s + r.workedMinutes, 0),
    };
    const statusCounts = {
      DRAFT: records.filter((r) => r.status === PayrollStatus.DRAFT).length,
      APPROVED: records.filter((r) => r.status === PayrollStatus.APPROVED).length,
      PAID: records.filter((r) => r.status === PayrollStatus.PAID).length,
    };

    // Ish haqi taqsimoti (net bo'yicha gistogramma, so'mda)
    const nets = records.map((r) => r.totalAmount).sort((a, b) => a - b);
    const distribution: Array<{ range: string; count: number }> = [];
    if (nets.length > 0) {
      const max = nets[nets.length - 1];
      const bucketCount = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(nets.length))));
      const bucketSize = Math.max(1, Math.ceil(max / bucketCount / 100_00000) * 100_00000); // 100k so'm qadam
      for (let from = 0; from <= max; from += bucketSize) {
        const to = from + bucketSize;
        distribution.push({
          range: `${Math.round(from / 100_0000) / 100}–${Math.round(to / 100_0000) / 100} mln`,
          count: nets.filter((n) => n >= from && n < to).length,
        });
      }
    }

    return { month, totals, statusCounts, daily, distribution };
  }

  // ---------- Tuzatishlar (avans / qarz / ushlanma / mukofot) ----------

  async listAdjustments(companyId: string, month: string, employeeId?: string) {
    const items = await this.adjustmentRepository.find({
      where: { companyId, periodMonth: month, ...(employeeId ? { employeeId } : {}) },
      relations: { employee: true },
      order: { createdAt: 'DESC' },
    });
    return items.map((a) => ({
      id: a.id,
      employee: a.employee
        ? { id: a.employee.id, fullName: a.employee.fullName }
        : { id: a.employeeId, fullName: '' },
      periodMonth: a.periodMonth,
      type: a.type,
      amount: a.amount,
      note: a.note,
      createdAt: a.createdAt,
    }));
  }

  async createAdjustment(
    companyId: string,
    userId: string,
    dto: {
      employeeId: string;
      periodMonth: string;
      type: PayrollAdjustmentType;
      amount: number;
      note?: string;
    },
  ) {
    const employee = await this.employeeRepository.findOne({
      where: { id: dto.employeeId, companyId, deletedAt: IsNull() },
    });
    if (!employee) throw AppException.notFound('Xodim topilmadi');

    const record = await this.payrollRepository.findOne({
      where: { employeeId: dto.employeeId, periodMonth: dto.periodMonth },
    });
    if (record && record.status !== PayrollStatus.DRAFT) {
      throw AppException.conflict(
        'Bu oy uchun oylik allaqachon tasdiqlangan — tuzatish kiritib bo‘lmaydi',
      );
    }

    const adjustment = await this.adjustmentRepository.save(
      this.adjustmentRepository.create({
        companyId,
        employeeId: dto.employeeId,
        periodMonth: dto.periodMonth,
        type: dto.type,
        amount: dto.amount,
        note: dto.note ?? null,
        createdByUserId: userId,
      }),
    );
    return adjustment;
  }

  async removeAdjustment(companyId: string, id: string) {
    const adjustment = await this.adjustmentRepository.findOne({ where: { id, companyId } });
    if (!adjustment) throw AppException.notFound('Tuzatish topilmadi');
    const record = await this.payrollRepository.findOne({
      where: { employeeId: adjustment.employeeId, periodMonth: adjustment.periodMonth },
    });
    if (record && record.status !== PayrollStatus.DRAFT) {
      throw AppException.conflict('Tasdiqlangan oy tuzatishini o‘chirib bo‘lmaydi');
    }
    await this.adjustmentRepository.remove(adjustment);
    return { ok: true };
  }

  // ---------- CRUD ----------

  async findAll(companyId: string, query: PayrollListQuery, restrictToUserId?: string) {
    let restrictEmployeeId: string | undefined;
    if (restrictToUserId) {
      const own = await this.employeeRepository.findOne({
        where: { userId: restrictToUserId, companyId, deletedAt: IsNull() },
      });
      if (!own) return Paginated.of([], 0, query);
      restrictEmployeeId = own.id;
    }
    const where: FindOptionsWhere<PayrollRecord> = {
      ...(restrictEmployeeId ? { employeeId: restrictEmployeeId } : {}),
      employee: {
        companyId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
    };
    if (query.month) where.periodMonth = query.month;
    if (query.status) where.status = query.status;
    const [items, total] = await this.payrollRepository.findAndCount({
      where,
      relations: { employee: true },
      order: { periodMonth: 'DESC', createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return Paginated.of(
      items.map((r) => this.present(r, false)),
      total,
      query,
    );
  }

  async findOne(companyId: string, id: string) {
    const record = await this.payrollRepository.findOne({
      where: { id, employee: { companyId } },
      relations: { employee: true },
    });
    if (!record) throw AppException.notFound('Oylik yozuvi topilmadi');
    return this.present(record, true);
  }

  async approve(companyId: string, id: string, userId: string) {
    const record = await this.getEntity(companyId, id);
    if (record.status !== PayrollStatus.DRAFT) {
      throw AppException.conflict('Faqat DRAFT holatidagi yozuvni tasdiqlash mumkin');
    }
    record.status = PayrollStatus.APPROVED;
    record.approvedByUserId = userId;
    await this.payrollRepository.save(record);
    return this.findOne(companyId, id);
  }

  async markPaid(companyId: string, id: string) {
    const record = await this.getEntity(companyId, id);
    if (record.status !== PayrollStatus.APPROVED) {
      throw AppException.conflict('Faqat APPROVED holatidagi yozuvni to‘langan deb belgilash mumkin');
    }
    record.status = PayrollStatus.PAID;
    await this.payrollRepository.save(record);
    return this.findOne(companyId, id);
  }

  private async getEntity(companyId: string, id: string): Promise<PayrollRecord> {
    const record = await this.payrollRepository.findOne({
      where: { id, employee: { companyId } },
      relations: { employee: true },
    });
    if (!record) throw AppException.notFound('Oylik yozuvi topilmadi');
    return record;
  }

  private present(record: PayrollRecord, withBreakdown: boolean) {
    return {
      id: record.id,
      employee: record.employee
        ? {
            id: record.employee.id,
            fullName: record.employee.fullName,
            position: record.employee.position,
            tabNumber: record.employee.tabNumber,
            salaryType: record.employee.salaryType,
          }
        : null,
      periodMonth: record.periodMonth,
      baseSalary: record.baseSalary,
      workedMinutes: record.workedMinutes,
      overtimeAmount: record.overtimeAmount,
      penaltyAmount: record.penaltyAmount,
      bonusAmount: record.bonusAmount,
      totalAmount: record.totalAmount,
      status: record.status,
      generatedAt: record.generatedAt,
      ...(withBreakdown ? { breakdown: record.breakdown } : {}),
    };
  }
}
