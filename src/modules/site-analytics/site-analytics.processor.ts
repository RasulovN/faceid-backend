import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { SiteAnalyticsService } from './site-analytics.service';

export const SITE_ANALYTICS_QUEUE = 'site-analytics';
export const JOB_VISITS_PRUNE = 'visits-prune';

/**
 * Har kuni 03:40 da 365 kundan eski tashrif yozuvlarini tozalaydi —
 * jadval cheksiz o'smasin (loyihadagi konvensiya: BullMQ repeatable job).
 */
@Processor(SITE_ANALYTICS_QUEUE)
export class SiteAnalyticsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SiteAnalyticsProcessor.name);

  constructor(
    @InjectQueue(SITE_ANALYTICS_QUEUE) private readonly queue: Queue,
    private readonly analyticsService: SiteAnalyticsService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const tz = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Tashkent';
    try {
      await this.queue.add(
        JOB_VISITS_PRUNE,
        {},
        {
          repeat: { pattern: '40 3 * * *', tz },
          jobId: JOB_VISITS_PRUNE,
          removeOnComplete: 14,
          removeOnFail: 14,
        },
      );
      this.logger.log('Site analytics prune job ro‘yxatdan o‘tdi (har kuni 03:40)');
    } catch (err) {
      this.logger.error(`Prune jobni ro‘yxatdan o‘tkazishda xato: ${(err as Error).message}`);
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== JOB_VISITS_PRUNE) return null;
    const pruned = await this.analyticsService.pruneOld();
    this.logger.log(`Sayt analitikasi: ${pruned} ta eski tashrif tozalandi`);
    return { pruned };
  }
}
