/**
 * Payme fiskalizatsiya (soliq cheki) tiplari.
 * SetFiscalData metodi orqali Payme to'lov muvaffaqiyatli bo'lgach yuboradi:
 * PERFORM — sotuv cheki, CANCEL — bekor cheki. Har biri alohida saqlanadi.
 */

/** Payme'dan kelgan bitta fiskal yozuv (fiscal_data) */
export interface FiscalEntry {
  /** Virtual fiskal modul uchun ketma-ket to'lov raqami */
  receiptId: string | null;
  /** Soliqda ro'yxatga olish natijasi kodi (0/200 — muvaffaqiyat) */
  statusCode: number | null;
  /** Xato bo'lsa — tafsilot */
  message: string | null;
  /** Virtual fiskal modul (terminal) raqami */
  terminalId: string | null;
  /** Fiskal belgi (imzo) */
  fiscalSign: string | null;
  /** Soliq (OFD) chekiga havola — QR shu URL'ga ishora qiladi */
  qrCodeUrl: string | null;
  /** Soliqda ro'yxatga olingan sana */
  date: string | null;
  /** Biz qabul qilgan vaqt (ISO) */
  receivedAt: string;
}

/** Payment.fiscalData jsonb tuzilishi — chek turi bo'yicha */
export interface PaymentFiscalData {
  perform?: FiscalEntry;
  cancel?: FiscalEntry;
}

/** Chek (payment receipt) — chek + fiskal ma'lumot birga */
export interface PaymentReceipt {
  paymentId: string;
  companyName: string;
  tariffName: string | null;
  months: number;
  /** Summa, tiyin */
  amount: number;
  provider: string;
  transactionId: string | null;
  status: 'CREATED' | 'PAID' | 'CANCELED';
  createdAt: string;
  performTime: string | null;
  cancelTime: string | null;
  /** Fiskal chek (mavjud bo'lsa) — soliq QR va imzo bilan */
  fiscal: FiscalEntry | null;
  /** Bekor cheki fiskal ma'lumoti (agar to'lov bekor qilingan bo'lsa) */
  fiscalCancel: FiscalEntry | null;
}
