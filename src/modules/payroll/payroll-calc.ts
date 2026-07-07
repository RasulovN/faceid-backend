import { BonusType, PenaltyType, SalaryType, WorkDayStatus } from '../../common/enums';

export interface CalcWorkDayRow {
  date: string;
  status: WorkDayStatus;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  /** Sababli (uzrli) kun — jarima qo'llanmaydi va bonusni buzmaydi. */
  isExcused?: boolean;
  excuseReason?: string | null;
}

export interface CalcPenaltyRule {
  type: PenaltyType;
  amount: number; // tiyin (LATE_SALARY/EARLY_LEAVE_SALARY uchun ishlatilmaydi)
  thresholdMinutes: number;
  /** LATE_SALARY / EARLY_LEAVE_SALARY uchun ko'paytuvchi (1 = 1 daqiqalik ish haqi) */
  multiplier?: number;
  isActive: boolean;
}

/** Bir oyni necha kun deb hisoblash (foydalanuvchi talabi: qat'iy 30 kun). */
export const PAYROLL_DAYS_IN_MONTH = 30;

export interface CalcBonusRule {
  type: BonusType;
  amount: number; // tiyin
  isActive: boolean;
}

export interface PayrollCalcInput {
  salaryType: SalaryType;
  /** FIXED: oylik (tiyin); HOURLY: soatlik stavka (tiyin) */
  salaryAmount: number;
  workDays: CalcWorkDayRow[];
  penaltyRules: CalcPenaltyRule[];
  bonusRules: CalcBonusRule[];
  overtimeMultiplier: number;
  /** Overtime (qo'shimcha ish) haqi to'lanadimi — nofaol bo'lsa qo'shilmaydi (default true). */
  overtimeActive?: boolean;
}

export interface PayrollBreakdownPenalty {
  date: string | null;
  type: PenaltyType;
  amount: number;
  note: string;
}

export interface PayrollBreakdownBonus {
  type: BonusType;
  amount: number;
  note: string;
}

export interface PayrollCalcResult {
  baseSalary: number;
  workedMinutes: number;
  overtimeAmount: number;
  penaltyAmount: number;
  bonusAmount: number;
  totalAmount: number;
  breakdown: Record<string, unknown>;
}

/**
 * Oylik hisob-kitobi (sof funksiya):
 * FIXED  → oylik / ishKunlariSoni * kelganKunlar − jarimalar + overtime + bonuslar
 * HOURLY → workedMinutes/60 * soatlikStavka + overtime ustamasi − jarimalar + bonuslar
 * Barcha summalar tiyin, natijalar butun songa yaxlitlanadi.
 */
export function calcPayroll(input: PayrollCalcInput): PayrollCalcResult {
  const days = [...input.workDays].sort((a, b) => a.date.localeCompare(b.date));
  const scheduledDays = days.filter((d) => d.scheduledMinutes > 0);
  const attendedDays = days.filter(
    (d) => d.status === WorkDayStatus.PRESENT || d.status === WorkDayStatus.LATE,
  );
  // Sababli (uzrli) kunlar jarima ham, bonus buzilishi ham hisobiga kirmaydi.
  const excusedDays = days.filter((d) => d.isExcused);
  const lateDays = days.filter((d) => d.status === WorkDayStatus.LATE && !d.isExcused);
  const absentDays = days.filter((d) => d.status === WorkDayStatus.ABSENT && !d.isExcused);
  const totalWorkedMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);
  const totalOvertimeMinutes = days.reduce((s, d) => s + d.overtimeMinutes, 0);
  const totalScheduledMinutes = days.reduce((s, d) => s + d.scheduledMinutes, 0);

  // ---------- Asosiy ish haqi ----------
  let baseSalary = 0;
  let overtimeAmount = 0;
  const dayRows: Array<Record<string, unknown>> = [];

  if (input.salaryType === SalaryType.FIXED) {
    const workDaysCount = scheduledDays.length;
    const dailyRate = workDaysCount > 0 ? input.salaryAmount / workDaysCount : 0;
    baseSalary = Math.round(dailyRate * attendedDays.length);
    const hourlyRate =
      totalScheduledMinutes > 0 ? input.salaryAmount / (totalScheduledMinutes / 60) : 0;
    overtimeAmount = Math.round(
      (totalOvertimeMinutes / 60) * hourlyRate * input.overtimeMultiplier,
    );
    for (const d of days) {
      dayRows.push({
        date: d.date,
        status: d.status,
        isExcused: d.isExcused ?? false,
        excuseReason: d.isExcused ? (d.excuseReason ?? null) : null,
        workedMinutes: d.workedMinutes,
        lateMinutes: d.lateMinutes,
        overtimeMinutes: d.overtimeMinutes,
        earned:
          d.status === WorkDayStatus.PRESENT || d.status === WorkDayStatus.LATE
            ? Math.round(dailyRate)
            : 0,
      });
    }
  } else {
    baseSalary = Math.round((totalWorkedMinutes / 60) * input.salaryAmount);
    // Overtime daqiqalar workedMinutes ichida 1x hisoblangan — ustama (multiplier − 1)
    overtimeAmount = Math.round(
      (totalOvertimeMinutes / 60) * input.salaryAmount * (input.overtimeMultiplier - 1),
    );
    for (const d of days) {
      dayRows.push({
        date: d.date,
        status: d.status,
        isExcused: d.isExcused ?? false,
        excuseReason: d.isExcused ? (d.excuseReason ?? null) : null,
        workedMinutes: d.workedMinutes,
        lateMinutes: d.lateMinutes,
        overtimeMinutes: d.overtimeMinutes,
        earned: Math.round((d.workedMinutes / 60) * input.salaryAmount),
      });
    }
  }

  // Overtime nofaol qilingan bo'lsa — qo'shimcha ish haqi to'lanmaydi.
  if (input.overtimeActive === false) overtimeAmount = 0;

  // Xodimning O'Z maoshiga asoslangan 1 DAQIQALIK ish haqi (tiyin, yaxlitlanmagan — aniqlik uchun).
  //  FIXED (oylik): oylik / 30 kun / kunlik smena daqiqalari  (= oylik/30/smenaSoati/60).
  //  HOURLY (soatlik): soatlik stavka / 60.
  const perMinuteWage = (dayScheduledMinutes: number): number => {
    if (input.salaryType === SalaryType.HOURLY) {
      return input.salaryAmount / 60;
    }
    if (dayScheduledMinutes <= 0) return 0;
    return input.salaryAmount / PAYROLL_DAYS_IN_MONTH / dayScheduledMinutes;
  };

  // ---------- Jarimalar ----------
  const penalties: PayrollBreakdownPenalty[] = [];
  for (const rule of input.penaltyRules.filter((r) => r.isActive)) {
    const mult = rule.multiplier ?? 1;
    switch (rule.type) {
      case PenaltyType.LATE_FIXED:
        for (const d of days) {
          if (!d.isExcused && d.lateMinutes > 0 && d.lateMinutes >= rule.thresholdMinutes) {
            penalties.push({
              date: d.date,
              type: rule.type,
              amount: rule.amount,
              note: `Kechikish ${d.lateMinutes} daqiqa — belgilangan jarima`,
            });
          }
        }
        break;
      case PenaltyType.LATE_PER_MINUTE:
        for (const d of days) {
          if (!d.isExcused && d.lateMinutes > 0 && d.lateMinutes >= rule.thresholdMinutes) {
            penalties.push({
              date: d.date,
              type: rule.type,
              amount: d.lateMinutes * rule.amount,
              note: `Kechikish ${d.lateMinutes} daqiqa × ${rule.amount} tiyin`,
            });
          }
        }
        break;
      case PenaltyType.LATE_SALARY:
        // Kechikkan har daqiqa uchun xodimning o'z 1-daqiqalik ish haqi ushlab qolinadi.
        for (const d of days) {
          if (!d.isExcused && d.lateMinutes > 0 && d.lateMinutes >= rule.thresholdMinutes) {
            const amount = Math.round(d.lateMinutes * perMinuteWage(d.scheduledMinutes) * mult);
            if (amount > 0) {
              penalties.push({
                date: d.date,
                type: rule.type,
                amount,
                note:
                  `Kechikish ${d.lateMinutes} daqiqa × daqiqalik ish haqi` +
                  (mult !== 1 ? ` × ${mult}` : ''),
              });
            }
          }
        }
        break;
      case PenaltyType.EARLY_LEAVE_SALARY:
        // Erta ketilgan har daqiqa uchun proporsional ushlab qolish.
        for (const d of days) {
          if (!d.isExcused && d.earlyLeaveMinutes > 0 && d.earlyLeaveMinutes >= rule.thresholdMinutes) {
            const amount = Math.round(
              d.earlyLeaveMinutes * perMinuteWage(d.scheduledMinutes) * mult,
            );
            if (amount > 0) {
              penalties.push({
                date: d.date,
                type: rule.type,
                amount,
                note:
                  `Erta ketish ${d.earlyLeaveMinutes} daqiqa × daqiqalik ish haqi` +
                  (mult !== 1 ? ` × ${mult}` : ''),
              });
            }
          }
        }
        break;
      case PenaltyType.ABSENT:
        for (const d of absentDays) {
          penalties.push({
            date: d.date,
            type: rule.type,
            amount: rule.amount,
            note: 'Sababsiz kelmagan kun',
          });
        }
        break;
      case PenaltyType.ABSENT_SALARY:
        // Sababsiz kelmagan har kun uchun bir kunlik ish haqi (oylik/30) ushlab qolinadi.
        for (const d of absentDays) {
          const amount = Math.round(perMinuteWage(d.scheduledMinutes) * d.scheduledMinutes * mult);
          if (amount > 0) {
            penalties.push({
              date: d.date,
              type: rule.type,
              amount,
              note: `Sababsiz kelmagan kun × 1 kunlik ish haqi` + (mult !== 1 ? ` × ${mult}` : ''),
            });
          }
        }
        break;
    }
  }
  const penaltyAmount = penalties.reduce((s, p) => s + p.amount, 0);

  // ---------- Bonuslar ----------
  const bonuses: PayrollBreakdownBonus[] = [];
  for (const rule of input.bonusRules.filter((r) => r.isActive)) {
    if (
      rule.type === BonusType.FULL_ATTENDANCE &&
      scheduledDays.length > 0 &&
      lateDays.length === 0 &&
      absentDays.length === 0 &&
      // Har bir ish kuni kelingan yoki sababli bo'lsa — bonus buzilmaydi.
      attendedDays.length + excusedDays.length >= scheduledDays.length
    ) {
      bonuses.push({
        type: rule.type,
        amount: rule.amount,
        note: 'To‘liq davomat — kechikish va qoldirishlarsiz',
      });
    }
    if (rule.type === BonusType.OVERTIME && totalOvertimeMinutes > 0) {
      bonuses.push({
        type: rule.type,
        amount: rule.amount,
        note: `Qo‘shimcha ish (${totalOvertimeMinutes} daqiqa) uchun bonus`,
      });
    }
  }
  const bonusAmount = bonuses.reduce((s, b) => s + b.amount, 0);

  const totalAmount = Math.max(0, baseSalary + overtimeAmount + bonusAmount - penaltyAmount);

  return {
    baseSalary,
    workedMinutes: totalWorkedMinutes,
    overtimeAmount,
    penaltyAmount,
    bonusAmount,
    totalAmount,
    breakdown: {
      salaryType: input.salaryType,
      contractAmount: input.salaryAmount,
      scheduledDays: scheduledDays.length,
      attendedDays: attendedDays.length,
      lateDays: lateDays.length,
      absentDays: absentDays.length,
      excusedDays: excusedDays.length,
      days: dayRows,
      penalties,
      bonuses,
      overtime: {
        minutes: totalOvertimeMinutes,
        multiplier: input.overtimeMultiplier,
        amount: overtimeAmount,
      },
    },
  };
}
