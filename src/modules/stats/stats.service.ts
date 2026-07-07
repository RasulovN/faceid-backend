import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, IsNull, Repository } from 'typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Payment } from '../../entities/payment.entity';
import { Subscription } from '../../entities/subscription.entity';
import {
  CompanyStatus,
  EmployeeStatus,
  PaymeState,
  SubscriptionStatus,
  WorkDayStatus,
} from '../../common/enums';
import { addDaysToDateStr, dateStrInTz } from '../../common/utils/tz.util';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ---------- Kompaniya dashboard ----------

  async companyDashboard(companyId: string) {
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    const timezone = company?.timezone || 'Asia/Tashkent';
    const today = dateStrInTz(new Date(), timezone);

    const total = await this.employeeRepository.count({
      where: { companyId, status: EmployeeStatus.ACTIVE, deletedAt: IsNull() },
    });

    // Bugungi statuslar
    const todayRows: { status: WorkDayStatus; count: string }[] = await this.dataSource.query(
      `SELECT wd."status" AS status, COUNT(*) AS count
       FROM work_days wd
       JOIN employees e ON e.id = wd."employeeId"
       WHERE e."companyId" = $1 AND wd."date" = $2
       GROUP BY wd."status"`,
      [companyId, today],
    );
    const byStatus = Object.fromEntries(todayRows.map((r) => [r.status, Number(r.count)]));
    const present =
      (byStatus[WorkDayStatus.PRESENT] ?? 0) + (byStatus[WorkDayStatus.LATE] ?? 0);

    const checkedOutRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM (
         SELECT DISTINCT ON (ae."employeeId") ae."type"
         FROM attendance_events ae
         JOIN employees e ON e.id = ae."employeeId"
         WHERE e."companyId" = $1 AND ae."timestamp"::date = $2::date
         ORDER BY ae."employeeId", ae."timestamp" DESC
       ) t WHERE t."type" = 'CHECK_OUT'`,
      [companyId, today],
    );

    // Haftalik grafik (oxirgi 7 kun)
    const weekStart = addDaysToDateStr(today, -6);
    const weekRows: { date: string; status: WorkDayStatus; count: string }[] =
      await this.dataSource.query(
        `SELECT wd."date"::text AS date, wd."status" AS status, COUNT(*) AS count
         FROM work_days wd
         JOIN employees e ON e.id = wd."employeeId"
         WHERE e."companyId" = $1 AND wd."date" >= $2 AND wd."date" <= $3
         GROUP BY wd."date", wd."status"
         ORDER BY wd."date"`,
        [companyId, weekStart, today],
      );
    const weekChart: { date: string; present: number; late: number; absent: number }[] = [];
    for (let d = weekStart; d <= today; d = addDaysToDateStr(d, 1)) {
      const dayRows = weekRows.filter((r) => r.date === d);
      const count = (s: WorkDayStatus) =>
        Number(dayRows.find((r) => r.status === s)?.count ?? 0);
      weekChart.push({
        date: d,
        present: count(WorkDayStatus.PRESENT) + count(WorkDayStatus.LATE),
        late: count(WorkDayStatus.LATE),
        absent: count(WorkDayStatus.ABSENT),
      });
    }

    // Oxirgi eventlar
    const recentEvents = await this.eventRepository.find({
      where: { employee: { companyId } },
      relations: { employee: true, branch: true },
      order: { timestamp: 'DESC' },
      take: 10,
    });

    // Filiallar bo'yicha bugun kelganlar
    const branches = await this.branchRepository.find({ where: { companyId } });
    const branchRows: { branchId: string; count: string }[] = await this.dataSource.query(
      `SELECT e."branchId" AS "branchId", COUNT(DISTINCT wd."employeeId") AS count
       FROM work_days wd
       JOIN employees e ON e.id = wd."employeeId"
       WHERE e."companyId" = $1 AND wd."date" = $2 AND wd."status" IN ('PRESENT','LATE')
       GROUP BY e."branchId"`,
      [companyId, today],
    );
    const branchCounts = new Map(branchRows.map((r) => [r.branchId, Number(r.count)]));

    return {
      today: {
        total,
        present,
        late: byStatus[WorkDayStatus.LATE] ?? 0,
        absent: Math.max(0, total - present),
        checkedOut: Number(checkedOutRows[0]?.count ?? 0),
      },
      weekChart,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        timestamp: e.timestamp,
        snapshotUrl: e.snapshotUrl,
        employee: e.employee
          ? {
              id: e.employee.id,
              fullName: e.employee.fullName,
              photoUrl: e.employee.photoUrls?.[0] ?? null,
            }
          : null,
        branch: e.branch ? { id: e.branch.id, name: e.branch.name } : null,
      })),
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        presentCount: branchCounts.get(b.id) ?? 0,
      })),
    };
  }

  // ---------- Superadmin dashboard ----------

  async adminDashboard() {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    // MRR — joriy oyda performed to'lovlar summasi (tiyin)
    const mrrRow: { total: string }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
       WHERE state = $1 AND to_char("performTime", 'YYYY-MM') = $2`,
      [PaymeState.PERFORMED, currentMonth],
    );

    const [activeCompanies, totalEmployees] = await Promise.all([
      this.companyRepository.count({ where: { status: CompanyStatus.ACTIVE } }),
      this.employeeRepository.count({ where: { deletedAt: IsNull() } }),
    ]);

    // 7 kun ichida tugaydigan obunalar
    const expiringSoon = await this.subscriptionRepository.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endsAt: Between(now, new Date(now.getTime() + 7 * DAY_MS)),
      },
      relations: { tariff: true },
      order: { endsAt: 'ASC' },
      take: 10,
    });
    const expiringWithCompany = await Promise.all(
      expiringSoon.map(async (s) => {
        const company = await this.companyRepository.findOne({ where: { id: s.companyId } });
        return {
          id: s.id,
          company: company ? { id: company.id, name: company.name } : null,
          tariff: s.tariff ?? null,
          endsAt: s.endsAt,
          daysLeft: Math.max(0, Math.ceil((s.endsAt.getTime() - now.getTime()) / DAY_MS)),
        };
      }),
    );

    // Oxirgi to'lovlar
    const recentPayments = await this.paymentRepository.find({
      where: { state: PaymeState.PERFORMED },
      order: { performTime: 'DESC' },
      take: 10,
    });
    const recentWithCompany = await Promise.all(
      recentPayments.map(async (p) => {
        const company = await this.companyRepository.findOne({ where: { id: p.companyId } });
        return {
          id: p.id,
          amount: p.amount,
          performTime: p.performTime,
          months: p.months,
          company: company ? { id: company.id, name: company.name } : null,
        };
      }),
    );

    // Daromad grafigi (oxirgi 6 oy)
    const revenueRows: { month: string; amount: string }[] = await this.dataSource.query(
      `SELECT to_char("performTime", 'YYYY-MM') AS month, COALESCE(SUM(amount),0) AS amount
       FROM payments
       WHERE state = $1 AND "performTime" >= NOW() - INTERVAL '6 months'
       GROUP BY 1 ORDER BY 1`,
      [PaymeState.PERFORMED],
    );

    // Kompaniyalar o'sishi (oxirgi 6 oy)
    const growthRows: { month: string; count: string }[] = await this.dataSource.query(
      `SELECT to_char("createdAt", 'YYYY-MM') AS month, COUNT(*) AS count
       FROM companies
       WHERE "createdAt" >= NOW() - INTERVAL '6 months'
       GROUP BY 1 ORDER BY 1`,
    );

    return {
      mrr: Number(mrrRow[0]?.total ?? 0),
      activeCompanies,
      totalEmployees,
      expiringSoon: expiringWithCompany,
      recentPayments: recentWithCompany,
      revenueChart: revenueRows.map((r) => ({ month: r.month, amount: Number(r.amount) })),
      companiesGrowth: growthRows.map((r) => ({ month: r.month, count: Number(r.count) })),
    };
  }
}
