import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { tashkentToday } from './usage-calc';

export interface UsageIncrement {
  requests?: number;
  logins?: number;
  actions?: number;
}

interface BufferEntry {
  requests: number;
  logins: number;
  actions: number;
}

const FLUSH_INTERVAL_MS = 15_000;

/**
 * Foydalanish hisoblagichi: har so'rovda DB'ga yozmaslik uchun xotirada
 * (companyId:userId:kun) kesimida yig'ib, 15 soniyada bir additiv upsert qiladi.
 * Statistika asosiy oqimni hech qachon buzmasligi kerak — barcha xatolar yutiladi.
 */
@Injectable()
export class UsageTrackerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(UsageTrackerService.name);
  private readonly buffer = new Map<string, BufferEntry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  track(companyId: string, userId: string, inc: UsageIncrement): void {
    const key = `${companyId}:${userId}:${tashkentToday()}`;
    const entry = this.buffer.get(key) ?? { requests: 0, logins: 0, actions: 0 };
    entry.requests += inc.requests ?? 0;
    entry.logins += inc.logins ?? 0;
    entry.actions += inc.actions ?? 0;
    this.buffer.set(key, entry);
  }

  /** Buferni bo'shatib DB'ga additiv upsert qiladi (test/e2e uchun ham public) */
  async flush(): Promise<void> {
    if (this.buffer.size === 0) return;
    const entries = [...this.buffer.entries()];
    this.buffer.clear();

    for (const [key, inc] of entries) {
      const [companyId, userId, date] = key.split(':');
      try {
        await this.dataSource.query(
          `
          INSERT INTO "usage_daily" ("companyId", "userId", "date", "requests", "logins", "actions")
          VALUES ($1, $2, $3::date, $4, $5, $6)
          ON CONFLICT ("companyId", "userId", "date") DO UPDATE SET
            "requests" = "usage_daily"."requests" + EXCLUDED."requests",
            "logins"   = "usage_daily"."logins"   + EXCLUDED."logins",
            "actions"  = "usage_daily"."actions"  + EXCLUDED."actions"
          `,
          [companyId, userId, date, inc.requests, inc.logins, inc.actions],
        );
      } catch (err) {
        // FK xatosi (o'chirilgan user/kompaniya) yoki DB uzilishi — statistika yo'qoladi, xolos
        this.logger.warn(`usage flush xatosi (${key}): ${(err as Error).message}`);
      }
    }
  }
}
