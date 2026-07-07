import { AttendanceEventType, EmployeeStatus, WorkDayStatus } from '../../common/enums';
import { ScheduleDay } from '../../entities/work-schedule.entity';
import { timeStrToMinutes } from '../../common/utils/tz.util';

export interface CalcEvent {
  type: AttendanceEventType;
  /** Kompaniya timezone'ida yarim tundan o'tgan daqiqalar */
  minutes: number;
}

export interface WorkDayCalcInput {
  scheduleDay: ScheduleDay | null;
  gracePeriodMinutes: number;
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

/**
 * Bir kunlik davomat hisobi (sof funksiya, testlanadigan):
 * - lateMinutes: birinchi CHECK_IN grafik boshlanishidan (grace'dan keyin) qancha kech
 * - earlyLeaveMinutes: oxirgi CHECK_OUT grafik tugashidan qancha erta
 * - overtimeMinutes: oxirgi CHECK_OUT grafik tugashidan qancha kech
 * - workedMinutes: IN→OUT juftliklar yig'indisi minus tanaffus
 */
export function calcWorkDay(input: WorkDayCalcInput): WorkDayCalcResult {
  const { scheduleDay, gracePeriodMinutes, events, employeeStatus } = input;

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

  const worked = pairWorkedMinutes(sorted, input.nowMinutes, scheduleDay);
  const firstIn = sorted.find((e) => e.type === AttendanceEventType.CHECK_IN);
  const lastOut = [...sorted].reverse().find((e) => e.type === AttendanceEventType.CHECK_OUT);

  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let overtimeMinutes = 0;

  if (scheduleDay) {
    const start = timeStrToMinutes(scheduleDay.startTime);
    const end = timeStrToMinutes(scheduleDay.endTime);
    if (firstIn && firstIn.minutes > start + gracePeriodMinutes) {
      lateMinutes = firstIn.minutes - start;
    }
    if (lastOut) {
      if (lastOut.minutes < end) earlyLeaveMinutes = end - lastOut.minutes;
      if (lastOut.minutes > end) overtimeMinutes = lastOut.minutes - end;
    }
  }

  const breakMinutes = scheduleDay?.breakMinutes ?? 0;
  const workedNet = Math.max(0, worked - (worked > breakMinutes ? breakMinutes : 0));

  return {
    scheduledMinutes: scheduled,
    workedMinutes: workedNet,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    status: lateMinutes > 0 ? WorkDayStatus.LATE : WorkDayStatus.PRESENT,
  };
}

export function scheduledMinutesOf(day: ScheduleDay): number {
  return Math.max(
    0,
    timeStrToMinutes(day.endTime) - timeStrToMinutes(day.startTime) - (day.breakMinutes ?? 0),
  );
}

/** IN→OUT juftliklarni yig'adi; yopilmagan IN oxirida grafik tugashi/hozirgi vaqt bilan cheklanadi */
function pairWorkedMinutes(
  sorted: CalcEvent[],
  nowMinutes: number | undefined,
  scheduleDay: ScheduleDay | null,
): number {
  let total = 0;
  let openIn: number | null = null;
  for (const event of sorted) {
    if (event.type === AttendanceEventType.CHECK_IN) {
      if (openIn === null) openIn = event.minutes;
    } else if (openIn !== null) {
      total += Math.max(0, event.minutes - openIn);
      openIn = null;
    }
  }
  if (openIn !== null) {
    const scheduleEnd = scheduleDay ? timeStrToMinutes(scheduleDay.endTime) : null;
    const cap =
      nowMinutes !== undefined
        ? scheduleEnd !== null
          ? Math.min(Math.max(nowMinutes, openIn), scheduleEnd)
          : Math.max(nowMinutes, openIn)
        : (scheduleEnd ?? openIn);
    total += Math.max(0, cap - openIn);
  }
  return total;
}
