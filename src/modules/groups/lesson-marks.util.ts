import { LessonDay } from '../../entities/group.entity';
import { timeStrToMinutes } from '../../common/utils/tz.util';

/** Darsdan necha daqiqa OLDIN kelish ham shu darsga yozilishi mumkin */
export const LESSON_EARLY_WINDOW_MINUTES = 60;

export type JournalMark = 'PRESENT' | 'LATE' | 'ABSENT' | null;

/**
 * Bitta o'quvchi-kun-dars uchun jurnal belgisi (GroupsService.journal va
 * ota-ona Mini App kabineti bitta mantiqdan foydalanadi):
 * event bor → PRESENT/LATE (guruhga bog'lanmagan event faqat dars oynasida hisoblanadi);
 * yo'q → o'tgan dars ABSENT, kelajakdagi/hali tugamagani null.
 */
export function computeLessonMark(opts: {
  /** O'quvchining shu kundagi birinchi CHECK_IN eventi (tz bo'yicha daqiqada) */
  event?: { minutes: number; sameGroup: boolean } | null;
  day: LessonDay;
  gracePeriodMinutes: number;
  date: string;
  today: string;
  /** Hozirgi vaqt (tz bo'yicha yarim tundan daqiqa) */
  nowMin: number;
}): JournalMark {
  const start = timeStrToMinutes(opts.day.startTime);
  const end = timeStrToMinutes(opts.day.endTime);
  const absentOrPending = (): JournalMark => {
    if (opts.date > opts.today) return null;
    if (opts.date === opts.today && opts.nowMin <= end) return null;
    return 'ABSENT';
  };
  if (opts.event) {
    if (!opts.event.sameGroup) {
      if (
        opts.event.minutes < start - LESSON_EARLY_WINDOW_MINUTES ||
        opts.event.minutes > end
      ) {
        return absentOrPending();
      }
    }
    return opts.event.minutes > start + opts.gracePeriodMinutes ? 'LATE' : 'PRESENT';
  }
  return absentOrPending();
}

/** 'YYYY-MM-DD' → hafta kuni 1..7 (Dushanba=1) */
export function dowOfDateStr(date: string): number {
  const utcDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}
