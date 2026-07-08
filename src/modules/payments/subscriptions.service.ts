import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Company } from '../../entities/company.entity';
import { Payment } from '../../entities/payment.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Tariff } from '../../entities/tariff.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { PaymeState, SubscriptionStatus } from '../../common/enums';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { computeMonthlyPrice, CustomLimits } from '../tariffs/pricing';
import { TariffLimitsService } from '../tariffs/tariff-limits.service';
import { PAYME_REASON_TIMEOUT, PAYME_REASON_USER_CANCEL } from './payme.service';
import { PaymeConfig } from './payme.config';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AdminSubscriptionFilter = 'active' | 'expiring' | 'expired' | undefined;

/** Superadmin to'lovlar jadvali filtri (frontend kontrakti) */
export type AdminPaymentStateFilter = 'CREATED' | 'PAID' | 'CANCELED' | undefined;

export interface AdminPaymentsQuery extends PaginationDto {
  companyId?: string;
  state?: Exclude<AdminPaymentStateFilter, undefined>;
  from?: string;
  to?: string;
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'FAILED';

/** Payme state (raqam) → frontend uchun tushunarli status */
export function paymentStatusOf(payment: Payment): PaymentStatus {
  if (payment.state === PaymeState.PERFORMED) return 'PAID';
  if (payment.state < 0) {
    return payment.reason === PAYME_REASON_TIMEOUT ? 'FAILED' : 'CANCELLED';
  }
  return 'PENDING';
}

/** Frontend kutadigan to'lov DTO'si (API_CONTRACT.md → Payments) */
function toPaymentDto(payment: Payment) {
  return {
    id: payment.id,
    amount: payment.amount,
    months: payment.months,
    tariff: payment.tariff ? { id: payment.tariff.id, name: payment.tariff.name } : null,
    status: paymentStatusOf(payment),
    provider: payment.provider,
    createdAt: payment.createdAt,
    paidAt: payment.performTime,
  };
}

/** Kompaniya uchun tarif + customLimits bo'yicha effektiv limitlar */
function resolveEffectiveLimits(tariff: Tariff, company: Company): CustomLimits {
  if (tariff.isCustom && company.customLimits) {
    return { ...company.customLimits };
  }
  return {
    branches: tariff.maxBranches,
    employees: tariff.maxEmployees,
    devices: tariff.maxDevices,
  };
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    private readonly tariffLimits: TariffLimitsService,
    private readonly config: ConfigService,
    private readonly paymeConfig: PaymeConfig,
  ) {}

  async current(companyId: string) {
    const subscription = await this.subscriptionRepository.findOne({
      where: { companyId },
      relations: { tariff: true },
      order: { endsAt: 'DESC' },
    });
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    if (!subscription) {
      return {
        subscription: null,
        tariff: null,
        daysLeft: 0,
        isTrial: false,
        effectiveLimits: null,
        monthlyPrice: 0,
      };
    }
    const daysLeft = Math.max(
      0,
      Math.ceil((subscription.endsAt.getTime() - Date.now()) / DAY_MS),
    );
    const tariff = subscription.tariff ?? null;
    const effectiveLimits =
      tariff && company ? resolveEffectiveLimits(tariff, company) : null;
    const monthlyPrice = tariff ? computeMonthlyPrice(tariff, effectiveLimits) : 0;
    return {
      subscription,
      tariff,
      daysLeft,
      isTrial: subscription.isTrial,
      effectiveLimits,
      monthlyPrice,
    };
  }

  /** Payme checkout havolasi: base64(m=...;ac.payment_id=...;a=...;c=...;ct=...) */
  async checkout(companyId: string, tariffId: string, months: number, customLimits?: CustomLimits) {
    if (!this.paymeConfig.isConfigured) {
      throw AppException.validation(
        "To'lov tizimi hali sozlanmagan. Administratorga murojaat qiling.",
      );
    }
    const tariff = await this.tariffRepository.findOne({
      where: { id: tariffId, isActive: true },
    });
    if (!tariff) throw AppException.notFound('Tarif topilmadi yoki faol emas');

    let effectiveCustomLimits: CustomLimits | null = null;
    let amount: number;

    if (tariff.isCustom) {
      if (!customLimits) {
        throw AppException.validation(
          'Custom tarif uchun filial/xodim/qurilma miqdorlari (customLimits) majburiy',
        );
      }
      effectiveCustomLimits = await this.validateCustomLimits(companyId, tariff, customLimits);
      amount = computeMonthlyPrice(tariff, effectiveCustomLimits) * months;
    } else {
      amount = tariff.priceMonthly * months;
    }

    if (effectiveCustomLimits) {
      await this.companyRepository.update(companyId, { customLimits: effectiveCustomLimits });
    }

    // Idempotent checkout: xuddi shu parametrli, hali Payme'ga ulanmagan PENDING
    // to'lov bo'lsa — qayta ishlatamiz (har bosishda yangi orphan yozuv ochilmasin)
    let payment = await this.paymentRepository.findOne({
      where: {
        companyId,
        tariffId,
        months,
        state: PaymeState.PENDING,
        paymeTransactionId: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });
    if (payment && payment.amount !== amount) payment = null; // narx o'zgargan
    if (!payment) {
      payment = await this.paymentRepository.save(
        this.paymentRepository.create({
          companyId,
          tariffId,
          months,
          amount,
          state: PaymeState.PENDING,
        }),
      );
    }

    return { paymentId: payment.id, amount, checkoutUrl: this.buildCheckoutUrl(payment) };
  }

  /** Payme checkout havolasi: base64(m=...;ac.<field>=...;a=...;c=...;ct=...;l=uz) */
  private buildCheckoutUrl(payment: Payment): string {
    const clientUrl = (this.config.get<string>('CLIENT_URL') ?? '').replace(/\/+$/, '');
    const parts = [
      `m=${this.paymeConfig.merchantId}`,
      // Maydon nomi kassa kabinetidagi bilan BIR XIL bo'lishi shart (PAYME_ACCOUNT_FIELD)
      `ac.${this.paymeConfig.accountField}=${payment.id}`,
      `a=${payment.amount}`,
    ];
    // To'lovdan so'ng qaytish (c/ct): lokal sandbox'da har doim; haqiqiy Payme
    // checkout'ida faqat ochiq HTTPS manzil — localhost'ni Payme ocholmaydi.
    const isPublicHttps = clientUrl.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(clientUrl);
    if (this.paymeConfig.isLocalCheckout || isPublicHttps) {
      const callbackUrl = `${clientUrl}/app/subscription?paymentId=${payment.id}`;
      parts.push(`c=${encodeURIComponent(callbackUrl)}`, 'ct=15000');
    }
    parts.push('l=uz');
    return `${this.paymeConfig.checkoutUrl}/${Buffer.from(parts.join(';'), 'utf8').toString('base64')}`;
  }

  /**
   * Qayta to'lash: tarixdagi KUTILAYOTGAN to'lov uchun yangi checkout havolasi.
   * Xuddi shu payment yozuvi ishlatiladi (summa o'sha paytdagi narxda qoladi).
   */
  async retryCheckout(companyId: string, paymentId: string) {
    if (!this.paymeConfig.isConfigured) {
      throw AppException.validation(
        "To'lov tizimi hali sozlanmagan. Administratorga murojaat qiling.",
      );
    }
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId, companyId },
    });
    if (!payment) throw AppException.notFound("To'lov topilmadi");
    if (payment.state === PaymeState.PERFORMED) {
      throw AppException.validation("Bu to'lov allaqachon amalga oshirilgan");
    }
    if (payment.state === PaymeState.CREATED) {
      throw AppException.validation(
        "Bu to'lov bo'yicha Payme'da faol tranzaksiya bor — yakunlanishini kuting",
      );
    }
    if (payment.state < 0) {
      throw AppException.validation(
        "Bekor qilingan to'lovni qayta ochib bo'lmaydi — tarifni tanlab yangi to'lov boshlang",
      );
    }
    return { paymentId: payment.id, amount: payment.amount, checkoutUrl: this.buildCheckoutUrl(payment) };
  }

  /**
   * Foydalanuvchi kutilayotgan to'lovni bekor qiladi. Faqat Payme'ga hali
   * ulanmagan (PENDING, tranzaksiyasiz) to'lovlar bekor qilinadi — shartli
   * UPDATE poyga holatidan himoya qiladi (parallel CreateTransaction bilan).
   */
  async cancelPendingPayment(companyId: string, paymentId: string) {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId, companyId },
      relations: { tariff: true },
    });
    if (!payment) throw AppException.notFound("To'lov topilmadi");
    if (payment.state < 0) return toPaymentDto(payment); // allaqachon bekor — idempotent
    if (payment.state === PaymeState.PERFORMED) {
      throw AppException.validation(
        "To'lov allaqachon amalga oshirilgan — uni bekor qilib bo'lmaydi",
      );
    }
    if (payment.state === PaymeState.CREATED || payment.paymeTransactionId) {
      throw AppException.validation(
        "Bu to'lov bo'yicha Payme'da faol tranzaksiya bor — u yakunlanishi yoki bekor bo'lishini kuting",
      );
    }

    const result = await this.paymentRepository.update(
      {
        id: payment.id,
        companyId,
        state: PaymeState.PENDING,
        paymeTransactionId: IsNull(),
      },
      {
        state: PaymeState.CANCELLED,
        reason: PAYME_REASON_USER_CANCEL,
        cancelTime: new Date(),
      },
    );
    if (!result.affected) {
      // Orada holat o'zgargan (masalan, Payme tranzaksiya ochib qo'ygan)
      throw AppException.validation(
        "To'lov holati o'zgarib qoldi — sahifani yangilab qaytadan urinib ko'ring",
      );
    }
    payment.state = PaymeState.CANCELLED;
    payment.reason = PAYME_REASON_USER_CANCEL;
    payment.cancelTime = new Date();
    return toPaymentDto(payment);
  }

  /** Bitta to'lov holati — to'lovdan qaytgan sahifa poll qilishi uchun */
  async paymentStatus(companyId: string, paymentId: string) {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId, companyId },
      relations: { tariff: true },
    });
    if (!payment) throw AppException.notFound("To'lov topilmadi");
    return toPaymentDto(payment);
  }

  /**
   * Custom tarif konfiguratsiyasini tekshiradi:
   * - har miqdor >= 1;
   * - <= tarif MAKS chegarasi (cap);
   * - >= joriy foydalanish (mavjud filial/xodim/qurilmadan past bo'lmasin).
   */
  private async validateCustomLimits(
    companyId: string,
    tariff: Tariff,
    limits: CustomLimits,
  ): Promise<CustomLimits> {
    const usage = await this.tariffLimits.getUsage(companyId);
    const specs: Array<{
      kind: keyof CustomLimits;
      label: string;
      cap: number;
      used: number;
    }> = [
      { kind: 'branches', label: 'filial', cap: tariff.maxBranches, used: usage.branches },
      { kind: 'employees', label: 'xodim', cap: tariff.maxEmployees, used: usage.employees },
      { kind: 'devices', label: 'qurilma', cap: tariff.maxDevices, used: usage.devices },
    ];

    for (const s of specs) {
      const value = limits[s.kind];
      if (!Number.isInteger(value) || value < 1) {
        throw AppException.validation(`${s.label} miqdori kamida 1 bo'lishi kerak`, {
          kind: s.kind,
        });
      }
      if (value > s.cap) {
        throw AppException.validation(
          `${s.label} miqdori "${tariff.name}" tarifi maksimal chegarasidan (${s.cap}) oshib ketdi`,
          { kind: s.kind, value, cap: s.cap },
        );
      }
      if (value < s.used) {
        throw AppException.validation(
          `${s.label} miqdorini joriy foydalanishdan (${s.used}) past qilib bo'lmaydi`,
          { kind: s.kind, value, used: s.used },
        );
      }
    }

    return {
      branches: limits.branches,
      employees: limits.employees,
      devices: limits.devices,
    };
  }

  async companyPayments(companyId: string, query: PaginationDto) {
    const [items, total] = await this.paymentRepository.findAndCount({
      where: { companyId },
      relations: { tariff: true },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return Paginated.of(items.map(toPaymentDto), total, query);
  }

  /** Superadmin: barcha to'lovlar (kompaniya/holat/sana filtrlari bilan) */
  async allPayments(query: AdminPaymentsQuery) {
    const SORTABLE: Record<string, string> = {
      amount: 'p.amount',
      createdAt: 'p.createdAt',
    };
    const sortColumn = SORTABLE[query.sortBy ?? ''] ?? 'p.createdAt';
    const sortDir: 'ASC' | 'DESC' = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.paymentRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.tariff', 'tariff')
      .orderBy(sortColumn, sortDir);

    if (query.companyId) {
      qb.andWhere('p."companyId" = :companyId', { companyId: query.companyId });
    }
    if (query.state === 'PAID') {
      qb.andWhere('p.state = :performed', { performed: PaymeState.PERFORMED });
    } else if (query.state === 'CANCELED') {
      qb.andWhere('p.state < 0');
    } else if (query.state === 'CREATED') {
      qb.andWhere('p.state IN (:...open)', {
        open: [PaymeState.PENDING, PaymeState.CREATED],
      });
    }
    if (query.from) {
      qb.andWhere('p."createdAt" >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      // `to` sanasining oxirigacha (exclusive keyingi kun)
      const to = new Date(query.to);
      to.setDate(to.getDate() + 1);
      qb.andWhere('p."createdAt" < :to', { to });
    }

    const [items, total] = await qb.skip(query.skip).take(query.limit).getManyAndCount();
    const companyIds = [...new Set(items.map((p) => p.companyId))];
    const companies = companyIds.length
      ? await this.companyRepository.find({ where: { id: In(companyIds) } })
      : [];
    const companyMap = new Map(companies.map((c) => [c.id, { id: c.id, name: c.name }]));
    return Paginated.of(
      items.map((p) => ({
        id: p.id,
        company: companyMap.get(p.companyId) ?? null,
        amount: p.amount,
        months: p.months,
        tariff: p.tariff ? { id: p.tariff.id, name: p.tariff.name } : null,
        paymeTransactionId: p.paymeTransactionId,
        // Superadmin jadvali kontrakti: CREATED (ochiq) / PAID / CANCELED
        state: p.state === PaymeState.PERFORMED ? 'PAID' : p.state < 0 ? 'CANCELED' : 'CREATED',
        status: paymentStatusOf(p),
        createTime: p.paymeTime ? new Date(p.paymeTime) : null,
        performTime: p.performTime,
        cancelTime: p.cancelTime,
        reason: p.reason,
        createdAt: p.createdAt,
      })),
      total,
      query,
    );
  }

  /** Superadmin: barcha obunalar (status=active|expiring|expired) */
  async adminSubscriptions(query: PaginationDto, statusFilter: AdminSubscriptionFilter) {
    // Xavfsiz sort: relation-join + skip/take paginatsiyada TypeORM orderBy ustunini
    // metadata'dan aniqlaydi — shuning uchun qo'lda tirnoqlangan `s."endsAt"` EMAS,
    // `s.endsAt` (alias.property) shakli ishlatiladi (aks holda databaseName TypeError).
    const SORTABLE: Record<string, string> = {
      endsAt: 's.endsAt',
      startsAt: 's.startsAt',
      status: 's.status',
      createdAt: 's.createdAt',
    };
    const sortColumn = SORTABLE[query.sortBy ?? ''] ?? 's.endsAt';
    const sortDir: 'ASC' | 'DESC' = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.subscriptionRepository
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.tariff', 'tariff')
      .orderBy(sortColumn, sortDir);

    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * DAY_MS);
    if (statusFilter === 'active') {
      qb.andWhere('s.status = :st AND s."endsAt" > :now', {
        st: SubscriptionStatus.ACTIVE,
        now,
      });
    } else if (statusFilter === 'expiring') {
      qb.andWhere('s.status = :st AND s."endsAt" > :now AND s."endsAt" <= :soon', {
        st: SubscriptionStatus.ACTIVE,
        now,
        soon: in7days,
      });
    } else if (statusFilter === 'expired') {
      qb.andWhere('(s."endsAt" <= :now OR s.status = :expired)', {
        now,
        expired: SubscriptionStatus.EXPIRED,
      });
    }

    const [items, total] = await qb.skip(query.skip).take(query.limit).getManyAndCount();
    const companyIds = [...new Set(items.map((s) => s.companyId))];
    const companies = companyIds.length
      ? await this.companyRepository.find({ where: { id: In(companyIds) } })
      : [];
    const companyMap = new Map(companies.map((c) => [c.id, { id: c.id, name: c.name }]));

    return Paginated.of(
      items.map((s) => ({
        id: s.id,
        company: companyMap.get(s.companyId) ?? null,
        tariff: s.tariff ?? null,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
        isTrial: s.isTrial,
        daysLeft: Math.max(0, Math.ceil((s.endsAt.getTime() - Date.now()) / DAY_MS)),
      })),
      total,
      query,
    );
  }
}
