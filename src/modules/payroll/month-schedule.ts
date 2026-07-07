import { ScheduleDay } from '../../entities/work-schedule.entity';
import { scheduledMinutesOf } from '../workdays/workday-calc';

export interface MonthScheduleStats {
  /** Oy bo'yicha kutilgan SOF ish daqiqalari (tushlik chiqarilgan, bayramlarsiz) */
  expectedMinutes: number;
  /** Oy bo'yicha ish kunlari soni (bayramlarsiz) */
  workingDays: number;
}

/**
 * Grafik + oy → oyning haqiqiy ish vaqti. VAQT = PUL stavkalarining asosi:
 * masalan Dush–Juma 09:00–18:00 (tushlik 1s) iyulda: 23 ish kuni × 8s = 184 soat.
 * Bayram kunlari ish kuni hisobidan chiqariladi.
 */
export function monthScheduleStats(
  scheduleDays: ScheduleDay[],
  month: string, // 'YYYY-MM'
  holidayDates: ReadonlySet<string>,
): MonthScheduleStats {
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  let expectedMinutes = 0;
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    if (holidayDates.has(dateStr)) continue;
    const utcDow = new Date(Date.UTC(year, mon - 1, day)).getUTCDay(); // 0 = Yakshanba
    const dayOfWeek = utcDow === 0 ? 7 : utcDow;
    const scheduleDay = scheduleDays.find((d) => d.dayOfWeek === dayOfWeek);
    if (!scheduleDay) continue;
    const minutes = scheduledMinutesOf(scheduleDay);
    if (minutes > 0) {
      expectedMinutes += minutes;
      workingDays++;
    }
  }
  return { expectedMinutes, workingDays };
}

/** Oyning [birinchi kun, keyingi oy birinchi kuni) chegaralari */
export function monthBounds(month: string): { monthStart: string; nextMonthStart: string } {
  const [year, mon] = month.split('-').map(Number);
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  return {
    monthStart: `${month}-01`,
    nextMonthStart: `${nextYear}-${String(nextMon).padStart(2, '0')}-01`,
  };
}
