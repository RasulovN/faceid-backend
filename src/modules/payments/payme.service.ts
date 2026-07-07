import { timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, MoreThan, Repository } from 'typeorm';
import { Company } from '../../entities/company.entity';
import { Payment } from '../../entities/payment.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Tariff } from '../../entities/tariff.entity';
import { CompanyStatus, PaymeState, SubscriptionStatus } from '../../common/enums';
import { PaymeConfig } from './payme.config';
import { FiscalEntry, PaymentFiscalData } from './payme.types';

// ---------- Payme protokol turlari ----------

export interface PaymeRequest {
  id: number | string | null;
  method: string;
  params: Record<string, any>;
}

export interface PaymeResponse {
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: Record<string, string>; data?: string };
}

// Payme xato kodlari
export const PaymeErrors = {
  INVALID_AUTH: -32504,
  METHOD_NOT_FOUND: -32601,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANNOT_PERFORM: -31008,
  PAYMENT_NOT_FOUND: -31050, // account (-31050..-31099) oralig'i
  ALREADY_PAID: -31051,
  CANCELLED_PAYMENT: -31052,
} as const;

/** Payme bekor qilish sabablari (reason) — biz timeout'da 4 ni qo'yamiz */
export const PAYME_REASON_TIMEOUT = 4;

/** Tranzaksiya yaroqlilik muddati: 12 soat */
export const PAYME_TIMEOUT_MS = 12 * 60 * 60 * 1000;

class PaymeError extends Error {
  constructor(
    public readonly code: number,
    public readonly messages: Record<string, string>,
    public readonly data?: string,
  ) {
    super(messages.en ?? 'Payme error');
  }
}

function msg(uz: string, ru: string, en: string): Record<string, string> {
  return { uz, ru, en };
}

@Injectable()
export class PaymeService {
  private readonly logger = new Logger(PaymeService.name);

  constructor(
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly paymeConfig: PaymeConfig,
  ) {}

  /** Basic auth: login 'Paycom', parol joriy rejim kaliti (timing-safe taqqoslash) */
  verifyAuth(authorizationHeader: string | undefined): boolean {
    if (!authorizationHeader?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(authorizationHeader.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return false;
    const login = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    const merchantKey = this.paymeConfig.merchantKey;
    if (login !== 'Paycom' || merchantKey.length === 0) return false;
    const expected = Buffer.from(merchantKey, 'utf8');
    const actual = Buffer.from(password, 'utf8');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** JSON-RPC kirish nuqtasi */
  async handle(request: PaymeRequest, authorizationHeader: string | undefined): Promise<PaymeResponse> {
    const id = request?.id ?? null;
    if (!this.verifyAuth(authorizationHeader)) {
      return this.error(id, PaymeErrors.INVALID_AUTH, msg(
        'Avtorizatsiya xatosi',
        'Ошибка авторизации',
        'Insufficient privileges',
      ));
    }
    try {
      const params = request.params ?? {};
      switch (request.method) {
        case 'CheckPerformTransaction':
          return { id, result: await this.checkPerformTransaction(params) };
        case 'CreateTransaction':
          return { id, result: await this.createTransaction(params) };
        case 'PerformTransaction':
          return { id, result: await this.performTransaction(params) };
        case 'CancelTransaction':
          return { id, result: await this.cancelTransaction(params) };
        case 'CheckTransaction':
          return { id, result: await this.checkTransaction(params) };
        case 'GetStatement':
          return { id, result: await this.getStatement(params) };
        case 'SetFiscalData':
          return { id, result: await this.setFiscalData(params) };
        default:
          return this.error(id, PaymeErrors.METHOD_NOT_FOUND, msg(
            'Metod topilmadi',
            'Метод не найден',
            'Method not found',
          ));
      }
    } catch (err) {
      if (err instanceof PaymeError) {
        return this.error(id, err.code, err.messages, err.data);
      }
      this.logger.error(`Payme ichki xato: ${(err as Error).stack}`);
      return this.error(id, PaymeErrors.CANNOT_PERFORM, msg(
        'Ichki xato',
        'Внутренняя ошибка',
        'Internal error',
      ));
    }
  }

  // ---------- Metodlar ----------

  async checkPerformTransaction(params: Record<string, any>): Promise<Record<string, unknown>> {
    const payment = await this.findPaymentByAccount(params.account);
    this.assertAmount(payment, params.amount);
    if (payment.state === PaymeState.PERFORMED) {
      throw new PaymeError(PaymeErrors.ALREADY_PAID, msg(
        'To‘lov allaqachon amalga oshirilgan',
        'Платёж уже выполнен',
        'Payment already performed',
      ), 'payment_id');
    }
    if (payment.state < 0) {
      throw new PaymeError(PaymeErrors.CANCELLED_PAYMENT, msg(
        'To‘lov bekor qilingan',
        'Платёж отменён',
        'Payment cancelled',
      ), 'payment_id');
    }
    if (payment.state === PaymeState.CREATED) {
      // Bitta payment uchun bitta faol tranzaksiya
      throw new PaymeError(PaymeErrors.CANNOT_PERFORM, msg(
        'Bu to‘lov uchun faol tranzaksiya mavjud',
        'По этому платежу уже есть активная транзакция',
        'Active transaction already exists for this payment',
      ));
    }
    const detail = await this.buildFiscalDetail(payment);
    return detail ? { allow: true, detail } : { allow: true };
  }

  async createTransaction(params: Record<string, any>): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await this.findPaymentByAccount(params.account, manager, true);
      this.assertAmount(payment, params.amount);
      const repo = manager.getRepository(Payment);

      // Xuddi shu tranzaksiya qayta yuborilgan (retry) — idempotent javob
      if (payment.paymeTransactionId === String(params.id)) {
        if (payment.state !== PaymeState.CREATED) {
          throw new PaymeError(PaymeErrors.CANNOT_PERFORM, msg(
            'Tranzaksiya holati noto‘g‘ri',
            'Неверное состояние транзакции',
            'Invalid transaction state',
          ));
        }
        if (this.isTimedOut(payment)) {
          await this.cancelPayment(repo, payment, PAYME_REASON_TIMEOUT, PaymeState.CANCELLED);
          throw new PaymeError(PaymeErrors.CANNOT_PERFORM, msg(
            'Tranzaksiya muddati tugagan',
            'Транзакция просрочена',
            'Transaction timed out',
          ));
        }
        return {
          create_time: payment.paymeTime ?? 0,
          transaction: payment.id,
          state: PaymeState.CREATED,
        };
      }

      // Boshqa tranzaksiya faol yoki payment allaqachon yakunlangan
      if (payment.state !== PaymeState.PENDING) {
        throw new PaymeError(PaymeErrors.CANNOT_PERFORM, msg(
          'Bu to‘lov uchun boshqa tranzaksiya mavjud',
          'По этому платежу существует другая транзакция',
          'Another transaction exists for this payment',
        ));
      }

      payment.paymeTransactionId = String(params.id);
      payment.paymeTime = Number(params.time) || Date.now();
      payment.state = PaymeState.CREATED;
      await repo.save(payment);
      return {
        create_time: payment.paymeTime,
        transaction: payment.id,
        state: PaymeState.CREATED,
      };
    });
  }

  async performTransaction(params: Record<string, any>): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await this.findPaymentByTransactionId(params.id, manager, true);
      const repo = manager.getRepository(Payment);

      if (payment.state === PaymeState.PERFORMED) {
        // Idempotent
        return {
          transaction: payment.id,
          perform_time: payment.performTime?.getTime() ?? 0,
          state: PaymeState.PERFORMED,
        };
      }
      if (payment.state !== PaymeState.CREATED) {
        throw new PaymeError(PaymeErrors.CANNOT_PERFORM, msg(
          'Tranzaksiyani bajarib bo‘lmaydi',
          'Невозможно выполнить транзакцию',
          'Cannot perform transaction',
        ));
      }
      if (this.isTimedOut(payment)) {
        await this.cancelPayment(repo, payment, PAYME_REASON_TIMEOUT, PaymeState.CANCELLED);
        throw new PaymeError(PaymeErrors.CANNOT_PERFORM, msg(
          'Tranzaksiya muddati tugagan',
          'Транзакция просрочена',
          'Transaction timed out',
        ));
      }

      payment.state = PaymeState.PERFORMED;
      payment.performTime = new Date();
      await repo.save(payment);
      await this.activateSubscription(manager, payment);
      this.logger.log(
        `Payme to'lov bajarildi: payment=${payment.id}, company=${payment.companyId}, amount=${payment.amount}`,
      );

      return {
        transaction: payment.id,
        perform_time: payment.performTime.getTime(),
        state: PaymeState.PERFORMED,
      };
    });
  }

  async cancelTransaction(params: Record<string, any>): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await this.findPaymentByTransactionId(params.id, manager, true);
      const repo = manager.getRepository(Payment);
      const reason = Number(params.reason) || 0;

      if (payment.state === PaymeState.CREATED) {
        await this.cancelPayment(repo, payment, reason, PaymeState.CANCELLED);
      } else if (payment.state === PaymeState.PERFORMED) {
        await this.cancelPayment(repo, payment, reason, PaymeState.CANCELLED_AFTER_PERFORM);
        await this.rollbackSubscription(manager, payment);
        this.logger.warn(
          `To'lov bajarilgandan keyin bekor qilindi (obuna qaytarildi): payment=${payment.id}, reason=${reason}`,
        );
      }
      // Allaqachon bekor bo'lsa — idempotent
      return {
        transaction: payment.id,
        cancel_time: payment.cancelTime?.getTime() ?? 0,
        state: payment.state,
      };
    });
  }

  async checkTransaction(params: Record<string, any>): Promise<Record<string, unknown>> {
    const payment = await this.findPaymentByTransactionId(params.id);
    return {
      create_time: payment.paymeTime ?? 0,
      perform_time: payment.performTime?.getTime() ?? 0,
      cancel_time: payment.cancelTime?.getTime() ?? 0,
      transaction: payment.id,
      state: payment.state,
      reason: payment.reason,
    };
  }

  async getStatement(params: Record<string, any>): Promise<Record<string, unknown>> {
    const from = Number(params.from) || 0;
    const to = Number(params.to) || Date.now();
    const payments = await this.paymentRepository
      .createQueryBuilder('p')
      .where('p."paymeTransactionId" IS NOT NULL')
      .andWhere('p."paymeTime" >= :from AND p."paymeTime" <= :to', { from, to })
      .orderBy('p."paymeTime"', 'ASC')
      .getMany();
    return {
      transactions: payments.map((p) => ({
        id: p.paymeTransactionId,
        time: p.paymeTime,
        amount: p.amount,
        account: { payment_id: p.id },
        create_time: p.paymeTime ?? 0,
        perform_time: p.performTime?.getTime() ?? 0,
        cancel_time: p.cancelTime?.getTime() ?? 0,
        transaction: p.id,
        state: p.state,
        reason: p.reason,
      })),
    };
  }

  /**
   * SetFiscalData — Payme to'lov muvaffaqiyatli bo'lgach soliq (fiskal) chek
   * ma'lumotlarini yuboradi (PERFORM — sotuv, CANCEL — bekor cheki).
   * Har bir tur alohida saqlanadi; javob: { success: true }.
   */
  async setFiscalData(params: Record<string, any>): Promise<Record<string, unknown>> {
    const payment = await this.findPaymentByTransactionId(params.id);
    const type = String(params.type ?? '').toUpperCase();
    const raw = (params.fiscal_data ?? {}) as Record<string, any>;

    const entry: FiscalEntry = {
      receiptId: raw.receipt_id != null ? String(raw.receipt_id) : null,
      statusCode: raw.status_code != null ? Number(raw.status_code) : null,
      message: raw.message != null ? String(raw.message) : null,
      terminalId: raw.terminal_id != null ? String(raw.terminal_id) : null,
      fiscalSign: raw.fiscal_sign != null ? String(raw.fiscal_sign) : null,
      qrCodeUrl: raw.qr_code_url != null ? String(raw.qr_code_url) : null,
      date: raw.date != null ? String(raw.date) : null,
      receivedAt: new Date().toISOString(),
    };

    const fiscalData: PaymentFiscalData = { ...(payment.fiscalData ?? {}) };
    if (type === 'CANCEL') fiscalData.cancel = entry;
    else fiscalData.perform = entry;

    await this.paymentRepository.update({ id: payment.id }, { fiscalData });
    this.logger.log(
      `Payme fiskal chek qabul qilindi: payment=${payment.id}, type=${type || 'PERFORM'}, receipt=${entry.receiptId}`,
    );
    return { success: true };
  }

  // ---------- Yordamchilar ----------

  /**
   * Fiskalizatsiya (soliq cheki) ma'lumotlari — CheckPerformTransaction javobidagi `detail`.
   * MXIK sozlanmagan bo'lsa yuborilmaydi (kassa fiskalizatsiyasiz rejimda).
   */
  private async buildFiscalDetail(
    payment: Payment,
  ): Promise<Record<string, unknown> | undefined> {
    const fiscal = this.paymeConfig.fiscal;
    if (!fiscal) return undefined;
    let title = 'FaceID — davomat tizimi obunasi';
    if (payment.tariffId) {
      const tariff = await this.tariffRepository
        .findOne({ where: { id: payment.tariffId } })
        .catch(() => null);
      if (tariff) title = `FaceID obuna — "${tariff.name}" tarifi, ${payment.months} oy`;
    }
    const item: Record<string, unknown> = {
      discount: 0,
      title,
      price: payment.amount, // tiyin
      count: 1,
      code: fiscal.mxik,
      vat_percent: fiscal.vatPercent,
    };
    if (fiscal.packageCode) item.package_code = fiscal.packageCode;
    return {
      receipt_type: 0, // sotuv cheki
      items: [item],
    };
  }

  private async findPaymentByAccount(
    account: Record<string, any> | undefined,
    manager?: EntityManager,
    lock = false,
  ): Promise<Payment> {
    const paymentId = account?.payment_id;
    if (!paymentId || typeof paymentId !== 'string' || !this.isUuid(paymentId)) {
      throw new PaymeError(PaymeErrors.PAYMENT_NOT_FOUND, msg(
        'payment_id ko‘rsatilmagan yoki noto‘g‘ri',
        'Не указан или неверный payment_id',
        'payment_id is missing or invalid',
      ), 'payment_id');
    }
    const repo = manager ? manager.getRepository(Payment) : this.paymentRepository;
    const payment = await repo
      .findOne({
        where: { id: paymentId },
        ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      })
      .catch(() => null);
    if (!payment) {
      throw new PaymeError(PaymeErrors.PAYMENT_NOT_FOUND, msg(
        'To‘lov topilmadi',
        'Платёж не найден',
        'Payment not found',
      ), 'payment_id');
    }
    return payment;
  }

  private async findPaymentByTransactionId(
    transactionId: unknown,
    manager?: EntityManager,
    lock = false,
  ): Promise<Payment> {
    const repo = manager ? manager.getRepository(Payment) : this.paymentRepository;
    const payment = await repo.findOne({
      where: { paymeTransactionId: String(transactionId ?? '') },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!payment) {
      throw new PaymeError(PaymeErrors.TRANSACTION_NOT_FOUND, msg(
        'Tranzaksiya topilmadi',
        'Транзакция не найдена',
        'Transaction not found',
      ));
    }
    return payment;
  }

  private assertAmount(payment: Payment, amount: unknown): void {
    if (Number(amount) !== payment.amount) {
      throw new PaymeError(PaymeErrors.INVALID_AMOUNT, msg(
        'Noto‘g‘ri summa',
        'Неверная сумма',
        'Invalid amount',
      ));
    }
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private isTimedOut(payment: Payment): boolean {
    return !!payment.paymeTime && Date.now() - payment.paymeTime > PAYME_TIMEOUT_MS;
  }

  private async cancelPayment(
    repo: Repository<Payment>,
    payment: Payment,
    reason: number,
    state: PaymeState,
  ): Promise<void> {
    payment.state = state;
    payment.reason = reason;
    payment.cancelTime = new Date();
    await repo.save(payment);
  }

  /** To'lov bajarilganda obunani uzaytirish yoki yangisini yaratish */
  private async activateSubscription(manager: EntityManager, payment: Payment): Promise<void> {
    const tariffId = payment.tariffId;
    if (!tariffId) {
      this.logger.warn(`Payment ${payment.id} tarifsiz — obuna yangilanmadi`);
      return;
    }
    const subscriptionRepo = manager.getRepository(Subscription);
    const companyRepo = manager.getRepository(Company);
    const now = new Date();

    const activeSub = await subscriptionRepo.findOne({
      where: { companyId: payment.companyId, status: SubscriptionStatus.ACTIVE },
      order: { endsAt: 'DESC' },
    });

    let subscription: Subscription;
    if (activeSub && activeSub.tariffId === tariffId && activeSub.endsAt > now && !activeSub.isTrial) {
      // Xuddi shu tarif faol — muddatini uzaytiramiz
      activeSub.endsAt = this.addMonths(activeSub.endsAt, payment.months);
      subscription = await subscriptionRepo.save(activeSub);
    } else {
      if (activeSub && activeSub.endsAt > now) {
        activeSub.status = SubscriptionStatus.CANCELLED;
        await subscriptionRepo.save(activeSub);
      }
      const startsAt = now;
      subscription = await subscriptionRepo.save(
        subscriptionRepo.create({
          companyId: payment.companyId,
          tariffId,
          startsAt,
          endsAt: this.addMonths(startsAt, payment.months),
          status: SubscriptionStatus.ACTIVE,
          isTrial: false,
        }),
      );
    }

    payment.subscriptionId = subscription.id;
    await manager.getRepository(Payment).save(payment);

    await companyRepo.update(
      { id: payment.companyId },
      {
        status: CompanyStatus.ACTIVE,
        tariffId,
        subscriptionStartsAt: subscription.startsAt,
        subscriptionEndsAt: subscription.endsAt,
      },
    );
  }

  /**
   * Perform'dan keyin bekor qilinganda (state -2) obunani teskari qaytarish:
   * to'langan oylar endsAt'dan ayiriladi; muddat qolmasa obuna CANCELLED,
   * kompaniya statusi qayta hisoblanadi.
   */
  private async rollbackSubscription(manager: EntityManager, payment: Payment): Promise<void> {
    if (!payment.subscriptionId) return;
    const subscriptionRepo = manager.getRepository(Subscription);
    const companyRepo = manager.getRepository(Company);
    const subscription = await subscriptionRepo.findOne({
      where: { id: payment.subscriptionId },
    });
    if (!subscription) return;

    const now = new Date();
    const rolledBack = this.addMonths(subscription.endsAt, -payment.months);
    subscription.endsAt = rolledBack > subscription.startsAt ? rolledBack : subscription.startsAt;
    if (subscription.endsAt <= now) {
      subscription.status = SubscriptionStatus.CANCELLED;
    }
    await subscriptionRepo.save(subscription);

    // Kompaniyani eng so'nggi faol obunaga sinxronlash
    const latestActive = await subscriptionRepo.findOne({
      where: {
        companyId: payment.companyId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: MoreThan(now),
      },
      order: { endsAt: 'DESC' },
    });
    if (latestActive) {
      await companyRepo.update(
        { id: payment.companyId },
        {
          status: CompanyStatus.ACTIVE,
          tariffId: latestActive.tariffId,
          subscriptionStartsAt: latestActive.startsAt,
          subscriptionEndsAt: latestActive.endsAt,
        },
      );
    } else {
      await companyRepo.update(
        { id: payment.companyId },
        { status: CompanyStatus.EXPIRED, subscriptionEndsAt: subscription.endsAt },
      );
    }
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }

  private error(
    id: number | string | null,
    code: number,
    messages: Record<string, string>,
    data?: string,
  ): PaymeResponse {
    return { id, error: { code, message: messages, ...(data ? { data } : {}) } };
  }
}
