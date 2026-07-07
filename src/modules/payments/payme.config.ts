import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const PAYME_CHECKOUT_PROD = 'https://checkout.paycom.uz';
export const PAYME_CHECKOUT_TEST = 'https://checkout.test.paycom.uz';

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
  readonly merchantId: string;
  readonly merchantKey: string;
  readonly checkoutUrl: string;
  readonly fiscal: PaymeFiscalConfig | null;

  constructor(config: ConfigService) {
    this.isTestMode = config.get<boolean>('PAYME_TEST_MODE') ?? true;

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
    return this.isTestMode ? 'TEST (sandbox)' : 'PRODUCTION';
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }
}
