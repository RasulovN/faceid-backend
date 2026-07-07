import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Between, LessThan, Repository } from 'typeorm';
import { Company } from '../../entities/company.entity';
import { Subscription } from '../../entities/subscription.entity';
import { CompanyStatus, SubscriptionStatus } from '../../common/enums';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

export const BILLING_QUEUE = 'billing';
export const JOB_SUBSCRIPTION_CHECK = 'subscription-check';

const DAY_MS = 24 * 60 * 60 * 1000;

@Processor(BILLING_QUEUE)
export class BillingProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const tz = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Tashkent';
    try {
      // Har kuni 09:00 — eslatmalar va muddat nazorati
      await this.queue.add(
        JOB_SUBSCRIPTION_CHECK,
        {},
        {
          repeat: { pattern: '0 9 * * *', tz },
          jobId: JOB_SUBSCRIPTION_CHECK,
          removeOnComplete: 30,
          removeOnFail: 30,
        },
      );
      this.logger.log('Billing repeatable job ro‘yxatdan o‘tdi (har kuni 09:00)');
    } catch (err) {
      this.logger.error(`Billing jobni ro‘yxatdan o‘tkazishda xato: ${(err as Error).message}`);
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== JOB_SUBSCRIPTION_CHECK) return null;
    const reminded = await this.sendExpiryReminders();
    const { expired, suspended } = await this.enforceExpiry();
    this.logger.log(
      `Obuna nazorati: ${reminded} eslatma, ${expired} EXPIRED, ${suspended} SUSPENDED`,
    );
    return { reminded, expired, suspended };
  }

  /** Tugashiga 3 kun qolgan obunalar uchun email + bildirishnoma */
  private async sendExpiryReminders(): Promise<number> {
    const now = Date.now();
    const from = new Date(now + 2 * DAY_MS);
    const to = new Date(now + 3 * DAY_MS);
    const expiring = await this.subscriptionRepository.find({
      where: { status: SubscriptionStatus.ACTIVE, endsAt: Between(from, to) },
    });
    let sent = 0;
    for (const subscription of expiring) {
      const company = await this.companyRepository.findOne({
        where: { id: subscription.companyId },
      });
      if (!company) continue;
      const daysLeft = Math.max(1, Math.ceil((subscription.endsAt.getTime() - now) / DAY_MS));
      if (company.contactEmail) {
        await this.mailService.sendSubscriptionExpiring(
          company.contactEmail,
          company.name,
          daysLeft,
          subscription.endsAt,
        );
      }
      if (company.ownerId) {
        await this.notificationsService.create(
          company.ownerId,
          'SUBSCRIPTION_EXPIRING',
          'Obuna muddati tugayapti',
          `Obunangiz muddati tugashiga ${daysLeft} kun qoldi. To‘lovni amalga oshiring.`,
          { subscriptionId: subscription.id, endsAt: subscription.endsAt.toISOString() },
        );
      }
      sent++;
    }
    return sent;
  }

  /** Muddati o'tganlar: EXPIRED; grace ham o'tganlar: SUSPENDED */
  private async enforceExpiry(): Promise<{ expired: number; suspended: number }> {
    const graceDays = Number(this.config.get('GRACE_PERIOD_DAYS') ?? 3);
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - graceDays * DAY_MS);

    // Obunalarni EXPIRED qilish
    await this.subscriptionRepository.update(
      { status: SubscriptionStatus.ACTIVE, endsAt: LessThan(now) },
      { status: SubscriptionStatus.EXPIRED },
    );

    // Kompaniyalar: endsAt < now → EXPIRED
    const expiredResult = await this.companyRepository
      .createQueryBuilder()
      .update(Company)
      .set({ status: CompanyStatus.EXPIRED })
      .where('"subscriptionEndsAt" < :now AND status = :active', {
        now,
        active: CompanyStatus.ACTIVE,
      })
      .execute();

    // endsAt + grace < now → SUSPENDED
    const suspendedResult = await this.companyRepository
      .createQueryBuilder()
      .update(Company)
      .set({ status: CompanyStatus.SUSPENDED })
      .where('"subscriptionEndsAt" < :cutoff AND status = :expired', {
        cutoff: graceCutoff,
        expired: CompanyStatus.EXPIRED,
      })
      .execute();

    return {
      expired: expiredResult.affected ?? 0,
      suspended: suspendedResult.affected ?? 0,
    };
  }
}
