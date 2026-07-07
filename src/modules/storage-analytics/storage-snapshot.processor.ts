import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { IsNull, LessThan, Repository } from 'typeorm';
import { StorageSnapshot } from '../../entities/storage-snapshot.entity';
import { User } from '../../entities/user.entity';
import { UserRole } from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { StorageAlertLevel } from './interfaces/storage-analytics.interfaces';
import { StorageAnalyticsService } from './storage-analytics.service';
import { StorageStatsRepository } from './storage-stats.repository';

export const STORAGE_QUEUE = 'storage-analytics';
export const JOB_STORAGE_SNAPSHOT = 'storage-snapshot';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Snapshotlar saqlanish muddati — yillik growth uchun 400 kun yetarli */
const SNAPSHOT_RETENTION_DAYS = 400;
/** Bir xil darajadagi alert 24 soatda faqat 1 marta yuboriladi */
const ALERT_DEDUP_KEY = 'storage-analytics:last-alert-level';
const ALERT_DEDUP_TTL_SECONDS = 24 * 60 * 60;

const ALERT_RANK: Record<StorageAlertLevel, number> = {
  OK: 0,
  WARNING: 1,
  CRITICAL: 2,
  EMERGENCY: 3,
};

/**
 * Har soatda storage snapshot oladi (Growth Analytics manbai) va
 * limit foizi 80/90/95% dan oshsa superadminlarga bildirishnoma yuboradi.
 * Cron @nestjs/schedule emas, loyihadagi konvensiya bo'yicha BullMQ repeatable job.
 */
@Processor(STORAGE_QUEUE)
export class StorageSnapshotProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(StorageSnapshotProcessor.name);

  constructor(
    @InjectQueue(STORAGE_QUEUE) private readonly queue: Queue,
    @InjectRepository(StorageSnapshot)
    private readonly snapshotRepository: Repository<StorageSnapshot>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly statsRepository: StorageStatsRepository,
    private readonly analyticsService: StorageAnalyticsService,
    private readonly notificationsService: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const tz = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Tashkent';
    try {
      // Har soat boshida snapshot
      await this.queue.add(
        JOB_STORAGE_SNAPSHOT,
        {},
        {
          repeat: { pattern: '0 * * * *', tz },
          jobId: JOB_STORAGE_SNAPSHOT,
          removeOnComplete: 48,
          removeOnFail: 48,
        },
      );
      this.logger.log('Storage snapshot repeatable job ro‘yxatdan o‘tdi (har soat)');
    } catch (err) {
      this.logger.error(
        `Storage snapshot jobni ro‘yxatdan o‘tkazishda xato: ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== JOB_STORAGE_SNAPSHOT) return null;
    const snapshot = await this.takeSnapshot();
    const pruned = await this.pruneOldSnapshots();
    await this.checkAlerts(snapshot.databaseSizeBytes);
    this.logger.log(
      `Storage snapshot: ${(snapshot.databaseSizeBytes / 1024 / 1024).toFixed(1)} MB, ` +
        `${snapshot.totalRows} qator, ${snapshot.totalTables} jadval (${pruned} eski snapshot o'chirildi)`,
    );
    return { databaseSizeBytes: snapshot.databaseSizeBytes, pruned };
  }

  /** Joriy holatni storage_snapshots ga yozadi */
  async takeSnapshot(): Promise<StorageSnapshot> {
    const [db, companies, tables] = await Promise.all([
      this.statsRepository.databaseStat(this.analyticsService.storageLimitBytes),
      this.statsRepository.companyUsage(),
      this.statsRepository.findTables({ limit: 500, offset: 0 }),
    ]);

    return this.snapshotRepository.save(
      this.snapshotRepository.create({
        databaseSizeBytes: db.databaseSizeBytes,
        totalRows: db.totalRows,
        totalTables: db.totalTables,
        companyStorage: companies.map((c) => ({
          companyId: c.companyId,
          companyName: c.companyName,
          estimatedBytes: c.estimatedBytes,
          totalRecords: c.totalRecords,
        })),
        tableStorage: tables.items.map((t) => ({
          tableName: t.tableName,
          totalBytes: t.totalBytes,
          rows: t.liveRows,
        })),
      }),
    );
  }

  private async pruneOldSnapshots(): Promise<number> {
    const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * DAY_MS);
    const result = await this.snapshotRepository.delete({ createdAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }

  /**
   * 80% WARNING / 90% CRITICAL / 95% EMERGENCY.
   * Daraja ko'tarilgandagina (yoki 24 soat o'tgach) bildirishnoma yuboriladi —
   * har soatlik takror spam bo'lmasligi uchun Redis'da oxirgi daraja saqlanadi.
   */
  private async checkAlerts(databaseSizeBytes: number): Promise<void> {
    const alert = this.analyticsService.buildAlert(databaseSizeBytes);
    if (alert.level === 'OK' || !alert.message) return;

    try {
      const lastLevel = (await this.redis.get(ALERT_DEDUP_KEY)) as StorageAlertLevel | null;
      if (lastLevel && ALERT_RANK[lastLevel] >= ALERT_RANK[alert.level]) return;
      await this.redis.set(ALERT_DEDUP_KEY, alert.level, 'EX', ALERT_DEDUP_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Alert dedup Redis xatosi: ${(err as Error).message}`);
    }

    const superadmins = await this.userRepository.find({
      where: { role: UserRole.SUPERADMIN, isActive: true, deletedAt: IsNull() },
      select: ['id'],
    });
    for (const admin of superadmins) {
      await this.notificationsService.create(
        admin.id,
        `STORAGE_${alert.level}`,
        `Saqlash hajmi ogohlantirishi (${alert.level})`,
        alert.message,
        {
          usedPercent: alert.usedPercent,
          databaseSizeBytes: alert.databaseSizeBytes,
          storageLimitBytes: alert.storageLimitBytes,
        },
      );
    }
    this.logger.warn(
      `Storage alert ${alert.level}: ${alert.usedPercent}% — ${superadmins.length} superadminga yuborildi`,
    );
  }
}
