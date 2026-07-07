/**
 * Timezone yordamchilari — tashqi kutubxonasiz, Intl API orqali.
 * Kompaniya timezone'i (default: Asia/Tashkent) bo'yicha hisob-kitoblar.
 */

function formatParts(date: Date, timeZone: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') {
      out[part.type] = parseInt(part.value, 10);
    }
  }
  // Intl ba'zan 24:xx qaytaradi
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Berilgan vaqtda timezone'ning UTC'dan siljishi (daqiqa) */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const p = formatParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** 'YYYY-MM-DD' + 'HH:mm' (timezone'da) → UTC Date */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const guess = Date.parse(`${dateStr}T${timeStr}:00Z`);
  const offset = tzOffsetMinutes(timeZone, new Date(guess));
  return new Date(guess - offset * 60000);
}

/** Date → 'YYYY-MM-DD' (timezone bo'yicha) */
export function dateStrInTz(date: Date, timeZone: string): string {
  const p = formatParts(date, timeZone);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** Date → timezone bo'yicha yarim tundan o'tgan daqiqalar */
export function minutesFromMidnightInTz(date: Date, timeZone: string): number {
  const p = formatParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** Date → hafta kuni 1..7 (Dushanba=1), timezone bo'yicha */
export function dayOfWeekInTz(date: Date, timeZone: string): number {
  const dateStr = dateStrInTz(date, timeZone);
  const utcDay = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Yakshanba
  return utcDay === 0 ? 7 : utcDay;
}

/** 'HH:mm' → daqiqalar */
export function timeStrToMinutes(time: string): number {
  const [h, m] = time.split(':').map((v) => parseInt(v, 10));
  return h * 60 + m;
}

/** 'YYYY-MM-DD' sanaga kun qo'shish */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' → oydagi barcha 'YYYY-MM-DD' sanalar */
export function datesOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map((v) => parseInt(v, 10));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from(
    { length: daysInMonth },
    (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
  );
}

/** O'tgan oy 'YYYY-MM' (timezone bo'yicha bugungi sanadan) */
export function previousMonth(timeZone: string, from: Date = new Date()): string {
  const today = dateStrInTz(from, timeZone);
  const [y, m] = today.split('-').map((v) => parseInt(v, 10));
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, '0')}`;
}
