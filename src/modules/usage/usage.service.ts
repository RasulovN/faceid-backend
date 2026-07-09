import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  addDays,
  churnRisk,
  CHURN_RISK_WEIGHT,
  dayRange,
  diffDays,
  engagementLevel,
  engagementScore,
  growthPct,
  tashkentToday,
} from './usage-calc';

/** Agregatlar 60s keshda — sahifa tez-tez yangilansa ham DB bezovta bo'lmaydi */
const CACHE_TTL_SECONDS = 60;
const CACHE_PREFIX = 'usage:agg:';
const TZ = 'Asia/Tashkent';

/** Davomat skanlari CTE'si — timestamptz'ni Toshkent kuniga o'girib sanaydi */
const SCANS_CTE = `
  SELECT (ae."timestamp" AT TIME ZONE '${TZ}')::date AS day, e."companyId", COUNT(*)::int AS scans
  FROM "attendance_events" ae
  JOIN "employees" e ON e."id" = ae."employeeId"
  WHERE ae."timestamp" >= ($1::date::timestamp AT TIME ZONE '${TZ}')
    AND ae."timestamp" < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
`;

interface SeriesRow {
  date: string;
  logins: number;
  actions: number;
  scans: number;
  active_users: number;
  active_companies: number;
}

/**
 * Superadmin usage analitikasi: kompaniyalarning tizimdan foydalanish darajasi.
 * Manbalar: usage_daily (panel: requests/logins/actions) + attendance_events
 * (davomat skanlari — kiosk/mobil) + audit_logs (modul kesimi).
 */
@Injectable()
export class UsageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------- Umumiy ko'rinish ----------

  async overview(days: number) {
    return this.cached(`overview:${days}`, async () => {
      const to = tashkentToday();
      const from = addDays(to, -(days - 1));
      const prevTo = addDays(from, -1);
      const prevFrom = addDays(prevTo, -(days - 1));

      const [series, totals, prevTotals, context] = await Promise.all([
        this.rangeSeries(from, to),
        this.rangeTotals(from, to),
        this.rangeTotals(prevFrom, prevTo),
        this.context(),
      ]);

      // Bo'sh kunlar 0 bilan to'ldiriladi — chart uzluksiz bo'lsin
      const byDate = new Map(series.map((r) => [r.date, r]));
      const filled = dayRange(from, to).map(
        (date) =>
          byDate.get(date) ?? {
            date,
            logins: 0,
            actions: 0,
            scans: 0,
            activeUsers: 0,
            activeCompanies: 0,
          },
      );

      return {
        days,
        from,
        to,
        series: filled,
        totals: {
          ...totals,
          prevRequests: prevTotals.requests,
          prevLogins: prevTotals.logins,
          prevActions: prevTotals.actions,
          prevScans: prevTotals.scans,
          prevActiveUsers: prevTotals.activeUsers,
          prevActiveCompanies: prevTotals.activeCompanies,
          requestsGrowthPct: growthPct(totals.requests, prevTotals.requests),
          loginsGrowthPct: growthPct(totals.logins, prevTotals.logins),
          actionsGrowthPct: growthPct(totals.actions, prevTotals.actions),
          scansGrowthPct: growthPct(totals.scans, prevTotals.scans),
          activeUsersGrowthPct: growthPct(totals.activeUsers, prevTotals.activeUsers),
          activeCompaniesGrowthPct: growthPct(totals.activeCompanies, prevTotals.activeCompanies),
        },
        context,
      };
    });
  }

  private async rangeSeries(from: string, to: string) {
    const rows: SeriesRow[] = await this.dataSource.query(
      `
      WITH u AS (
        SELECT "date" AS day, "companyId",
               SUM("logins")::int AS logins, SUM("actions")::int AS actions,
               COUNT(DISTINCT "userId")::int AS active_users
        FROM "usage_daily"
        WHERE "date" BETWEEN $1::date AND $2::date
        GROUP BY 1, 2
      ), s AS (${SCANS_CTE} GROUP BY 1, 2)
      SELECT to_char(COALESCE(u.day, s.day), 'YYYY-MM-DD') AS date,
             COALESCE(SUM(u.logins), 0)::int AS logins,
             COALESCE(SUM(u.actions), 0)::int AS actions,
             COALESCE(SUM(s.scans), 0)::int AS scans,
             COALESCE(SUM(u.active_users), 0)::int AS active_users,
             COUNT(DISTINCT COALESCE(u."companyId", s."companyId"))::int AS active_companies
      FROM u
      FULL OUTER JOIN s ON s.day = u.day AND s."companyId" = u."companyId"
      GROUP BY COALESCE(u.day, s.day)
      ORDER BY 1
      `,
      [from, to],
    );
    return rows.map((r) => ({
      date: r.date,
      logins: Number(r.logins),
      actions: Number(r.actions),
      scans: Number(r.scans),
      activeUsers: Number(r.active_users),
      activeCompanies: Number(r.active_companies),
    }));
  }

  private async rangeTotals(from: string, to: string) {
    const [row]: Array<Record<string, string>> = await this.dataSource.query(
      `
      WITH u AS (
        SELECT "companyId", "userId", "requests", "logins", "actions"
        FROM "usage_daily"
        WHERE "date" BETWEEN $1::date AND $2::date
      ), s AS (${SCANS_CTE} GROUP BY 1, 2)
      SELECT
        (SELECT COALESCE(SUM("requests"), 0) FROM u)::int AS requests,
        (SELECT COALESCE(SUM("logins"), 0) FROM u)::int AS logins,
        (SELECT COALESCE(SUM("actions"), 0) FROM u)::int AS actions,
        (SELECT COALESCE(SUM(scans), 0) FROM s)::int AS scans,
        (SELECT COUNT(DISTINCT "userId") FROM u)::int AS active_users,
        (SELECT COUNT(*) FROM (
          SELECT "companyId" FROM u UNION SELECT "companyId" FROM s
        ) x)::int AS active_companies
      `,
      [from, to],
    );
    return {
      requests: Number(row.requests),
      logins: Number(row.logins),
      actions: Number(row.actions),
      scans: Number(row.scans),
      activeUsers: Number(row.active_users),
      activeCompanies: Number(row.active_companies),
    };
  }

  private async context() {
    const [row]: Array<Record<string, string>> = await this.dataSource.query(
      `
      SELECT
        (SELECT COUNT(*) FROM "companies")::int AS companies_total,
        (SELECT COUNT(*) FROM "users" WHERE "companyId" IS NOT NULL AND "deletedAt" IS NULL)::int AS users_total,
        (SELECT COUNT(*) FROM "employees" WHERE "deletedAt" IS NULL)::int AS employees_total
      `,
    );
    return {
      companiesTotal: Number(row.companies_total),
      usersTotal: Number(row.users_total),
      employeesTotal: Number(row.employees_total),
    };
  }

  // ---------- Kompaniyalar kesimi ----------

  async companies(days: number) {
    return this.cached(`companies:${days}`, async () => {
      const to = tashkentToday();
      const from = addDays(to, -(days - 1));
      const mid = addDays(from, Math.floor((days - 1) / 2));

      const [companies, usage, scans, activity, lastActivity] = await Promise.all([
        this.dataSource.query(
          `
          SELECT c."id", c."name", c."status",
                 to_char(c."createdAt" AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS created_at,
                 (SELECT COUNT(*) FROM "users" u
                   WHERE u."companyId" = c."id" AND u."deletedAt" IS NULL)::int AS total_users,
                 (SELECT COUNT(*) FROM "employees" e
                   WHERE e."companyId" = c."id" AND e."deletedAt" IS NULL)::int AS total_employees
          FROM "companies" c
          `,
        ) as Promise<
          Array<{
            id: string;
            name: string;
            status: string;
            created_at: string;
            total_users: number;
            total_employees: number;
          }>
        >,
        this.dataSource.query(
          `
          SELECT "companyId" AS company_id,
                 COUNT(DISTINCT "userId")::int AS active_users,
                 SUM("logins")::int AS logins,
                 SUM("actions")::int AS actions,
                 SUM("requests")::int AS requests
          FROM "usage_daily"
          WHERE "date" BETWEEN $1::date AND $2::date
          GROUP BY 1
          `,
          [from, to],
        ) as Promise<
          Array<{
            company_id: string;
            active_users: number;
            logins: number;
            actions: number;
            requests: number;
          }>
        >,
        this.dataSource.query(
          `SELECT s."companyId" AS company_id, SUM(s.scans)::int AS scans
           FROM (${SCANS_CTE} GROUP BY 1, 2) s GROUP BY 1`,
          [from, to],
        ) as Promise<Array<{ company_id: string; scans: number }>>,
        // Faol kunlar (panel ∪ skan) va yarim davrlar hajmi (trend uchun)
        this.dataSource.query(
          `
          WITH d AS (
            SELECT "companyId" AS company_id, "date" AS day, SUM("requests")::int AS vol
            FROM "usage_daily"
            WHERE "date" BETWEEN $1::date AND $2::date
            GROUP BY 1, 2
            UNION ALL
            SELECT s."companyId", s.day, s.scans FROM (${SCANS_CTE} GROUP BY 1, 2) s
          )
          SELECT company_id,
                 COUNT(DISTINCT day)::int AS active_days,
                 COALESCE(SUM(vol) FILTER (WHERE day <= $3::date), 0)::int AS first_half,
                 COALESCE(SUM(vol) FILTER (WHERE day > $3::date), 0)::int AS second_half
          FROM d GROUP BY 1
          `,
          [from, to, mid],
        ) as Promise<
          Array<{
            company_id: string;
            active_days: number;
            first_half: number;
            second_half: number;
          }>
        >,
        // Butun tarix bo'yicha oxirgi faollik: rollup ∪ oxirgi login ∪ kiosk lastSeen
        this.dataSource.query(
          `
          SELECT c."id" AS company_id,
                 to_char(GREATEST(
                   (SELECT MAX(d."date") FROM "usage_daily" d WHERE d."companyId" = c."id"),
                   (SELECT MAX((u."lastLoginAt" AT TIME ZONE '${TZ}')::date)
                      FROM "users" u WHERE u."companyId" = c."id"),
                   (SELECT MAX((dv."lastSeenAt" AT TIME ZONE '${TZ}')::date)
                      FROM "devices" dv WHERE dv."companyId" = c."id")
                 ), 'YYYY-MM-DD') AS last_activity
          FROM "companies" c
          `,
        ) as Promise<Array<{ company_id: string; last_activity: string | null }>>,
      ]);

      const usageMap = new Map(usage.map((r) => [r.company_id, r]));
      const scansMap = new Map(scans.map((r) => [r.company_id, r.scans]));
      const activityMap = new Map(activity.map((r) => [r.company_id, r]));
      const lastMap = new Map(lastActivity.map((r) => [r.company_id, r.last_activity]));
      const today = tashkentToday();

      const results = companies.map((c) => {
        const u = usageMap.get(c.id);
        const a = activityMap.get(c.id);
        const companyScans = Number(scansMap.get(c.id) ?? 0);
        const requests = Number(u?.requests ?? 0);
        const activeDays = Number(a?.active_days ?? 0);
        const firstHalf = Number(a?.first_half ?? 0);
        const secondHalf = Number(a?.second_half ?? 0);
        const last = lastMap.get(c.id) ?? null;
        const daysSince = last ? Math.max(0, diffDays(today, last)) : null;
        const trendPct = days < 2 ? 0 : growthPct(secondHalf, firstHalf);
        const score = engagementScore({
          activeDays,
          periodDays: days,
          activeUsers: Number(u?.active_users ?? 0),
          totalUsers: Number(c.total_users),
          volume: requests + companyScans,
        });
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          createdAt: c.created_at,
          totalUsers: Number(c.total_users),
          totalEmployees: Number(c.total_employees),
          activeUsers: Number(u?.active_users ?? 0),
          logins: Number(u?.logins ?? 0),
          actions: Number(u?.actions ?? 0),
          requests,
          scans: companyScans,
          activeDays,
          periodDays: days,
          lastActivity: last,
          daysSinceActivity: daysSince,
          trendPct,
          engagementScore: score,
          engagementLevel: engagementLevel(score),
          churnRisk: churnRisk(daysSince, trendPct, activeDays > 0),
        };
      });

      // Xavfi baland va balli past kompaniyalar birinchi ko'rinsin
      results.sort(
        (a, b) =>
          CHURN_RISK_WEIGHT[b.churnRisk] - CHURN_RISK_WEIGHT[a.churnRisk] ||
          a.engagementScore - b.engagementScore,
      );

      return { days, from, to, results };
    });
  }

  // ---------- Bitta kompaniya (drill-down) ----------

  async companyDetail(companyId: string, days: number) {
    const to = tashkentToday();
    const from = addDays(to, -(days - 1));

    const [company]: Array<{
      id: string;
      name: string;
      status: string;
      created_at: string;
      total_users: number;
      total_employees: number;
    }> = await this.dataSource.query(
      `
      SELECT c."id", c."name", c."status",
             to_char(c."createdAt" AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS created_at,
             (SELECT COUNT(*) FROM "users" u
               WHERE u."companyId" = c."id" AND u."deletedAt" IS NULL)::int AS total_users,
             (SELECT COUNT(*) FROM "employees" e
               WHERE e."companyId" = c."id" AND e."deletedAt" IS NULL)::int AS total_employees
      FROM "companies" c WHERE c."id" = $1
      `,
      [companyId],
    );
    if (!company) throw AppException.notFound('Kompaniya topilmadi');

    const [series, topUsers, modules] = await Promise.all([
      this.dataSource.query(
        `
        WITH u AS (
          SELECT "date" AS day, SUM("logins")::int AS logins, SUM("actions")::int AS actions,
                 COUNT(DISTINCT "userId")::int AS active_users
          FROM "usage_daily"
          WHERE "companyId" = $3 AND "date" BETWEEN $1::date AND $2::date
          GROUP BY 1
        ), s AS (
          SELECT s0.day, SUM(s0.scans)::int AS scans
          FROM (${SCANS_CTE} AND e."companyId" = $3 GROUP BY 1, 2) s0
          GROUP BY 1
        )
        SELECT to_char(COALESCE(u.day, s.day), 'YYYY-MM-DD') AS date,
               COALESCE(u.logins, 0)::int AS logins,
               COALESCE(u.actions, 0)::int AS actions,
               COALESCE(s.scans, 0)::int AS scans,
               COALESCE(u.active_users, 0)::int AS active_users
        FROM u FULL OUTER JOIN s ON s.day = u.day
        ORDER BY 1
        `,
        [from, to, companyId],
      ) as Promise<
        Array<{ date: string; logins: number; actions: number; scans: number; active_users: number }>
      >,
      this.dataSource.query(
        `
        SELECT d."userId" AS user_id, u."username", u."role",
               SUM(d."requests")::int AS requests,
               SUM(d."logins")::int AS logins,
               SUM(d."actions")::int AS actions,
               to_char(MAX(d."date"), 'YYYY-MM-DD') AS last_activity
        FROM "usage_daily" d
        JOIN "users" u ON u."id" = d."userId"
        WHERE d."companyId" = $1 AND d."date" BETWEEN $2::date AND $3::date
        GROUP BY 1, 2, 3
        ORDER BY SUM(d."requests") DESC
        LIMIT 10
        `,
        [companyId, from, to],
      ) as Promise<
        Array<{
          user_id: string;
          username: string;
          role: string;
          requests: number;
          logins: number;
          actions: number;
          last_activity: string;
        }>
      >,
      // Modul kesimi: audit action 'controller.handler' — birinchi bo'lak moduli
      this.dataSource.query(
        `
        SELECT split_part("action", '.', 1) AS module, COUNT(*)::int AS count
        FROM "audit_logs"
        WHERE "companyId" = $1
          AND "createdAt" >= ($2::date::timestamp AT TIME ZONE '${TZ}')
          AND "createdAt" < (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12
        `,
        [companyId, from, to],
      ) as Promise<Array<{ module: string; count: number }>>,
    ]);

    const byDate = new Map(
      series.map((r) => [
        r.date,
        {
          date: r.date,
          logins: Number(r.logins),
          actions: Number(r.actions),
          scans: Number(r.scans),
          activeUsers: Number(r.active_users),
        },
      ]),
    );
    const filled = dayRange(from, to).map(
      (date) => byDate.get(date) ?? { date, logins: 0, actions: 0, scans: 0, activeUsers: 0 },
    );

    return {
      company: {
        id: company.id,
        name: company.name,
        status: company.status,
        createdAt: company.created_at,
        totalUsers: Number(company.total_users),
        totalEmployees: Number(company.total_employees),
      },
      days,
      from,
      to,
      series: filled,
      topUsers: topUsers.map((r) => ({
        userId: r.user_id,
        username: r.username,
        role: r.role,
        requests: Number(r.requests),
        logins: Number(r.logins),
        actions: Number(r.actions),
        lastActivity: r.last_activity,
      })),
      modules: modules.map((r) => ({ module: r.module, count: Number(r.count) })),
    };
  }

  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cacheKey = `${CACHE_PREFIX}${key}`;
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      /* Redis ishlamasa to'g'ridan-to'g'ri hisoblanadi */
    }
    const value = await loader();
    try {
      await this.redis.set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch {
      /* kesh yozilmasa ham javob qaytadi */
    }
    return value;
  }
}
