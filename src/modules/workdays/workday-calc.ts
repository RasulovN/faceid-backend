import { AttendanceEventType, EmployeeStatus, WorkDayStatus } from '../../common/enums';
import { ScheduleDay } from '../../entities/work-schedule.entity';
import { timeStrToMinutes } from '../../common/utils/tz.util';

export interface CalcEvent {
  type: AttendanceEventType;
  /**
   * Kompaniya timezone'ida yarim tundan o'tgan daqiqalar.
   * Tungi (yarim tundan o'tuvchi) smenada keyingi kun eventlari +1440 bilan beriladi.
   */
  minutes: number;
}

export interface WorkDayCalcInput {
  scheduleDay: ScheduleDay | null;
  gracePeriodMinutes: number;
  /** Moslashuvchan kelish oynasi (daqiqa): start..start+flexible — kechikish emas */
  flexibleMinutes?: number;
  events: CalcEvent[];
  employeeStatus: EmployeeStatus;
  /** Hisob paytidagi joriy daqiqa (agar kun hali tugamagan bo'lsa ochiq intervalni cheklash uchun) */
  nowMinutes?: number;
}

export interface WorkDayCalcResult {
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  status: WorkDayStatus;
}

/** Smena chegaralari: endTime <= startTime bo'lsa tungi smena — end +24h */
export function shiftBounds(day: ScheduleDay): { start: number; end: number } {
  const start = timeStrToMinutes(day.startTime);
  let end = timeStrToMinutes(day.endTime);
  if (end <= start) end += 1440; // yarim tundan o'tuvchi smena
  return { start, end };
}

export function crossesMidnight(day: ScheduleDay): boolean {
  return timeStrToMinutes(day.endTime) <= timeStrToMinutes(day.startTime);
}

/** Tushlik oynasi (mutlaq daqiqalarda, smena ichiga qirqilgan); yo'q bo'lsa null */
function lunchWindow(day: ScheduleDay): { from: number; to: number } | null {
  if (!day.lunchStart || !day.lunchEnd) return null;
  const { start, end } = shiftBounds(day);
  let from = timeStrToMinutes(day.lunchStart);
  let to = timeStrToMinutes(day.lunchEnd);
  // Tungi smenada tushlik yarim tundan keyin bo'lishi mumkin (masalan 02:00-02:30)
  if (from < start) {
    from += 1440;
    to += 1440;
  } else if (to <= from) {
    to += 1440; // tushlikning o'zi yarim tundan o'tadi
  }
  const clampedFrom = Math.max(start, Math.min(from, end));
  const clampedTo = Math.max(start, Math.min(to, end));
  if (clampedTo <= clampedFrom) return null;
  return { from: clampedFrom, to: clampedTo };
}

/** Kunlik rejalashtirilgan SOF ish daqiqalari (tushlik chiqarilgan) */
export function scheduledMinutesOf(day: ScheduleDay): number {
  const { start, end } = shiftBounds(day);
  const lunch = lunchWindow(day);
  const lunchMinutes = lunch ? lunch.to - lunch.from : (day.breakMinutes ?? 0);
  return Math.max(0, end - start - lunchMinutes);
}

/** [a1,a2] va [b1,b2] intervallar kesishmasi (daqiqa) */
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * Bir kunlik davomat hisobi (sof funksiya, testlanadigan):
 * - lateMinutes: birinchi CHECK_IN (start + flexible) dan qancha kech; grace ichida bo'lsa 0
 * - flexible oynada kelinsa kutilgan ketish vaqti mos ravishda suriladi (haqiqiy flextime)
 * - earlyLeaveMinutes / overtimeMinutes: kutilgan ketish vaqtiga nisbatan
 * - workedMinutes: IN→OUT juftliklar yig'indisi minus tushlik oynasi bilan kesishma
 * - tungi smena (end <= start) qo'llab-quvvatlanadi — keyingi kun eventlari +1440
 */
export function calcWorkDay(input: WorkDayCalcInput): WorkDayCalcResult {
  const { scheduleDay, gracePeriodMinutes, events, employeeStatus } = input;
  const flexible = Math.max(0, input.flexibleMinutes ?? 0);

  if (employeeStatus === EmployeeStatus.VACATION) {
    return {
      scheduledMinutes: scheduleDay ? scheduledMinutesOf(scheduleDay) : 0,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      status: WorkDayStatus.VACATION,
    };
  }

  const sorted = [...events].sort((a, b) => a.minutes - b.minutes);
  const scheduled = scheduleDay ? scheduledMinutesOf(scheduleDay) : 0;

  if (sorted.length === 0) {
    return {
      scheduledMinutes: scheduled,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      status: scheduled > 0 ? WorkDayStatus.ABSENT : WorkDayStatus.PRESENT,
    };
  }

  const firstIn = sorted.find((e) => e.type === AttendanceEventType.CHECK_IN);
  const lastOut = [...sorted].reverse().find((e) => e.type === AttendanceEventType.CHECK_OUT);

  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let overtimeMinutes = 0;
  let requiredEnd: number | null = null;

  if (scheduleDay) {
    const { start, end } = shiftBounds(scheduleDay);
    // Flexible: start..start+flexible oynada kelish kechikish emas,
    // lekin kutilgan ketish vaqti kelish siljishiga mos suriladi.
    const arrivalOffset = firstIn
      ? Math.max(0, Math.min(firstIn.minutes - start, flexible))
      : 0;
    requiredEnd = end + arrivalOffset;

    if (firstIn) {
      const rawLate = Math.max(0, firstIn.minutes - (start + flexible));
      // Grace — kichik kechikish e'tiborga olinmaydi (masalan <= 5 daqiqa)
      lateMinutes = rawLate > gracePeriodMinutes ? rawLate : 0;
    }
    if (lastOut) {
      if (lastOut.minutes < requiredEnd) earlyLeaveMinutes = requiredEnd - lastOut.minutes;
      if (lastOut.minutes > requiredEnd) overtimeMinutes = lastOut.minutes - requiredEnd;
    }
  }

  const worked = pairWorkedMinutes(sorted, input.nowMinutes, scheduleDay, requiredEnd);

  return {
    scheduledMinutes: scheduled,
    workedMinutes: worked,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    status: lateMinutes > 0 ? WorkDayStatus.LATE : WorkDayStatus.PRESENT,
  };
}

/**
 * IN→OUT juftliklarni yig'adi; yopilmagan IN oxirida kutilgan tugash/hozirgi vaqt bilan cheklanadi.
 * Tushlik oynasi bilan kesishgan vaqt chiqariladi (oyna yo'q bo'lsa legacy breakMinutes).
 */
function pairWorkedMinutes(
  sorted: CalcEvent[],
  nowMinutes: number | undefined,
  scheduleDay: ScheduleDay | null,
  requiredEnd: number | null,
): number {
  const lunch = scheduleDay ? lunchWindow(scheduleDay) : null;
  const intervals: Array<[number, number]> = [];
  let openIn: number | null = null;
  for (const event of sorted) {
    if (event.type === AttendanceEventType.CHECK_IN) {
      if (openIn === null) openIn = event.minutes;
    } else if (openIn !== null) {
      if (event.minutes > openIn) intervals.push([openIn, event.minutes]);
      openIn = null;
    }
  }
  if (openIn !== null) {
    const scheduleEnd = requiredEnd;
    const cap =
      nowMinutes !== undefined
        ? scheduleEnd !== null
          ? Math.min(Math.max(nowMinutes, openIn), scheduleEnd)
          : Math.max(nowMinutes, openIn)
        : (scheduleEnd ?? openIn);
    if (cap > openIn) intervals.push([openIn, cap]);
  }

  let total = intervals.reduce((s, [a, b]) => s + (b - a), 0);
  if (lunch) {
    // Tushlik oynasiga to'g'ri kelgan ish vaqti hisobga olinmaydi
    const lunchOverlap = intervals.reduce(
      (s, [a, b]) => s + overlap(a, b, lunch.from, lunch.to),
      0,
    );
    total -= lunchOverlap;
  } else if (scheduleDay?.breakMinutes) {
    // Legacy: oyna ko'rsatilmagan grafikda flat tanaffus chiqariladi
    total = total > scheduleDay.breakMinutes ? total - scheduleDay.breakMinutes : total;
  }
  return Math.max(0, total);
}
