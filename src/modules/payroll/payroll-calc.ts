import {
  BonusType,
  PayrollAdjustmentType,
  SalaryType,
  WorkDayStatus,
} from '../../common/enums';

/**
 * VAQT = PUL payroll engine (time-v2).
 *
 * Tamoyil: jarima ham, bonus ham FOIZdan emas, faqat REAL VAQT qiymatidan hisoblanadi.
 *   Soatlik stavka  = oylik maosh / oyning haqiqiy ish soatlari (masalan 22 kun × 8s = 176s)
 *   Daqiqa stavkasi = soatlik / 60
 *   Kunlik stavka   = oylik maosh / oyning ish kunlari soni
 *
 *   Kechikish / erta ketish  → daqiqa × daqiqa stavkasi
 *   Sababsiz kelmaslik       → 1 kunlik stavka
 *   Yarim kundan kam ish     → kamida kunlik stavkaning yarmi
 *   Overtime                 → daqiqa × daqiqa stavkasi × koeffitsiyent (1.5x)
 *   Dam olish kuni ishlash   → daqiqa × daqiqa stavkasi × weekend koeffitsiyenti (2x)
 *   Bayram kuni ishlash      → daqiqa × daqiqa stavkasi × bayram koeffitsiyenti (2x/3x)
 *
 * Har bir summa uchun `formula` matni saqlanadi — foydalanuvchi "qanday hisoblandi"
 * ni ko'ra oladi (shaffoflik).
 */

// ---------- Kirish turlari ----------

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

/** Jarima siyosati (rules jadvalidan yig'iladi) — faqat VAQT asosida ishlaydi */
export interface PayrollPenaltyPolicy {
  /** Qoida faolmi (o'chirilgan bo'lsa bu tur jarima yozilmaydi) */
  active: boolean;
  /** Shu daqiqadan KAM kechikish/erta ketish jarima olmaydi (grace'dan tashqari qo'shimcha chegara) */
  thresholdMinutes: number;
  /** 1 = aynan vaqt qiymati; >1 — kuchaytirilgan jarima */
  multiplier: number;
}

export interface PayrollPolicy {
  /** Overtime haqi to'lanadimi */
  overtimeActive: boolean;
  /** Ish kuni overtime koeffitsiyenti (masalan 1.5) */
  weekdayOvertimeMultiplier: number;
  /** Dam olish kuni ishlaganlik koeffitsiyenti (masalan 2) */
  weekendMultiplier: number;
  /** Bayram kuni ishlaganlik koeffitsiyenti (masalan 2 yoki 3) */
  holidayMultiplier: number;
  late: PayrollPenaltyPolicy;
  earlyLeave: PayrollPenaltyPolicy;
  absent: PayrollPenaltyPolicy;
}

export interface CalcBonusRule {
  type: BonusType;
  amount: number; // tiyin
  isActive: boolean;
}

export interface CalcAdjustment {
  type: PayrollAdjustmentType;
  amount: number; // tiyin (musbat)
  note?: string | null;
}

export interface PayrollCalcInput {
  salaryType: SalaryType;
  /** FIXED: oylik (tiyin); HOURLY: soatlik stavka (tiyin) */
  salaryAmount: number;
  /** TO'LIQ oy bo'yicha kutilgan SOF ish daqiqalari (tushlik chiqarilgan, bayramlar olib tashlangan) */
  monthExpectedMinutes: number;
  /** TO'LIQ oy bo'yicha ish kunlari soni (bayramlar olib tashlangan) */
  monthWorkingDays: number;
  /** Oy ichidagi bayram sanalari ('YYYY-MM-DD') */
  holidayDates: string[];
  workDays: CalcWorkDayRow[];
  policy: PayrollPolicy;
  bonusRules: CalcBonusRule[];
  adjustments: CalcAdjustment[];
}

// ---------- Natija turlari ----------

export type PenaltyKind = 'LATE' | 'EARLY_LEAVE' | 'ABSENT' | 'HALF_DAY';
export type UnpaidKind = 'EXCUSED' | 'VACATION' | 'SICK' | 'ABSENT_UNPAID';
export type OvertimeKind = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';
export type DayType = 'WORK' | 'WEEKEND' | 'HOLIDAY';

export interface PenaltyLine {
  date: string;
  kind: PenaltyKind;
  minutes: number | null;
  multiplier: number;
  amount: number; // tiyin
  formula: string;
}

export interface UnpaidLine {
  date: string;
  kind: UnpaidKind;
  amount: number;
  formula: string;
}

export interface OvertimeLine {
  date: string;
  kind: OvertimeKind;
  minutes: number;
  multiplier: number;
  amount: number;
  formula: string;
}

export interface BonusLine {
  type: string;
  amount: number;
  note: string;
}

export interface AdjustmentLine {
  type: PayrollAdjustmentType;
  amount: number;
  note: string | null;
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

// ---------- Yordamchilar ----------

/** tiyin → "12 345.67" so'm (formula matnlari uchun) */
function som(tiyin: number): string {
  const value = tiyin / 100;
  const rounded = Math.round(value * 100) / 100;
  const [whole, frac] = rounded.toFixed(2).split('.');
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac === '00' ? spaced : `${spaced}.${frac}`;
}

function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h} soat ${m} daqiqa`;
  if (h > 0) return `${h} soat`;
  return `${m} daqiqa`;
}

const DEFAULT_PENALTY_POLICY: PayrollPenaltyPolicy = {
  active: true,
  thresholdMinutes: 0,
  multiplier: 1,
};

export function defaultPolicy(overrides: Partial<PayrollPolicy> = {}): PayrollPolicy {
  return {
    overtimeActive: true,
    weekdayOvertimeMultiplier: 1.5,
    weekendMultiplier: 2,
    holidayMultiplier: 2,
    late: { ...DEFAULT_PENALTY_POLICY },
    earlyLeave: { ...DEFAULT_PENALTY_POLICY },
    absent: { ...DEFAULT_PENALTY_POLICY },
    ...overrides,
  };
}

// ---------- Asosiy hisob ----------

export function calcPayroll(input: PayrollCalcInput): PayrollCalcResult {
  const days = [...input.workDays].sort((a, b) => a.date.localeCompare(b.date));
  const holidaySet = new Set(input.holidayDates);
  const policy = input.policy;
  const isFixed = input.salaryType === SalaryType.FIXED;

  // ---------- Stavkalar (VAQT = PUL asosi) ----------
  const E = Math.max(0, input.monthExpectedMinutes);
  const D = Math.max(0, input.monthWorkingDays);
  // FIXED: daqiqa stavkasi = oylik / oy daqiqalari. HOURLY: soatlik / 60.
  const minuteRate = isFixed ? (E > 0 ? input.salaryAmount / E : 0) : input.salaryAmount / 60;
  const hourlyRate = minuteRate * 60;
  const dailyRate = isFixed ? (D > 0 ? input.salaryAmount / D : 0) : 0;

  // ---------- Kun turlari va yig'indilar ----------
  const dayTypeOf = (d: CalcWorkDayRow): DayType =>
    holidaySet.has(d.date) ? 'HOLIDAY' : d.scheduledMinutes > 0 ? 'WORK' : 'WEEKEND';

  const scheduledRows = days.filter((d) => dayTypeOf(d) === 'WORK');
  const attendedRows = scheduledRows.filter(
    (d) => d.status === WorkDayStatus.PRESENT || d.status === WorkDayStatus.LATE,
  );
  const lateRows = scheduledRows.filter((d) => d.status === WorkDayStatus.LATE && !d.isExcused);
  const absentRows = scheduledRows.filter((d) => d.status === WorkDayStatus.ABSENT && !d.isExcused);
  const excusedRows = days.filter((d) => d.isExcused);

  const totalWorkedMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);

  // ---------- Jarimalar va to'lanmaydigan vaqt ----------
  const penalties: PenaltyLine[] = [];
  const unpaid: UnpaidLine[] = [];
  /** kun → shu kunda ushlangan jami (day cap uchun) */
  const dayDeductions = new Map<string, number>();

  const pushPenalty = (line: PenaltyLine) => {
    if (line.amount <= 0) return;
    penalties.push(line);
    dayDeductions.set(line.date, (dayDeductions.get(line.date) ?? 0) + line.amount);
  };

  if (isFixed && minuteRate > 0) {
    for (const d of scheduledRows) {
      const dayCap = Math.round(
        dailyRate * Math.max(1, policy.late.multiplier, policy.earlyLeave.multiplier, policy.absent.multiplier),
      );

      // --- Kelmagan kun ---
      if (d.status === WorkDayStatus.ABSENT) {
        if (d.isExcused) {
          unpaid.push({
            date: d.date,
            kind: 'EXCUSED',
            amount: Math.round(dailyRate),
            formula: `Sababli kun (ishlanmagan): oylik ${som(input.salaryAmount)} / ${D} ish kuni = ${som(dailyRate)} so'm (jarima YO'Q)`,
          });
        } else if (policy.absent.active) {
          const amount = Math.round(dailyRate * policy.absent.multiplier);
          pushPenalty({
            date: d.date,
            kind: 'ABSENT',
            minutes: d.scheduledMinutes,
            multiplier: policy.absent.multiplier,
            amount,
            formula:
              `Sababsiz kelmagan kun: oylik ${som(input.salaryAmount)} / ${D} ish kuni = ${som(dailyRate)} so'm` +
              (policy.absent.multiplier !== 1 ? ` × ${policy.absent.multiplier}` : ''),
          });
        } else {
          // Jarima o'chirilgan bo'lsa ham ishlanmagan kun to'lanmaydi (VAQT = PUL)
          unpaid.push({
            date: d.date,
            kind: 'ABSENT_UNPAID',
            amount: Math.round(dailyRate),
            formula: `Kelmagan kun (jarima qoidasi o'chirilgan): 1 kunlik = ${som(dailyRate)} so'm to'lanmaydi`,
          });
        }
        continue;
      }

      // --- Ta'til / kasallik — to'lanmaydi, jarima yo'q ---
      if (d.status === WorkDayStatus.VACATION || d.status === WorkDayStatus.SICK) {
        unpaid.push({
          date: d.date,
          kind: d.status === WorkDayStatus.VACATION ? 'VACATION' : 'SICK',
          amount: Math.round(dailyRate),
          formula: `${d.status === WorkDayStatus.VACATION ? "Ta'til" : 'Kasallik'} kuni: 1 kunlik = ${som(dailyRate)} so'm (ish haqi fondidan emas)`,
        });
        continue;
      }

      // --- Kelgan kun: kechikish / erta ketish / yarim kun ---
      if (d.isExcused) continue; // sababli kun — jarima yo'q

      let dayPenalty = 0;

      if (
        policy.late.active &&
        d.lateMinutes > 0 &&
        d.lateMinutes >= policy.late.thresholdMinutes
      ) {
        const amount = Math.round(d.lateMinutes * minuteRate * policy.late.multiplier);
        dayPenalty += amount;
        pushPenalty({
          date: d.date,
          kind: 'LATE',
          minutes: d.lateMinutes,
          multiplier: policy.late.multiplier,
          amount,
          formula:
            `Kechikish ${minutesLabel(d.lateMinutes)}: ${d.lateMinutes} daqiqa × ${som(minuteRate)} so'm/daqiqa` +
            (policy.late.multiplier !== 1 ? ` × ${policy.late.multiplier}` : '') +
            ` = ${som(amount)} so'm`,
        });
      }

      if (
        policy.earlyLeave.active &&
        d.earlyLeaveMinutes > 0 &&
        d.earlyLeaveMinutes >= policy.earlyLeave.thresholdMinutes
      ) {
        const amount = Math.round(d.earlyLeaveMinutes * minuteRate * policy.earlyLeave.multiplier);
        dayPenalty += amount;
        pushPenalty({
          date: d.date,
          kind: 'EARLY_LEAVE',
          minutes: d.earlyLeaveMinutes,
          multiplier: policy.earlyLeave.multiplier,
          amount,
          formula:
            `Erta ketish ${minutesLabel(d.earlyLeaveMinutes)}: ${d.earlyLeaveMinutes} daqiqa × ${som(minuteRate)} so'm/daqiqa` +
            (policy.earlyLeave.multiplier !== 1 ? ` × ${policy.earlyLeave.multiplier}` : '') +
            ` = ${som(amount)} so'm`,
        });
      }

      // Yarim kundan kam ishlangan bo'lsa — ushlanma kamida yarim kunlik bo'ladi
      if (
        policy.absent.active &&
        d.scheduledMinutes > 0 &&
        d.workedMinutes < d.scheduledMinutes / 2
      ) {
        const halfDay = Math.round(dailyRate / 2);
        const topUp = halfDay - dayPenalty;
        if (topUp > 0) {
          dayPenalty += topUp;
          pushPenalty({
            date: d.date,
            kind: 'HALF_DAY',
            minutes: Math.max(0, d.scheduledMinutes - d.workedMinutes),
            multiplier: 1,
            amount: topUp,
            formula:
              `Yarim kundan kam ishlangan (${minutesLabel(d.workedMinutes)} / ${minutesLabel(d.scheduledMinutes)}): ` +
              `ushlanma yarim kunlikgacha to'ldirildi — ${som(dailyRate)} / 2 = ${som(halfDay)} so'm`,
          });
        }
      }

      // Kun bo'yicha jami ushlanma kunlik stavkadan (×koef) oshmasin
      const already = dayDeductions.get(d.date) ?? 0;
      if (already > dayCap) {
        let excess = already - dayCap;
        // Oxirgi yozuvlardan qirqamiz
        for (let i = penalties.length - 1; i >= 0 && excess > 0; i--) {
          if (penalties[i].date !== d.date) continue;
          const cut = Math.min(penalties[i].amount, excess);
          penalties[i].amount -= cut;
          penalties[i].formula += ` (kunlik chegara ${som(dayCap)} so'mgacha qirqildi)`;
          excess -= cut;
          dayDeductions.set(d.date, (dayDeductions.get(d.date) ?? 0) - cut);
        }
      }
    }
  }

  // Qirqishdan keyin nolga tushgan yozuvlarni chiqarib tashlaymiz
  const finalPenalties = penalties.filter((p) => p.amount > 0);
  const penaltyAmount = finalPenalties.reduce((s, p) => s + p.amount, 0);
  const unpaidAmount = unpaid.reduce((s, u) => s + u.amount, 0);

  // ---------- Overtime / dam olish / bayram to'lovlari ----------
  const overtimePay: OvertimeLine[] = [];
  if (policy.overtimeActive && minuteRate > 0) {
    for (const d of days) {
      const type = dayTypeOf(d);
      if (type === 'WORK' && d.overtimeMinutes > 0) {
        // FIXED: to'liq koeffitsiyent (baza faqat grafik vaqtini qoplaydi).
        // HOURLY: worked ichida 1x to'langan — faqat ustama (k − 1).
        const k = isFixed
          ? policy.weekdayOvertimeMultiplier
          : policy.weekdayOvertimeMultiplier - 1;
        const amount = Math.round(d.overtimeMinutes * minuteRate * k);
        if (amount > 0) {
          overtimePay.push({
            date: d.date,
            kind: 'WEEKDAY',
            minutes: d.overtimeMinutes,
            multiplier: policy.weekdayOvertimeMultiplier,
            amount,
            formula:
              `Overtime ${minutesLabel(d.overtimeMinutes)}: ${d.overtimeMinutes} daqiqa × ${som(minuteRate)} so'm/daqiqa × ${policy.weekdayOvertimeMultiplier}` +
              (isFixed ? '' : ' (bazada 1x to‘langan, bu — ustama)') +
              ` = ${som(amount)} so'm`,
          });
        }
      } else if (type !== 'WORK' && d.workedMinutes > 0) {
        const mult = type === 'HOLIDAY' ? policy.holidayMultiplier : policy.weekendMultiplier;
        const k = isFixed ? mult : mult - 1;
        const amount = Math.round(d.workedMinutes * minuteRate * k);
        if (amount > 0) {
          overtimePay.push({
            date: d.date,
            kind: type === 'HOLIDAY' ? 'HOLIDAY' : 'WEEKEND',
            minutes: d.workedMinutes,
            multiplier: mult,
            amount,
            formula:
              `${type === 'HOLIDAY' ? 'Bayram' : 'Dam olish'} kuni ish ${minutesLabel(d.workedMinutes)}: ` +
              `${d.workedMinutes} daqiqa × ${som(minuteRate)} so'm/daqiqa × ${mult} = ${som(amount)} so'm`,
          });
        }
      }
    }
  }
  const overtimeAmount = overtimePay.reduce((s, o) => s + o.amount, 0);

  // ---------- Asosiy ish haqi ----------
  let baseSalary: number;
  if (isFixed) {
    // Gross = to'liq oylik; ishlanmagan (to'lanmaydigan) kunlar undan chiqariladi.
    baseSalary = Math.max(0, input.salaryAmount - unpaidAmount);
  } else {
    // Soatbay: ishlagan har daqiqa 1x to'lanadi (ustamalar overtimePay'da)
    baseSalary = Math.round(totalWorkedMinutes * minuteRate);
  }

  // ---------- Bonuslar (qoidalar) ----------
  const bonuses: BonusLine[] = [];
  const totalOvertimeMinutes = days.reduce((s, d) => s + d.overtimeMinutes, 0);
  for (const rule of input.bonusRules.filter((r) => r.isActive)) {
    if (
      rule.type === BonusType.FULL_ATTENDANCE &&
      scheduledRows.length > 0 &&
      lateRows.length === 0 &&
      absentRows.length === 0 &&
      attendedRows.length + excusedRows.length >= scheduledRows.length
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
        note: `Qo‘shimcha ish (${minutesLabel(totalOvertimeMinutes)}) uchun bonus`,
      });
    }
  }

  // ---------- Tuzatishlar (avans / qarz / ushlanma / mukofot) ----------
  const adjustments: AdjustmentLine[] = input.adjustments.map((a) => ({
    type: a.type,
    amount: a.amount,
    note: a.note ?? null,
  }));
  const adjustmentBonus = adjustments
    .filter((a) => a.type === PayrollAdjustmentType.BONUS)
    .reduce((s, a) => s + a.amount, 0);
  const adjustmentDeduction = adjustments
    .filter((a) => a.type !== PayrollAdjustmentType.BONUS)
    .reduce((s, a) => s + a.amount, 0);

  const bonusAmount = bonuses.reduce((s, b) => s + b.amount, 0) + adjustmentBonus;

  // ---------- Yakuniy natija ----------
  const totalAmount = Math.max(
    0,
    baseSalary + overtimeAmount + bonusAmount - penaltyAmount - adjustmentDeduction,
  );

  // ---------- Kunlik jadval (UI uchun) ----------
  const dayRows = days.map((d) => {
    const type = dayTypeOf(d);
    const deducted =
      (dayDeductions.get(d.date) ?? 0) +
      unpaid.filter((u) => u.date === d.date).reduce((s, u) => s + u.amount, 0);
    const otEarned = overtimePay
      .filter((o) => o.date === d.date)
      .reduce((s, o) => s + o.amount, 0);
    return {
      date: d.date,
      status: d.status,
      dayType: type,
      isExcused: d.isExcused ?? false,
      excuseReason: d.isExcused ? (d.excuseReason ?? null) : null,
      scheduledMinutes: d.scheduledMinutes,
      workedMinutes: d.workedMinutes,
      lateMinutes: d.lateMinutes,
      earlyLeaveMinutes: d.earlyLeaveMinutes,
      overtimeMinutes: d.overtimeMinutes,
      earned: isFixed
        ? type === 'WORK' &&
          (d.status === WorkDayStatus.PRESENT || d.status === WorkDayStatus.LATE)
          ? Math.round(dailyRate)
          : 0
        : Math.round(d.workedMinutes * minuteRate),
      overtimeEarned: otEarned,
      deducted,
    };
  });

  const missingMinutes = scheduledRows.reduce(
    (s, d) => s + Math.max(0, d.lateMinutes + d.earlyLeaveMinutes),
    0,
  );

  return {
    baseSalary,
    workedMinutes: totalWorkedMinutes,
    overtimeAmount,
    penaltyAmount,
    bonusAmount,
    totalAmount,
    breakdown: {
      engine: 'time-v2',
      salaryType: input.salaryType,
      contractAmount: input.salaryAmount,
      rates: {
        monthExpectedMinutes: E,
        monthWorkingDays: D,
        minuteRate: Math.round(minuteRate * 100) / 100,
        hourlyRate: Math.round(hourlyRate * 100) / 100,
        dailyRate: Math.round(dailyRate),
        formula: isFixed
          ? `Soatlik = ${som(input.salaryAmount)} so'm / ${Math.round((E / 60) * 100) / 100} soat = ${som(hourlyRate)} so'm; ` +
            `daqiqalik = ${som(hourlyRate)} / 60 = ${som(minuteRate)} so'm; ` +
            `kunlik = ${som(input.salaryAmount)} / ${D} kun = ${som(dailyRate)} so'm`
          : `Soatlik stavka (shartnoma) = ${som(input.salaryAmount)} so'm; daqiqalik = ${som(minuteRate)} so'm`,
      },
      summary: {
        workingDays: D,
        scheduledDays: scheduledRows.length,
        presentDays: attendedRows.length,
        lateDays: lateRows.length,
        absentDays: absentRows.length,
        excusedDays: excusedRows.length,
        weekendWorkDays: days.filter((d) => dayTypeOf(d) === 'WEEKEND' && d.workedMinutes > 0).length,
        holidayWorkDays: days.filter((d) => dayTypeOf(d) === 'HOLIDAY' && d.workedMinutes > 0).length,
        expectedMinutes: E,
        scheduledMinutesToDate: days.reduce((s, d) => s + d.scheduledMinutes, 0),
        workedMinutes: totalWorkedMinutes,
        lateMinutes: scheduledRows.reduce((s, d) => s + (d.isExcused ? 0 : d.lateMinutes), 0),
        earlyLeaveMinutes: scheduledRows.reduce(
          (s, d) => s + (d.isExcused ? 0 : d.earlyLeaveMinutes),
          0,
        ),
        overtimeMinutes: totalOvertimeMinutes,
        missingMinutes,
      },
      days: dayRows,
      penalties: finalPenalties,
      unpaid,
      overtimePay,
      bonuses,
      adjustments,
      totals: {
        gross: isFixed ? input.salaryAmount : baseSalary,
        unpaid: unpaidAmount,
        base: baseSalary,
        penalty: penaltyAmount,
        overtime: overtimeAmount,
        bonus: bonusAmount,
        deductions: adjustmentDeduction,
        net: totalAmount,
      },
    },
  };
}
