import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import { Company } from '../../entities/company.entity';
import { Payment } from '../../entities/payment.entity';
import { Tariff } from '../../entities/tariff.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { PaymeState } from '../../common/enums';
import { FiscalEntry, PaymentReceipt } from './payme.types';

/** Payme state → chek statusi */
function receiptStatus(state: number): PaymentReceipt['status'] {
  if (state === PaymeState.PERFORMED) return 'PAID';
  if (state < 0) return 'CANCELED';
  return 'CREATED';
}

/** tiyin → "1 250 000 so'm" */
function formatSom(tiyin: number): string {
  const som = Math.round(tiyin / 100);
  return `${som.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}

function esc(value: string | number | null | undefined): string {
  if (value == null) return '—';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_LABEL: Record<PaymentReceipt['status'], string> = {
  PAID: "To'langan",
  CREATED: 'Kutilmoqda',
  CANCELED: 'Bekor qilingan',
};

/**
 * To'lov cheki (payment receipt) va soliq (fiskal) cheki hujjatini tayyorlaydi.
 * JSON — panel ichida ko'rsatish uchun; HTML — chop etish / PDF (brauzer orqali) uchun.
 * Ma'lumot Payme fiskalizatsiyasidan (Payment.fiscalData) keladi.
 */
@Injectable()
export class PaymentReceiptService {
  constructor(
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
  ) {}

  /**
   * Chek ma'lumotini yig'adi. companyId berilsa (kompaniya paneli) —
   * to'lov o'sha kompaniyaga tegishli ekani tekshiriladi.
   */
  async getReceipt(paymentId: string, companyId?: string): Promise<PaymentReceipt> {
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
    if (!payment) throw AppException.notFound("To'lov topilmadi");
    if (companyId && payment.companyId !== companyId) {
      throw AppException.notFound("To'lov topilmadi");
    }

    const [company, tariff] = await Promise.all([
      this.companyRepository.findOne({ where: { id: payment.companyId }, select: ['id', 'name'] }),
      payment.tariffId
        ? this.tariffRepository.findOne({ where: { id: payment.tariffId }, select: ['id', 'name'] })
        : Promise.resolve(null),
    ]);

    return {
      paymentId: payment.id,
      companyName: company?.name ?? '—',
      tariffName: tariff?.name ?? null,
      months: payment.months,
      amount: payment.amount,
      provider: payment.provider,
      transactionId: payment.paymeTransactionId,
      status: receiptStatus(payment.state),
      createdAt: payment.createdAt.toISOString(),
      performTime: payment.performTime?.toISOString() ?? null,
      cancelTime: payment.cancelTime?.toISOString() ?? null,
      fiscal: payment.fiscalData?.perform ?? null,
      fiscalCancel: payment.fiscalData?.cancel ?? null,
    };
  }

  /** Chop etiladigan HTML chek (o'zaro bog'liqsiz, inline CSS, QR embedded) */
  async renderReceiptHtml(paymentId: string, companyId?: string): Promise<string> {
    const r = await this.getReceipt(paymentId, companyId);
    const performQr = await this.qrDataUri(r.fiscal?.qrCodeUrl);
    const cancelQr = await this.qrDataUri(r.fiscalCancel?.qrCodeUrl);

    const statusColor =
      r.status === 'PAID' ? '#059669' : r.status === 'CANCELED' ? '#DC2626' : '#D97706';

    const fiscalBlock = (entry: FiscalEntry | null, qr: string | null, title: string): string => {
      if (!entry) {
        return `
          <div class="fiscal pending">
            <h3>${esc(title)}</h3>
            <p class="muted">Fiskal chek hali kelmagan. Soliq organida ro'yxatga olingach shu yerda paydo bo'ladi.</p>
          </div>`;
      }
      return `
        <div class="fiscal">
          <h3>${esc(title)}</h3>
          <div class="fiscal-grid">
            <div class="fiscal-rows">
              <div class="row"><span>Fiskal chek raqami</span><b>${esc(entry.receiptId)}</b></div>
              <div class="row"><span>Fiskal modul (terminal)</span><b>${esc(entry.terminalId)}</b></div>
              <div class="row"><span>Fiskal belgi (imzo)</span><b>${esc(entry.fiscalSign)}</b></div>
              <div class="row"><span>Ro'yxatga olingan sana</span><b>${esc(entry.date)}</b></div>
            </div>
            ${
              qr
                ? `<div class="qr"><img src="${qr}" alt="Soliq chek QR" width="132" height="132"/>
                     ${entry.qrCodeUrl ? `<a href="${esc(entry.qrCodeUrl)}" target="_blank" rel="noopener">Soliq chekini ochish</a>` : ''}
                   </div>`
                : ''
            }
          </div>
        </div>`;
    };

    return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Chek — ${esc(r.companyName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #18181B;
    background: #F4F4F5; margin: 0; padding: 24px; }
  .sheet { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0,0,0,.08); overflow: hidden; }
  .head { background: linear-gradient(135deg,#4F46E5,#4338CA); color: #fff; padding: 24px 28px; }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
  .brand .logo { width: 32px; height: 32px; border-radius: 9px; background: rgba(255,255,255,.18);
    display:flex; align-items:center; justify-content:center; font-size: 18px; }
  .head p { margin: 8px 0 0; opacity: .85; font-size: 13px; }
  .body { padding: 24px 28px; }
  .status { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px;
    font-weight: 700; color: #fff; background: ${statusColor}; }
  .amount { font-size: 30px; font-weight: 800; letter-spacing: -.5px; margin: 14px 0 4px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 9px 0;
    border-bottom: 1px dashed #E4E4E7; font-size: 14px; }
  .row span { color: #71717A; }
  .row b { font-weight: 600; text-align: right; word-break: break-word; }
  .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: .5px;
    color: #A1A1AA; margin: 22px 0 6px; font-weight: 700; }
  .fiscal { margin-top: 10px; border: 1px solid #E4E4E7; border-radius: 12px; padding: 16px; }
  .fiscal.pending { background: #FAFAFA; }
  .fiscal h3 { margin: 0 0 12px; font-size: 14px; }
  .fiscal-grid { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .fiscal-rows { flex: 1; min-width: 240px; }
  .qr { text-align: center; }
  .qr img { border: 1px solid #E4E4E7; border-radius: 8px; padding: 6px; background: #fff; }
  .qr a { display: block; margin-top: 6px; font-size: 12px; color: #4F46E5; }
  .muted { color: #A1A1AA; font-size: 13px; margin: 0; }
  .foot { padding: 16px 28px 26px; text-align: center; color: #A1A1AA; font-size: 12px; }
  .actions { text-align: center; padding: 0 28px 22px; }
  .actions button { background: #4F46E5; color: #fff; border: 0; border-radius: 10px;
    padding: 11px 22px; font-size: 14px; font-weight: 600; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; } .actions { display: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div class="brand"><span class="logo">🧾</span> FaceID Davomat</div>
      <p>To'lov cheki · ${esc(r.paymentId)}</p>
    </div>
    <div class="body">
      <span class="status">${STATUS_LABEL[r.status]}</span>
      <div class="amount">${formatSom(r.amount)}</div>

      <div class="section-title">To'lov ma'lumotlari</div>
      <div class="row"><span>Kompaniya</span><b>${esc(r.companyName)}</b></div>
      <div class="row"><span>Tarif</span><b>${esc(r.tariffName)}</b></div>
      <div class="row"><span>Muddat</span><b>${esc(r.months)} oy</b></div>
      <div class="row"><span>To'lov tizimi</span><b>${esc(r.provider)}</b></div>
      <div class="row"><span>Tranzaksiya ID</span><b>${esc(r.transactionId)}</b></div>
      <div class="row"><span>Yaratilgan</span><b>${formatDateTime(r.createdAt)}</b></div>
      <div class="row"><span>To'langan vaqt</span><b>${formatDateTime(r.performTime)}</b></div>
      ${r.cancelTime ? `<div class="row"><span>Bekor qilingan</span><b>${formatDateTime(r.cancelTime)}</b></div>` : ''}

      <div class="section-title">Fiskal (soliq) chek</div>
      ${fiscalBlock(r.fiscal, performQr, "Sotuv cheki")}
      ${r.fiscalCancel ? fiscalBlock(r.fiscalCancel, cancelQr, 'Bekor cheki') : ''}
    </div>
    <div class="actions">
      <button onclick="window.print()">Chop etish / PDF saqlash</button>
    </div>
    <div class="foot">Ushbu chek FaceID Davomat platformasi tomonidan avtomatik yaratildi.</div>
  </div>
</body>
</html>`;
  }

  /** QR URL'dan data-URI PNG (chekka embed uchun). URL bo'sh bo'lsa null. */
  private async qrDataUri(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    try {
      return await QRCode.toDataURL(url, { margin: 1, width: 132 });
    } catch {
      return null;
    }
  }
}
