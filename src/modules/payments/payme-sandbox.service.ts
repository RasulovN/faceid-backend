import { randomBytes, randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../../entities/company.entity';
import { Payment } from '../../entities/payment.entity';
import { Tariff } from '../../entities/tariff.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { PaymeConfig } from './payme.config';
import { PaymeErrors, PaymeResponse, PaymeService } from './payme.service';

/** Sandbox SMS tasdiqlash kodi (haqiqiy Payme sandbox'idagi kabi bitta doimiy kod) */
export const SANDBOX_SMS_CODE = '666666';
/** Bu karta bilan to'lov "mablag' yetarli emas" xatosini beradi (test ssenariysi) */
export const SANDBOX_CARD_INSUFFICIENT = '8600069195406311';
/** Sessiya yaroqlilik muddati */
const SESSION_TTL_MS = 15 * 60 * 1000;

interface SandboxSession {
  paymentId: string;
  amount: number;
  callbackUrl: string | null;
  /** Muvaffaqiyatdan so'ng callback'ga avto-qaytish kutish vaqti (ms) */
  ct: number;
  lang: string;
  card?: string;
  smsSent?: boolean;
  createdAt: number;
}

export interface SandboxSessionInfo {
  token: string | null;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  merchantName: string;
  description: string;
  companyName: string | null;
  /** Summa, tiyin */
  amount: number;
  lang: string;
  callbackUrl: string | null;
  ct: number;
  /** UI'da ko'rsatiladigan test kartalar eslatmasi */
  testCards: { success: string; insufficient: string; smsCode: string };
}

/**
 * Payme checkout SANDBOX EMULYATORI — lokal muhitda haqiqiy Payme'ga chiqmasdan
 * to'liq to'lov oqimini bajaradi. Tashqi interfeysi client'dagi /payme sahifasi,
 * ichkarida esa xuddi Payme serveri kabi rasmiy Merchant JSON-RPC metodlarini
 * (CheckPerformTransaction → CreateTransaction → PerformTransaction → SetFiscalData)
 * PaymeService orqali chaqiradi — ya'ni holat mashinasi, obuna aktivatsiyasi va
 * fiskalizatsiya PRODUCTION bilan BIR XIL kod yo'lidan o'tadi.
 *
 * FAQAT PAYME_TEST_MODE=1 va PAYME_LOCAL_CHECKOUT=1 bo'lganda ishlaydi,
 * aks holda barcha endpointlar 404 qaytaradi.
 */
@Injectable()
export class PaymeSandboxService {
  private readonly logger = new Logger(PaymeSandboxService.name);
  /** In-memory sessiyalar — faqat lokal dev uchun (restart'da tozalanadi) */
  private readonly sessions = new Map<string, SandboxSession>();

  constructor(
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    private readonly paymeService: PaymeService,
    private readonly paymeConfig: PaymeConfig,
  ) {}

  /** Checkout havolasidagi base64 parametrlarni ochib, to'lov sessiyasini boshlaydi */
  async createSession(paramsBase64: string): Promise<SandboxSessionInfo> {
    this.assertEnabled();
    const params = this.decodeParams(paramsBase64);

    if (params.m !== this.paymeConfig.merchantId) {
      throw AppException.validation(
        "Kassa topilmadi — havoladagi merchant ID tizim sozlamasiga mos emas",
      );
    }
    // Kabinetda sozlangan account maydoni; eski payment_id havolalar bilan ham moslik
    const paymentId =
      params[`ac.${this.paymeConfig.accountField}`] ?? params['ac.payment_id'] ?? '';
    const amount = Number(params.a);
    if (!paymentId || !Number.isFinite(amount) || amount <= 0) {
      throw AppException.validation("Havola parametrlari noto'g'ri (payment_id/summa)");
    }

    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
    if (!payment) throw AppException.notFound("To'lov topilmadi");

    const [tariff, company] = await Promise.all([
      payment.tariffId
        ? this.tariffRepository.findOne({ where: { id: payment.tariffId } })
        : Promise.resolve(null),
      this.companyRepository.findOne({
        where: { id: payment.companyId },
        select: ['id', 'name'],
      }),
    ]);

    const base: Omit<SandboxSessionInfo, 'token' | 'status'> = {
      merchantName: 'FaceID Davomat platformasi',
      description: tariff
        ? `"${tariff.name}" tarifi obunasi — ${payment.months} oy`
        : `Obuna to'lovi — ${payment.months} oy`,
      companyName: company?.name ?? null,
      amount: payment.amount,
      lang: params.l === 'ru' ? 'ru' : 'uz',
      callbackUrl: params.c ? this.safeDecodeUri(params.c) : null,
      ct: Number(params.ct) > 0 ? Number(params.ct) : 15000,
      testCards: {
        success: '8600 4954 7331 6478',
        insufficient: '8600 0691 9540 6311',
        smsCode: SANDBOX_SMS_CODE,
      },
    };

    // To'lov holatini rasmiy protokol orqali tekshiramiz (Payme aynan shunday qiladi)
    const check = await this.rpc('CheckPerformTransaction', {
      amount,
      account: { [this.paymeConfig.accountField]: paymentId },
    });
    if (check.error) {
      if (check.error.code === PaymeErrors.ALREADY_PAID) {
        return { ...base, token: null, status: 'PAID' };
      }
      if (check.error.code === PaymeErrors.CANCELLED_PAYMENT) {
        return { ...base, token: null, status: 'CANCELLED' };
      }
      throw this.toAppException(check);
    }

    const token = randomBytes(16).toString('hex');
    this.purgeExpired();
    this.sessions.set(token, {
      paymentId,
      amount,
      callbackUrl: base.callbackUrl,
      ct: base.ct,
      lang: base.lang,
      createdAt: Date.now(),
    });

    return { ...base, token, status: 'PENDING' };
  }

  /** 1-qadam: karta raqami + amal qilish muddati (SMS "yuboriladi") */
  async submitCard(
    token: string,
    card: string,
    expire: string,
  ): Promise<{ phone: string; smsCode: string }> {
    this.assertEnabled();
    const session = this.getSession(token);

    const digits = card.replace(/\D/g, '');
    if (!/^(8600|9860|5614|6262)\d{12}$/.test(digits)) {
      throw AppException.validation(
        "Karta raqami noto'g'ri — 16 xonali Uzcard (8600) yoki Humo (9860) karta kiriting",
      );
    }
    const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expire.trim());
    const month = match ? Number(match[1]) : 0;
    if (!match || month < 1 || month > 12) {
      throw AppException.validation("Amal qilish muddati noto'g'ri (MM/YY)");
    }
    const year = 2000 + Number(match[2]);
    const now = new Date();
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
      throw AppException.validation('Karta muddati tugagan');
    }

    // Hali ham to'lash mumkinligini tekshirish (parallel to'lab qo'yilgan bo'lishi mumkin)
    const check = await this.rpc('CheckPerformTransaction', {
      amount: session.amount,
      account: { [this.paymeConfig.accountField]: session.paymentId },
    });
    if (check.error) throw this.toAppException(check);

    session.card = digits;
    session.smsSent = true;

    // Sandbox: telefon raqami karta oxiridan "hosil qilinadi", kod doimiy
    const phone = `+998 ** *** ${digits.slice(-4, -2)} ${digits.slice(-2)}`;
    return { phone, smsCode: SANDBOX_SMS_CODE };
  }

  /** 2-qadam: SMS kod tasdiqlash → Create + Perform + fiskal chek */
  async confirm(
    token: string,
    code: string,
  ): Promise<{ status: 'PAID'; performTime: number; callbackUrl: string | null; ct: number }> {
    this.assertEnabled();
    const session = this.getSession(token);
    if (!session.smsSent || !session.card) {
      throw AppException.validation('Avval karta ma’lumotlarini kiriting');
    }
    if (code.trim() !== SANDBOX_SMS_CODE) {
      throw AppException.validation("SMS kod noto'g'ri");
    }
    if (session.card === SANDBOX_CARD_INSUFFICIENT.replace(/\D/g, '')) {
      throw AppException.validation("Kartada mablag' yetarli emas");
    }

    const account = { [this.paymeConfig.accountField]: session.paymentId };

    const check = await this.rpc('CheckPerformTransaction', {
      amount: session.amount,
      account,
    });
    if (check.error) {
      // Takroriy bosishda allaqachon to'langan bo'lsa — muvaffaqiyat (idempotent UX)
      if (check.error.code === PaymeErrors.ALREADY_PAID) {
        this.sessions.delete(token);
        return {
          status: 'PAID',
          performTime: Date.now(),
          callbackUrl: session.callbackUrl,
          ct: session.ct,
        };
      }
      throw this.toAppException(check);
    }

    // Payme tranzaksiya ID formati — 24 xonali hex
    const txId = randomBytes(12).toString('hex');
    const created = await this.rpc('CreateTransaction', {
      id: txId,
      time: Date.now(),
      amount: session.amount,
      account,
    });
    if (created.error) throw this.toAppException(created);

    const performed = await this.rpc('PerformTransaction', { id: txId });
    if (performed.error) throw this.toAppException(performed);

    // Fiskalizatsiya sozlangan bo'lsa — Payme kabi soliq chekini ham yuboramiz
    if (this.paymeConfig.fiscal) {
      const fiscal = await this.rpc('SetFiscalData', {
        id: txId,
        type: 'PERFORM',
        fiscal_data: this.fakeFiscalData(),
      });
      if (fiscal.error) {
        this.logger.warn(`Sandbox fiskal chek saqlanmadi: ${JSON.stringify(fiscal.error)}`);
      }
    }

    this.logger.log(
      `Sandbox to'lov bajarildi: payment=${session.paymentId}, tx=${txId}, amount=${session.amount}`,
    );
    this.sessions.delete(token);
    return {
      status: 'PAID',
      performTime: Number(performed.result?.perform_time) || Date.now(),
      callbackUrl: session.callbackUrl,
      ct: session.ct,
    };
  }

  /** Foydalanuvchi to'lovni bekor qildi — sessiya tozalanadi, payment PENDING qoladi */
  cancel(token: string): { callbackUrl: string | null } {
    this.assertEnabled();
    const session = this.sessions.get(token);
    this.sessions.delete(token);
    return { callbackUrl: session?.callbackUrl ?? null };
  }

  // ---------- Yordamchilar ----------

  private assertEnabled(): void {
    if (!this.paymeConfig.isLocalCheckout) {
      throw AppException.notFound('Sahifa topilmadi');
    }
  }

  private getSession(token: string): SandboxSession {
    this.purgeExpired();
    const session = this.sessions.get(token);
    if (!session) {
      throw AppException.validation(
        "To'lov sessiyasi muddati tugagan — sahifani yangilab qaytadan urinib ko'ring",
      );
    }
    return session;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) this.sessions.delete(key);
    }
  }

  /** base64(m=...;ac.payment_id=...;a=...;c=...;ct=...;l=...) → obyekt */
  private decodeParams(paramsBase64: string): Record<string, string> {
    let decoded: string;
    try {
      decoded = Buffer.from(paramsBase64, 'base64').toString('utf8');
    } catch {
      throw AppException.validation("Checkout havolasi noto'g'ri (base64)");
    }
    const result: Record<string, string> = {};
    for (const part of decoded.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    if (!result.m) {
      throw AppException.validation("Checkout havolasi noto'g'ri (m parametri yo'q)");
    }
    return result;
  }

  private safeDecodeUri(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  /** Rasmiy Merchant JSON-RPC chaqiruvi — xuddi Payme serveri yuborganidek */
  private rpc(method: string, params: Record<string, unknown>): Promise<PaymeResponse> {
    const auth = `Basic ${Buffer.from(`Paycom:${this.paymeConfig.merchantKey}`).toString('base64')}`;
    return this.paymeService.handle({ id: Date.now(), method, params }, auth);
  }

  private toAppException(response: PaymeResponse): AppException {
    const message =
      response.error?.message?.uz ?? response.error?.message?.en ?? "To'lovni bajarib bo'lmadi";
    return AppException.validation(message);
  }

  /** Soliq (OFD) cheki uchun ishonarli sandbox ma'lumotlari */
  private fakeFiscalData(): Record<string, unknown> {
    const receiptId = randomInt(100_000_000, 999_999_999);
    const fiscalSign = String(randomInt(100_000_000_000, 999_999_999_999));
    const terminalId = 'EP000000000001';
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    return {
      receipt_id: receiptId,
      status_code: 0,
      message: 'Accepted (sandbox)',
      terminal_id: terminalId,
      fiscal_sign: fiscalSign,
      qr_code_url: `https://ofd.soliq.uz/check?t=${terminalId}&r=${receiptId}&c=${stamp}&s=${fiscalSign}`,
      date: `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`,
    };
  }
}
