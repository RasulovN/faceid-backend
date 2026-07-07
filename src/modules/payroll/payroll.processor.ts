import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { previousMonth } from '../../common/utils/tz.util';
import { WorkDayService } from '../workdays/workday.service';
import { PayrollService } from './payroll.service';

export const PAYROLL_QUEUE = 'payroll';
export const JOB_WORKDAY_DAILY = 'workday-daily';
export const JOB_PAYROLL_MONTHLY = 'payroll-monthly';

@Processor(PAYROLL_QUEUE)
export class PayrollProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PayrollProcessor.name);

  constructor(
    @InjectQueue(PAYROLL_QUEUE) private readonly queue: Queue,
    private readonly workDayService: WorkDayService,
    private readonly payrollService: PayrollService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  /** Repeatable joblarni ro'yxatdan o'tkazish */
  async onModuleInit(): Promise<void> {
    const tz = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Tashkent';
    try {
      // Har kecha 00:30 — kechagi WorkDay hisoblari
      await this.queue.add(
        JOB_WORKDAY_DAILY,
        {},
        {
          repeat: { pattern: '30 0 * * *', tz },
          jobId: JOB_WORKDAY_DAILY,
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      );
      // Har oy 1-sanasi 02:00 — o'tgan oy uchun payroll DRAFT
      await this.queue.add(
        JOB_PAYROLL_MONTHLY,
        {},
        {
          repeat: { pattern: '0 2 1 * *', tz },
          jobId: JOB_PAYROLL_MONTHLY,
          removeOnComplete: 12,
          removeOnFail: 12,
        },
      );
      this.logger.log('Payroll repeatable joblari ro‘yxatdan o‘tdi (00:30 kunlik, 02:00 oylik)');
    } catch (err) {
      this.logger.error(`Repeatable joblarni ro‘yxatdan o‘tkazishda xato: ${(err as Error).message}`);
    }
  }

  async process(job: Job): Promise<unknown> {
    const tz = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Tashkent';
    switch (job.name) {
      case JOB_WORKDAY_DAILY: {
        const processed = await this.workDayService.recalcAllForDate(
          (job.data as { date?: string }).date,
        );
        this.logger.log(`Kunlik WorkDay hisobi tugadi: ${processed} ta yozuv`);
        return { processed };
      }
      case JOB_PAYROLL_MONTHLY: {
        const month = (job.data as { month?: string }).month ?? previousMonth(tz);
        const generated = await this.payrollService.generateForAllCompanies(month);
        this.logger.log(`Oylik payroll generatsiyasi (${month}): ${generated} ta yozuv`);
        return { month, generated };
      }
      default:
        this.logger.warn(`Noma'lum job: ${job.name}`);
        return null;
    }
  }
}
