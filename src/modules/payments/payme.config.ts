import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const PAYME_CHECKOUT_PROD = 'https://checkout.paycom.uz';
export const PAYME_CHECKOUT_TEST = 'https://checkout.test.paycom.uz';
/** Subscribe API (cards.* / receipts.*) manzillari — checkout host + /api */
export const PAYME_SUBSCRIBE_API_PROD = 'https://checkout.paycom.uz/api';
export const PAYME_SUBSCRIBE_API_TEST = 'https://checkout.test.paycom.uz/api';

export interface PaymeFiscalConfig {
  /** MXIK (IKPU) kodi — JS number aniqligidan katta bo'lishi mumkin, shuning uchun string */
  mxik: string;
  packageCode: string;
  vatPercent: number;
}

/**
 * Payme kassa sozlamalari — PAYME_TEST_MODE bo'yicha AVTOMATIK tanlanadi:
 *   PAYME_TEST_MODE=1 → sandbox (test kassa kaliti + checkout.test.paycom.uz)
 *   PAYME_TEST_MODE=0 → production (asosiy kalit + checkout.paycom.uz)
 * Checkout URL'ni har rejim uchun alohida env bilan majburan almashtirsa ham bo'ladi
 * (PAYME_CHECKOUT_URL / PAYME_TEST_CHECKOUT_URL). Merchant API ham, Subscribe API ham
 * bitta kassani ishlatadi.
 */
@Injectable()
export class PaymeConfig {
  private readonly logger = new Logger(PaymeConfig.name);

  readonly isTestMode: boolean;
  /** Lokal (tizim ichidagi) sandbox checkout faolmi — faqat test rejimda mumkin */
  readonly isLocalCheckout: boolean;
  readonly merchantId: string;
  readonly merchantKey: string;
  readonly checkoutUrl: string;
  /**
   * Kassa kabinetida sozlangan "account" maydoni nomi (masalan payment_id yoki
   * order_id). Checkout havolasida ac.<field>, Merchant API'da account[<field>]
   * sifatida ishlatiladi — mavjud kassa bilan moslik uchun sozlanadi.
   */
  readonly accountField: string;
  /** Merchant API uchun ruxsat etilgan IP'lar (bo'sh — tekshiruv o'chiq) */
  readonly allowedIps: string[];
  /** Subscribe API (tizim ichidagi karta to'lovi) — kassa yoki virtual terminal */
  readonly subscribeMerchantId: string;
  readonly subscribeKey: string;
  readonly subscribeApiUrl: string;
  readonly fiscal: PaymeFiscalConfig | null;

  constructor(config: ConfigService) {
    this.isTestMode = config.get<boolean>('PAYME_TEST_MODE') ?? true;
    const wantLocalCheckout = config.get<boolean>('PAYME_LOCAL_CHECKOUT') ?? false;
    this.isLocalCheckout = this.isTestMode && wantLocalCheckout;
    if (wantLocalCheckout && !this.isTestMode) {
      this.logger.warn(
        'PAYME_LOCAL_CHECKOUT production rejimda e’tiborsiz qoldirildi — haqiqiy Payme checkout ishlatiladi.',
      );
    }

    const prodId = config.get<string>('PAYME_MERCHANT_ID') ?? '';
    const prodKey = config.get<string>('PAYME_MERCHANT_KEY') ?? '';

    if (this.isTestMode) {
      // Test kassa ko'pincha bir xil merchant ID'da, faqat kaliti boshqa bo'ladi
      this.merchantId = config.get<string>('PAYME_TEST_MERCHANT_ID') || prodId;
      this.merchantKey = config.get<string>('PAYME_TEST_MERCHANT_KEY') || prodKey;
      this.checkoutUrl = this.normalizeUrl(
        config.get<string>('PAYME_TEST_CHECKOUT_URL') || PAYME_CHECKOUT_TEST,
      );
    } else {
      this.merchantId = prodId;
      this.merchantKey = prodKey;
      this.checkoutUrl = this.normalizeUrl(
        config.get<string>('PAYME_CHECKOUT_URL') || PAYME_CHECKOUT_PROD,
      );
    }

    if (this.isLocalCheckout) {
      // Checkout havolasi tashqi Payme'ga emas, tizimning o'z sandbox sahifasiga boradi.
      // Kassa sozlanmagan bo'lsa ham lokal emulyator ishlashi uchun default kalitlar.
      const clientUrl = (config.get<string>('CLIENT_URL') ?? 'http://localhost:5173').replace(
        /\/+$/,
        '',
      );
      this.checkoutUrl = `${clientUrl}/payme`;
      if (!this.merchantId) this.merchantId = 'sandbox';
      if (!this.merchantKey) this.merchantKey = 'sandbox_key';
    }

    this.accountField = (config.get<string>('PAYME_ACCOUNT_FIELD') || 'payment_id').trim();

    // Subscribe API: maxsus virtual terminal berilmagan bo'lsa asosiy kassa ishlatiladi
    this.subscribeMerchantId =
      config.get<string>('PAYME_SUBSCRIBE_MERCHANT_ID') || this.merchantId;
    this.subscribeKey = config.get<string>('PAYME_SUBSCRIBE_KEY') || this.merchantKey;
    this.subscribeApiUrl = this.normalizeUrl(
      config.get<string>('PAYME_SUBSCRIBE_URL') ||
        (this.isTestMode ? PAYME_SUBSCRIBE_API_TEST : PAYME_SUBSCRIBE_API_PROD),
    );

    this.allowedIps = String(config.get('PAYME_ALLOWED_IPS') ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
    if (!this.isTestMode && this.allowedIps.length === 0) {
      this.logger.warn(
        "PAYME_ALLOWED_IPS bo'sh — production'da Payme endpointi faqat Basic auth bilan himoyalangan (IP allowlist tavsiya etiladi).",
      );
    }

    const mxik = String(config.get('PAYME_FISCAL_MXIK') ?? '').trim();
    const packageCode = String(config.get('PAYME_FISCAL_PACKAGE_CODE') ?? '').trim();
    const vatPercent = Number(config.get('PAYME_FISCAL_VAT_PERCENT') ?? 0);
    this.fiscal = mxik
      ? { mxik, packageCode, vatPercent: Number.isFinite(vatPercent) ? vatPercent : 0 }
      : null;

    if (!this.merchantId || !this.merchantKey) {
      this.logger.warn(
        `Payme sozlanmagan (merchantId/merchantKey bo'sh) — checkout ishlamaydi. Rejim: ${this.modeLabel}`,
      );
    } else {
      this.logger.log(`Payme rejimi: ${this.modeLabel}, checkout: ${this.checkoutUrl}`);
    }
    if (!this.isTestMode && this.checkoutUrl.includes('test.paycom.uz')) {
      this.logger.error(
        'DIQQAT: PRODUCTION rejimda test checkout URL ishlatilmoqda — PAYME_CHECKOUT_URL ni tekshiring!',
      );
    }
  }

  get isConfigured(): boolean {
    return this.merchantId.length > 0 && this.merchantKey.length > 0;
  }

  private get modeLabel(): string {
    if (this.isLocalCheckout) return 'TEST (lokal sandbox checkout)';
    return this.isTestMode ? 'TEST (sandbox)' : 'PRODUCTION';
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }
}
