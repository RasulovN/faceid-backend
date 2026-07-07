import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Raw, Repository } from 'typeorm';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { PayrollRecord } from '../../entities/payroll-record.entity';
import { BonusRule, OvertimeRule, PenaltyRule } from '../../entities/rules.entities';
import { WorkDay } from '../../entities/work-day.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { EmployeeStatus, PayrollStatus } from '../../common/enums';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { calcPayroll } from './payroll-calc';

export interface PayrollListQuery extends PaginationDto {
  month?: string;
  branchId?: string;
  status?: PayrollStatus;
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
  ) {}

  // ---------- Generatsiya ----------

  /** Bitta kompaniya uchun oy bo'yicha DRAFT PayrollRecord'lar */
  async generateForCompany(companyId: string, month: string): Promise<number> {
    const [penaltyRules, bonusRules, overtimeRule] = await Promise.all([
      this.penaltyRepository.find({ where: { companyId, isActive: true } }),
      this.bonusRepository.find({ where: { companyId, isActive: true } }),
      this.overtimeRepository.findOne({ where: { companyId } }),
    ]);
    const employees = await this.employeeRepository.find({
      where: {
        companyId,
        deletedAt: IsNull(),
        status: In([EmployeeStatus.ACTIVE, EmployeeStatus.VACATION]),
      },
    });
    // WorkDay.date — `date` tipi; LIKE (`~~`) unda ishlamaydi. Yarim-ochiq oy oralig'i:
    // [oy boshi, keyingi oy boshi) — oy uzunligiga (fevral va h.k.) bog'liq emas.
    const [year, mon] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const nextYear = mon === 12 ? year + 1 : year;
    const nextMon = mon === 12 ? 1 : mon + 1;
    const nextMonthStart = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`;

    let generated = 0;
    for (const employee of employees) {
      try {
        const workDays = await this.workDayRepository.find({
          where: {
            employeeId: employee.id,
            date: Raw((alias) => `${alias} >= :monthStart AND ${alias} < :nextMonthStart`, {
              monthStart,
              nextMonthStart,
            }),
          },
          order: { date: 'ASC' },
        });
        const result = calcPayroll({
          salaryType: employee.salaryType,
          salaryAmount: employee.salaryAmount,
          workDays,
          penaltyRules,
          bonusRules,
          overtimeMultiplier: overtimeRule?.multiplier ?? 1.5,
          overtimeActive: overtimeRule?.isActive ?? true,
        });

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
