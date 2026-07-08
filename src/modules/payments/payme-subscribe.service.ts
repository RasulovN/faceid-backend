import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../entities/payment.entity';
import { Tariff } from '../../entities/tariff.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { PaymeState } from '../../common/enums';
import { PaymeConfig } from './payme.config';
import { PaymeService } from './payme.service';
import { paymentStatusOf, PaymentStatus } from './subscriptions.service';

/** Payme Subscribe API JSON-RPC javobi */
interface SubscribeRpcResponse {
  result?: Record<string, any>;
  error?: { code: number; message: unknown; data?: unknown };
}

const RPC_TIMEOUT_MS = 25_000;

/**
 * Payme SUBSCRIBE API mijozi — karta to'lovi tizim ICHIDA (modal) bajarilishi uchun:
 *   cards.create → cards.get_verify_code → cards.verify → receipts.create → receipts.pay
 * (https://developer.help.paycom.uz/ · Subscribe API bo'limi).
 *
 * receipts.pay paytida Payme kassaning ro'yxatdagi Merchant API endpointini
 * (CheckPerform → Create → Perform) chaqiradi — ya'ni holat mashinasi va obuna
 * faollashuvi checkout-redirect oqimi bilan BIR XIL yo'ldan o'tadi. Shu sabab
 * kassa webhook'i shu backendga ko'rsatilgan bo'lishi SHART (docs/PAYME_DEPLOY.md).
 *
 * Karta raqami serverda SAQLANMAYDI — Payme'ga uzatiladi va token qaytadi.
 */
@Injectable()
export class PaymeSubscribeService {
  private readonly logger = new Logger(PaymeSubscribeService.name);

  constructor(
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
    private readonly paymeService: PaymeService,
    private readonly paymeConfig: PaymeConfig,
  ) {}

  /** 1-qadam: kartani tokenlash + SMS kod yuborish → { token, phone, wait } */
  async chargeCard(
    companyId: string,
    paymentId: string,
    card: string,
    expire: string,
  ): Promise<{ token: string; phone: string; wait: number }> {
    const payment = await this.loadPayablePayment(companyId, paymentId);

    const number = card.replace(/\D/g, '');
    const expireDigits = expire.replace(/\D/g, '');
    if (!/^\d{16}$/.test(number) || !/^\d{4}$/.test(expireDigits)) {
      throw AppException.validation("Karta raqami yoki amal muddati noto'g'ri");
    }

    const created = await this.rpc(
      'cards.create',
      { card: { number, expire: expireDigits }, save: false, account: this.accountOf(payment) },
      false,
    );
    const token = String(created.card?.token ?? '');
    if (!token) throw AppException.validation("Payme kartani qabul qilmadi");

    const sms = await this.rpc('cards.get_verify_code', { token }, false);
    return {
      token,
      phone: String(sms.phone ?? ''),
      wait: Number(sms.wait ?? 60000),
    };
  }

  /**
   * 2-qadam: SMS kodni tasdiqlash va to'lovni bajarish.
   * receipts.pay muvaffaqiyatli bo'lsa Merchant API webhook orqali payment
   * PERFORMED bo'ladi — yakuniy holat DB'dan o'qib qaytariladi.
   */
  async confirmAndPay(
    companyId: string,
    paymentId: string,
    token: string,
    code: string,
  ): Promise<{ status: PaymentStatus; receiptId: string | null }> {
    const payment = await this.loadPayablePayment(companyId, paymentId);

    const verified = await this.rpc('cards.verify', { token, code: code.trim() }, false);
    const verifiedToken = String(verified.card?.token ?? token);

    // Chek yaratish — fiskal detail (MXIK) bilan, xuddi CheckPerform'dagi kabi
    const detail = await this.paymeService.buildFiscalDetail(payment);
    const receipt = await this.rpc(
      'receipts.create',
      {
        amount: payment.amount,
        account: this.accountOf(payment),
        description: await this.descriptionOf(payment),
        ...(detail ? { detail } : {}),
      },
      true,
    );
    const receiptId = String(receipt.receipt?._id ?? '');
    if (!receiptId) throw AppException.validation("Payme chekni yarata olmadi");

    try {
      await this.rpc('receipts.pay', { id: receiptId, token: verifiedToken }, true);
    } catch (err) {
      // To'lov o'tmadi — chek ochiq qolmasin (best-effort)
      await this.rpc('receipts.cancel', { id: receiptId }, true).catch(() => undefined);
      throw err;
    }

    // receipts.pay davomida Payme bizning Merchant API'ni chaqirib bo'lgan —
    // holatni qisqa kutish bilan tekshiramiz (webhook bir zumda keladi)
    const status = await this.waitForPaid(paymentId);
    this.logger.log(
      `Subscribe to'lov: payment=${paymentId}, receipt=${receiptId}, status=${status}`,
    );
    return { status, receiptId };
  }

  // ---------- Yordamchilar ----------

  private accountOf(payment: Payment): Record<string, string> {
    return { [this.paymeConfig.accountField]: payment.id };
  }

  private async descriptionOf(payment: Payment): Promise<string> {
    if (payment.tariffId) {
      const tariff = await this.tariffRepository
        .findOne({ where: { id: payment.tariffId } })
        .catch(() => null);
      if (tariff) return `FaceID obuna — "${tariff.name}" tarifi, ${payment.months} oy`;
    }
    return 'FaceID — davomat tizimi obunasi';
  }

  private async loadPayablePayment(companyId: string, paymentId: string): Promise<Payment> {
    if (!this.paymeConfig.isConfigured) {
      throw AppException.validation("To'lov tizimi hali sozlanmagan");
    }
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId, companyId },
    });
    if (!payment) throw AppException.notFound("To'lov topilmadi");
    if (payment.state === PaymeState.PERFORMED) {
      throw AppException.validation("Bu to'lov allaqachon amalga oshirilgan");
    }
    if (payment.state < 0) {
      throw AppException.validation("Bu to'lov bekor qilingan — yangi to'lov boshlang");
    }
    return payment;
  }

  /** receipts.pay'dan keyin payment PERFORMED bo'lishini qisqa poll qilish */
  private async waitForPaid(paymentId: string, attempts = 10): Promise<PaymentStatus> {
    for (let i = 0; i < attempts; i++) {
      const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
      if (payment && payment.state === PaymeState.PERFORMED) return 'PAID';
      if (payment && payment.state < 0) return paymentStatusOf(payment);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
    return payment ? paymentStatusOf(payment) : 'PENDING';
  }

  /**
   * Subscribe API JSON-RPC chaqiruvi.
   * X-Auth: cards.* uchun faqat merchant_id; receipts.* uchun merchant_id:KEY.
   */
  private async rpc(
    method: string,
    params: Record<string, unknown>,
    withKey: boolean,
  ): Promise<Record<string, any>> {
    const { subscribeMerchantId, subscribeKey, subscribeApiUrl } = this.paymeConfig;
    const auth = withKey ? `${subscribeMerchantId}:${subscribeKey}` : subscribeMerchantId;

    let response: Response;
    try {
      response = await fetch(subscribeApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth': auth,
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ id: Date.now(), method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`Payme Subscribe ${method} tarmoq xatosi: ${(err as Error).message}`);
      throw AppException.validation(
        "Payme bilan aloqa o'rnatilmadi — birozdan so'ng qaytadan urinib ko'ring",
      );
    }

    let json: SubscribeRpcResponse;
    try {
      json = (await response.json()) as SubscribeRpcResponse;
    } catch {
      throw AppException.validation(`Payme javobini o'qib bo'lmadi (HTTP ${response.status})`);
    }

    if (json.error) {
      const message = this.errorText(json.error);
      this.logger.warn(`Payme Subscribe ${method} xato ${json.error.code}: ${message}`);
      throw AppException.validation(message);
    }
    return json.result ?? {};
  }

  /** Payme xabari string yoki {uz,ru,en} obyekt bo'lishi mumkin */
  private errorText(error: { code: number; message: unknown }): string {
    const m = error.message;
    if (typeof m === 'string' && m) return m;
    if (m && typeof m === 'object') {
      const rec = m as Record<string, unknown>;
      const text = rec.uz ?? rec.ru ?? rec.en;
      if (typeof text === 'string' && text) return text;
    }
    return `Payme xatosi (kod ${error.code})`;
  }
}
