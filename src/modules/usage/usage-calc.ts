/**
 * Usage analitikasi sof hisob-kitoblari (DB'siz, unit-testlanadigan).
 * Kun chegarasi Asia/Tashkent (UTC+5, DST yo'q) bo'yicha yuritiladi.
 */

export type EngagementLevel = 'high' | 'medium' | 'low' | 'inactive';
export type ChurnRisk = 'high' | 'medium' | 'low' | 'none';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Bugungi sana (YYYY-MM-DD) Toshkent vaqti bo'yicha */
export function tashkentToday(now: Date = new Date()): string {
  return new Date(now.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/** date (YYYY-MM-DD) ga delta kun qo'shadi */
export function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** from..to (inklyuziv) kunlar ro'yxati — chart zero-fill uchun */
export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Ikki sana orasidagi to'liq kunlar farqi (a - b) */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

/** O'sish foizi: prev=0 bo'lsa 100% (yoki 0), aks holda oddiy nisbat */
export function growthPct(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prev) / prev) * 100);
}

export interface EngagementInput {
  /** Davr ichida faollik bo'lgan kunlar (panel yoki davomat skani) */
  activeDays: number;
  /** Davr uzunligi (kun) */
  periodDays: number;
  /** Davrda kamida bitta so'rov qilgan foydalanuvchilar */
  activeUsers: number;
  /** Kompaniyadagi jami foydalanuvchilar */
  totalUsers: number;
  /** Umumiy hajm: panel so'rovlari + davomat skanlari */
  volume: number;
}

/**
 * Faollik bali (0–100): 45% — faol kunlar ulushi, 30% — faol foydalanuvchilar
 * ulushi, 25% — hajm (log shkala, ~kuniga 100 ta so'rov/skan = maksimum).
 */
export function engagementScore(input: EngagementInput): number {
  const { activeDays, periodDays, activeUsers, totalUsers, volume } = input;
  const dayRatio = periodDays > 0 ? Math.min(1, activeDays / periodDays) : 0;
  const userRatio = totalUsers > 0 ? Math.min(1, activeUsers / totalUsers) : 0;
  const perDay = activeDays > 0 ? volume / activeDays : 0;
  const volumeRatio = Math.min(1, Math.log10(1 + perDay) / 2);
  return Math.round(100 * (0.45 * dayRatio + 0.3 * userRatio + 0.25 * volumeRatio));
}

export function engagementLevel(score: number): EngagementLevel {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 1) return 'low';
  return 'inactive';
}

/**
 * Churn xavfi: oxirgi faollikdan o'tgan kunlar (>14 → high, >7 → medium),
 * yoki davr ichida hajm keskin pasaygan bo'lsa (trend ≤ -50% → high, ≤ -25% → medium).
 * Hech qachon faollik bo'lmagan kompaniya — 'none' (yangi ro'yxatdan o'tgan bo'lishi mumkin).
 */
export function churnRisk(
  daysSinceActivity: number | null,
  trendPct: number,
  hadActivity: boolean,
): ChurnRisk {
  if (daysSinceActivity === null) return 'none';
  if (daysSinceActivity > 14) return 'high';
  if (daysSinceActivity > 7) return 'medium';
  if (hadActivity && trendPct <= -50) return 'high';
  if (hadActivity && trendPct <= -25) return 'medium';
  return 'low';
}

/** Jadval tartibi: xavfi yuqori → balli past birinchi ko'rinsin */
export const CHURN_RISK_WEIGHT: Record<ChurnRisk, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
