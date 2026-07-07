import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { StorageSnapshot } from '../../entities/storage-snapshot.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { Paginated } from '../../common/dto/pagination.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  CompanyStorageQueryDto,
  GrowthQueryDto,
  ModelListQueryDto,
  TableListQueryDto,
} from './dto/storage-analytics.dtos';
import {
  CleanupRecommendation,
  CompanyStorageDetail,
  CompanyStorageStat,
  DatabaseStat,
  GrowthAnalytics,
  GrowthPoint,
  ImageStats,
  LogStat,
  ModelStat,
  StorageAlert,
  StorageAlertLevel,
  StorageDashboard,
  TableStat,
} from './interfaces/storage-analytics.interfaces';
import { StorageStatsRepository } from './storage-stats.repository';

const GB = 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Redis kesh: og'ir pg katalog so'rovlari 5 daqiqa keshda turadi */
const CACHE_TTL_SECONDS = 300;
const CACHE_PREFIX = 'storage-analytics:';

/** Jadval nomi → Entity nomi (Model Statistics sahifasi uchun) */
const TABLE_TO_ENTITY: Record<string, string> = {
  users: 'User',
  roles: 'Role',
  companies: 'Company',
  tariffs: 'Tariff',
  branches: 'Branch',
  employees: 'Employee',
  face_embeddings: 'FaceEmbedding',
  work_schedules: 'WorkSchedule',
  attendance_events: 'AttendanceEvent',
  work_days: 'WorkDay',
  penalty_rules: 'PenaltyRule',
  bonus_rules: 'BonusRule',
  overtime_rules: 'OvertimeRule',
  payroll_records: 'PayrollRecord',
  devices: 'Device',
  subscriptions: 'Subscription',
  payments: 'Payment',
  audit_logs: 'AuditLog',
  notifications: 'Notification',
  site_settings: 'SiteSetting',
  storage_snapshots: 'StorageSnapshot',
};

@Injectable()
export class StorageAnalyticsService {
  private readonly logger = new Logger(StorageAnalyticsService.name);

  constructor(
    private readonly statsRepository: StorageStatsRepository,
    @InjectRepository(StorageSnapshot)
    private readonly snapshotRepository: Repository<StorageSnapshot>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  /** Sozlangan yumshoq limit (baytlarda) — alert foizlari shundan hisoblanadi */
  get storageLimitBytes(): number {
    return Number(this.config.get('STORAGE_ALERT_LIMIT_GB') ?? 50) * GB;
  }

  // ---------- Dashboard ----------

  async dashboard(): Promise<StorageDashboard> {
    return this.cached('dashboard', async () => {
      const [db, companies, topTables, growth] = await Promise.all([
        this.statsRepository.databaseStat(this.storageLimitBytes),
        this.statsRepository.companyUsage(),
        this.statsRepository.topTables(20),
        this.growthFromSnapshots(),
      ]);

      const totalCompanyBytes = companies.reduce((sum, c) => sum + c.estimatedBytes, 0);
      const distribution = companies.slice(0, 8).map((c) => ({
        companyName: c.companyName,
        estimatedBytes: c.estimatedBytes,
        percent:
          totalCompanyBytes > 0
            ? Math.round((c.estimatedBytes / totalCompanyBytes) * 1000) / 10
            : 0,
      }));
      const othersBytes = companies.slice(8).reduce((sum, c) => sum + c.estimatedBytes, 0);
      if (othersBytes > 0) {
        distribution.push({
          companyName: 'Boshqalar',
          estimatedBytes: othersBytes,
          percent: Math.round((othersBytes / totalCompanyBytes) * 1000) / 10,
        });
      }

      return {
        databaseSizeBytes: db.databaseSizeBytes,
        storageLimitBytes: db.storageLimitBytes,
        usedPercent: Math.round(db.usedPercent * 10) / 10,
        freeBytes: db.freeBytes,
        totalTables: db.totalTables,
        totalRows: db.totalRows,
        totalCompanies: companies.length,
        avgCompanyBytes: companies.length
          ? Math.round(totalCompanyBytes / companies.length)
          : 0,
        largestCompany: companies[0]
          ? {
              companyId: companies[0].companyId,
              companyName: companies[0].companyName,
              estimatedBytes: companies[0].estimatedBytes,
            }
          : null,
        alert: this.buildAlert(db.databaseSizeBytes),
        topTables,
        companyDistribution: distribution,
        monthlyGrowth: growth.monthly,
        dailyGrowth: growth.daily.slice(-30).map((d) => ({ date: d.date, deltaBytes: d.deltaBytes })),
      };
    });
  }

  // ---------- Database ----------

  async database(): Promise<DatabaseStat> {
    return this.cached('database', () => this.statsRepository.databaseStat(this.storageLimitBytes));
  }

  // ---------- Tables ----------

  async tables(query: TableListQueryDto): Promise<Paginated<TableStat>> {
    const { items, total } = await this.statsRepository.findTables({
      search: query.tableName ?? query.search,
      sortBy: query.sortBy ?? 'totalBytes',
      sortOrder: query.sortOrder,
      limit: query.limit,
      offset: query.skip,
    });
    return Paginated.of(items, total, query);
  }

  // ---------- Models ----------

  async models(query: ModelListQueryDto): Promise<Paginated<ModelStat>> {
    const all = await this.cached('models', async () => {
      const { items } = await this.statsRepository.findTables({ limit: 500, offset: 0 });
      const [todayBase, monthBase, latest] = await Promise.all([
        this.snapshotAtOrBefore(this.startOfToday()),
        this.snapshotAtOrBefore(this.startOfMonth()),
        this.latestSnapshot(),
      ]);
      return items
        .filter((t) => TABLE_TO_ENTITY[t.tableName])
        .map((t): ModelStat => ({
          entityName: TABLE_TO_ENTITY[t.tableName],
          tableName: t.tableName,
          rows: t.liveRows,
          totalBytes: t.totalBytes,
          avgRowBytes: t.liveRows > 0 ? Math.round(t.totalBytes / t.liveRows) : 0,
          growthTodayBytes: this.tableGrowth(t.tableName, todayBase, latest),
          growthMonthBytes: this.tableGrowth(t.tableName, monthBase, latest),
        }));
    });

    // Kesh butun ro'yxatni saqlaydi — filter/sort/pagination xotirada (jadvallar soni kichik)
    let filtered = all;
    const term = (query.entityName ?? query.search)?.toLowerCase();
    if (term) {
      filtered = filtered.filter(
        (m) => m.entityName.toLowerCase().includes(term) || m.tableName.includes(term),
      );
    }
    const sortBy = (query.sortBy ?? 'totalBytes') as keyof ModelStat;
    const dir = query.sortOrder === 'ASC' ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const av = a[sortBy] ?? 0;
      const bv = b[sortBy] ?? 0;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return Paginated.of(filtered.slice(query.skip, query.skip + query.limit), filtered.length, query);
  }

  // ---------- Companies ----------

  async companies(query: CompanyStorageQueryDto): Promise<Paginated<CompanyStorageStat>> {
    const all = await this.cachedCompanyUsage();

    let filtered = all;
    if (query.companyId) filtered = filtered.filter((c) => c.companyId === query.companyId);
    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter((c) => c.companyName.toLowerCase().includes(term));
    }
    const sortBy = (query.sortBy ?? 'estimatedBytes') as keyof CompanyStorageStat;
    const dir = query.sortOrder === 'ASC' ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const av = a[sortBy] ?? 0;
      const bv = b[sortBy] ?? 0;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return Paginated.of(filtered.slice(query.skip, query.skip + query.limit), filtered.length, query);
  }

  async companyDetail(companyId: string): Promise<CompanyStorageDetail> {
    const all = await this.cachedCompanyUsage();
    const company = all.find((c) => c.companyId === companyId);
    if (!company) throw AppException.notFound('Kompaniya topilmadi');

    const [tableBreakdown, topUsers, images, snapshots] = await Promise.all([
      this.statsRepository.companyTableBreakdown(companyId),
      this.statsRepository.companyTopUsers(companyId, 10),
      this.statsRepository.companyImageCounts(companyId),
      this.snapshotRepository.find({
        where: { createdAt: MoreThanOrEqual(new Date(Date.now() - 90 * DAY_MS)) },
        order: { createdAt: 'ASC' },
      }),
    ]);

    // Snapshotlardan kompaniya hajmi dinamikasi (kuniga oxirgi snapshot)
    const byDate = new Map<string, number>();
    for (const snap of snapshots) {
      const entry = snap.companyStorage.find((c) => c.companyId === companyId);
      if (entry) byDate.set(snap.createdAt.toISOString().slice(0, 10), entry.estimatedBytes);
    }
    const timeline = [...byDate.entries()].map(([date, estimatedBytes]) => ({
      date,
      estimatedBytes,
    }));

    return { company, tableBreakdown, timeline, topUsers, images };
  }

  // ---------- Growth ----------

  async growth(query: GrowthQueryDto): Promise<GrowthAnalytics> {
    const analytics = await this.cached('growth', () => this.growthFromSnapshots());
    if (!query.dateFrom && !query.dateTo) return analytics;
    // Sana filtri faqat kunlik seriyaga qo'llanadi
    const from = query.dateFrom ? query.dateFrom.slice(0, 10) : null;
    const to = query.dateTo ? query.dateTo.slice(0, 10) : null;
    return {
      ...analytics,
      daily: analytics.daily.filter(
        (d) => (!from || d.date >= from) && (!to || d.date <= to),
      ),
    };
  }

  // ---------- Images / Files ----------

  async images(): Promise<ImageStats> {
    return this.cached('images', () => this.statsRepository.imageStats());
  }

  /** Fayl kengaytmalari kesimida URL ustunlar tahlili (fayllar MinIO'da) */
  async files(): Promise<{ extensions: { extension: string; count: number }[]; totalFiles: number }> {
    return this.cached('files', async () => {
      const rows: Array<{ extension: string | null; count: string }> = await this.dataSource.query(`
        SELECT lower(substring(url from '\\.([A-Za-z0-9]+)(?:[?#].*)?$')) AS extension, COUNT(*) AS count
        FROM (
          SELECT jsonb_array_elements_text(to_jsonb("photoUrls")) AS url FROM "employees"
          UNION ALL SELECT "sourcePhotoUrl" FROM "face_embeddings" WHERE "sourcePhotoUrl" IS NOT NULL
          UNION ALL SELECT "snapshotUrl" FROM "attendance_events" WHERE "snapshotUrl" IS NOT NULL
          UNION ALL SELECT "avatarUrl" FROM "users" WHERE "avatarUrl" IS NOT NULL
          UNION ALL SELECT "logoUrl" FROM "companies" WHERE "logoUrl" IS NOT NULL
        ) urls
        GROUP BY extension
        ORDER BY count DESC
      `);
      const extensions = rows.map((r) => ({
        extension: r.extension ?? 'nomalum',
        count: Number(r.count),
      }));
      return { extensions, totalFiles: extensions.reduce((sum, e) => sum + e.count, 0) };
    });
  }

  // ---------- Logs ----------

  async logs(): Promise<LogStat[]> {
    return this.cached('logs', async () => {
      const [stats, dayBase, latest] = await Promise.all([
        this.statsRepository.logStats(),
        this.snapshotAtOrBefore(new Date(Date.now() - DAY_MS)),
        this.latestSnapshot(),
      ]);
      return stats.map((s) => ({
        ...s,
        growthDayBytes: this.tableGrowth(s.tableName, dayBase, latest),
      }));
    });
  }

  // ---------- Ranking ----------

  async ranking(): Promise<{
    topCompanies: CompanyStorageStat[];
    topTables: { tableName: string; totalBytes: number }[];
  }> {
    const [companies, topTables] = await Promise.all([
      this.cachedCompanyUsage(),
      this.cached('top-tables', () => this.statsRepository.topTables(20)),
    ]);
    return { topCompanies: companies.slice(0, 10), topTables };
  }

  // ---------- Recommendations / Alerts ----------

  async recommendations(): Promise<{
    items: CleanupRecommendation[];
    totalSavingBytes: number;
  }> {
    return this.cached('recommendations', async () => {
      const items = await this.statsRepository.cleanupRecommendations();
      return {
        items,
        totalSavingBytes: items.reduce((sum, r) => sum + r.estimatedSavingBytes, 0),
      };
    });
  }

  async alerts(): Promise<StorageAlert> {
    const db = await this.database();
    return this.buildAlert(db.databaseSizeBytes);
  }

  /** Foiz bo'yicha alert darajasi: 80% WARNING, 90% CRITICAL, 95% EMERGENCY */
  buildAlert(databaseSizeBytes: number): StorageAlert {
    const limit = this.storageLimitBytes;
    const usedPercent = limit > 0 ? Math.round((databaseSizeBytes / limit) * 1000) / 10 : 0;
    let level: StorageAlertLevel = 'OK';
    let message: string | null = null;
    if (usedPercent >= 95) {
      level = 'EMERGENCY';
      message = `Saqlash hajmi ${usedPercent}% ga yetdi — zudlik bilan joy bo'shatish yoki limitni oshirish kerak!`;
    } else if (usedPercent >= 90) {
      level = 'CRITICAL';
      message = `Saqlash hajmi ${usedPercent}% ga yetdi — tozalash tavsiyalarini ko'rib chiqing.`;
    } else if (usedPercent >= 80) {
      level = 'WARNING';
      message = `Saqlash hajmi ${usedPercent}% ga yetdi — o'sish dinamikasini kuzatib boring.`;
    }
    return { level, usedPercent, databaseSizeBytes, storageLimitBytes: limit, message };
  }

  // ---------- Chartlar ----------

  async chartDatabase(): Promise<{ month: string; totalBytes: number }[]> {
    const growth = await this.cached('growth', () => this.growthFromSnapshots());
    return growth.monthly;
  }

  async chartCompanies(): Promise<{ companyName: string; estimatedBytes: number; percent: number }[]> {
    const dash = await this.dashboard();
    return dash.companyDistribution;
  }

  async chartGrowth(): Promise<{ date: string; deltaBytes: number; totalBytes: number }[]> {
    const growth = await this.cached('growth', () => this.growthFromSnapshots());
    return growth.daily.slice(-60);
  }

  // ---------- Snapshot tahlili (Growth Analytics manbai) ----------

  /**
   * storage_snapshots dan o'sish seriyalari:
   * - daily: har kun oxirgi snapshot, ketma-ket farqlar
   * - monthly: har oy oxirgi snapshot hajmi
   * - points: bugun/kecha/hafta/oy/yil o'sishlari
   */
  private async growthFromSnapshots(): Promise<GrowthAnalytics> {
    const snapshots = await this.snapshotRepository.find({
      where: { createdAt: MoreThanOrEqual(new Date(Date.now() - 366 * DAY_MS)) },
      order: { createdAt: 'ASC' },
      select: ['id', 'databaseSizeBytes', 'createdAt'],
    });

    // Kuniga oxirgi snapshot
    const byDay = new Map<string, number>();
    for (const s of snapshots) byDay.set(s.createdAt.toISOString().slice(0, 10), s.databaseSizeBytes);
    const days = [...byDay.entries()];
    const daily = days.map(([date, totalBytes], i) => ({
      date,
      totalBytes,
      deltaBytes: i > 0 ? totalBytes - days[i - 1][1] : 0,
    }));

    // Oyiga oxirgi snapshot
    const byMonth = new Map<string, number>();
    for (const [date, bytes] of days) byMonth.set(date.slice(0, 7), bytes);
    const monthly = [...byMonth.entries()].map(([month, totalBytes]) => ({ month, totalBytes }));

    const latest = snapshots.at(-1) ?? null;
    const points: GrowthPoint[] = [
      { period: 'today', bytes: this.deltaSince(snapshots, latest, this.startOfToday()) },
      {
        period: 'yesterday',
        bytes: this.deltaBetween(
          snapshots,
          new Date(this.startOfToday().getTime() - DAY_MS),
          this.startOfToday(),
        ),
      },
      { period: 'week', bytes: this.deltaSince(snapshots, latest, new Date(Date.now() - 7 * DAY_MS)) },
      { period: 'month', bytes: this.deltaSince(snapshots, latest, this.startOfMonth()) },
      { period: 'year', bytes: this.deltaSince(snapshots, latest, this.startOfYear()) },
    ];

    return { points, daily, monthly };
  }

  private deltaSince(
    snapshots: StorageSnapshot[],
    latest: StorageSnapshot | null,
    since: Date,
  ): number | null {
    if (!latest) return null;
    const base = this.findAtOrBefore(snapshots, since);
    if (!base) return null;
    return latest.databaseSizeBytes - base.databaseSizeBytes;
  }

  private deltaBetween(snapshots: StorageSnapshot[], from: Date, to: Date): number | null {
    const start = this.findAtOrBefore(snapshots, from);
    const end = this.findAtOrBefore(snapshots, to);
    if (!start || !end) return null;
    return end.databaseSizeBytes - start.databaseSizeBytes;
  }

  private findAtOrBefore(snapshots: StorageSnapshot[], date: Date): StorageSnapshot | null {
    let found: StorageSnapshot | null = null;
    for (const s of snapshots) {
      if (s.createdAt.getTime() <= date.getTime()) found = s;
      else break;
    }
    return found;
  }

  private async snapshotAtOrBefore(date: Date): Promise<StorageSnapshot | null> {
    return this.snapshotRepository
      .createQueryBuilder('s')
      .where('s.createdAt <= :date', { date })
      .orderBy('s.createdAt', 'DESC')
      .limit(1)
      .getOne();
  }

  private async latestSnapshot(): Promise<StorageSnapshot | null> {
    return this.snapshotRepository
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .limit(1)
      .getOne();
  }

  /** Ikki snapshot orasida bitta jadval hajmi farqi */
  private tableGrowth(
    tableName: string,
    base: StorageSnapshot | null,
    latest: StorageSnapshot | null,
  ): number | null {
    if (!base || !latest || base.id === latest.id) return null;
    const baseEntry = base.tableStorage.find((t) => t.tableName === tableName);
    const latestEntry = latest.tableStorage.find((t) => t.tableName === tableName);
    if (!baseEntry || !latestEntry) return null;
    return latestEntry.totalBytes - baseEntry.totalBytes;
  }

  // ---------- Kesh ----------

  private async cachedCompanyUsage(): Promise<CompanyStorageStat[]> {
    return this.cached('companies', () => this.statsRepository.companyUsage());
  }

  /** Redis orqali JSON kesh; Redis ishlamasa to'g'ridan-to'g'ri hisoblanadi */
  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cacheKey = `${CACHE_PREFIX}${key}`;
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as T;
    } catch (err) {
      this.logger.warn(`Redis o'qish xatosi (${cacheKey}): ${(err as Error).message}`);
    }
    const value = await loader();
    try {
      await this.redis.set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Redis yozish xatosi (${cacheKey}): ${(err as Error).message}`);
    }
    return value;
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private startOfMonth(): Date {
    const d = this.startOfToday();
    d.setDate(1);
    return d;
  }

  private startOfYear(): Date {
    const d = this.startOfToday();
    d.setMonth(0, 1);
    return d;
  }
}
