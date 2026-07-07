import {
  calcPayroll,
  CalcWorkDayRow,
  defaultPolicy,
  PayrollCalcInput,
  PayrollPolicy,
} from './payroll-calc';
import { monthScheduleStats } from './month-schedule';
import {
  BonusType,
  PayrollAdjustmentType,
  SalaryType,
  WorkDayStatus,
} from '../../common/enums';

/**
 * Foydalanuvchi misoli asosida:
 *   Oylik: 6 000 000 so'm (600 000 000 tiyin)
 *   Oy: 22 ish kuni × 8 soat = 176 soat = 10 560 daqiqa
 *   Soatlik: 34 090.90 so'm; daqiqalik: 568.18 so'm; kunlik: 272 727 so'm
 */
const SALARY = 600_000_000; // tiyin
const E = 22 * 8 * 60; // 10 560 daqiqa
const D = 22;
const MR = SALARY / E; // 56 818.18 tiyin/daqiqa
const DAILY = SALARY / D; // 27 272 727.27 tiyin

function day(date: string, over: Partial<CalcWorkDayRow> = {}): CalcWorkDayRow {
  return {
    date,
    status: WorkDayStatus.PRESENT,
    scheduledMinutes: 480,
    workedMinutes: 480,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    ...over,
  };
}

function calc(
  workDays: CalcWorkDayRow[],
  over: Partial<PayrollCalcInput> = {},
  policy: Partial<PayrollPolicy> = {},
) {
  return calcPayroll({
    salaryType: SalaryType.FIXED,
    salaryAmount: SALARY,
    monthExpectedMinutes: E,
    monthWorkingDays: D,
    holidayDates: [],
    workDays,
    policy: defaultPolicy(policy),
    bonusRules: [],
    adjustments: [],
    ...over,
  });
}

describe('calcPayroll — VAQT = PUL engine', () => {
  // ---------- Stavkalar ----------

  it('stavkalar to‘g‘ri: soatlik = oylik/176s, daqiqalik = soatlik/60, kunlik = oylik/22', () => {
    const r = calc([day('2026-07-01')]);
    const rates = (r.breakdown as any).rates;
    expect(rates.hourlyRate).toBeCloseTo(3_409_090.91, 1); // 34 090.91 so'm
    expect(rates.minuteRate).toBeCloseTo(56_818.18, 1); // 568.18 so'm
    expect(rates.dailyRate).toBe(27_272_727); // 272 727 so'm
    expect(rates.monthExpectedMinutes).toBe(10_560);
    expect(rates.monthWorkingDays).toBe(22);
  });

  // ---------- Kechikish ----------

  it('18 daqiqa kechikish → 18 × daqiqalik stavka (10 227 so‘m), foiz YO‘Q', () => {
    const r = calc([day('2026-07-03', { status: WorkDayStatus.LATE, lateMinutes: 18 })]);
    expect(r.penaltyAmount).toBe(Math.round(18 * MR)); // 1 022 727 tiyin = 10 227.27 so'm
    expect(r.penaltyAmount).toBe(1_022_727);
    const p = (r.breakdown as any).penalties[0];
    expect(p.kind).toBe('LATE');
    expect(p.minutes).toBe(18);
    expect(p.formula).toContain('18 daqiqa');
    expect(p.formula).toContain('568.18');
  });

  it('grace ichidagi kechikish (workday-calc late=0 beradi) jarima olmaydi', () => {
    // 5 daqiqa kechikib kelgan, grace 5 → workday-calc lateMinutes=0 yozadi
    const r = calc([day('2026-07-03', { lateMinutes: 0, workedMinutes: 475 })]);
    expect(r.penaltyAmount).toBe(0);
  });

  it('threshold: kechikish chegaradan kichik bo‘lsa jarima yo‘q', () => {
    const r = calc(
      [day('2026-07-03', { status: WorkDayStatus.LATE, lateMinutes: 18 })],
      {},
      { late: { active: true, thresholdMinutes: 20, multiplier: 1 } },
    );
    expect(r.penaltyAmount).toBe(0);
  });

  it('late qoidasi o‘chirilgan bo‘lsa kechikish kechiriladi', () => {
    const r = calc(
      [day('2026-07-03', { status: WorkDayStatus.LATE, lateMinutes: 45 })],
      {},
      { late: { active: false, thresholdMinutes: 0, multiplier: 1 } },
    );
    expect(r.penaltyAmount).toBe(0);
  });

  // ---------- Erta ketish ----------

  it('28 daqiqa erta ketish → 28 × daqiqalik stavka', () => {
    const r = calc([day('2026-07-04', { earlyLeaveMinutes: 28, workedMinutes: 452 })]);
    expect(r.penaltyAmount).toBe(Math.round(28 * MR)); // 1 590 909
    expect((r.breakdown as any).penalties[0].kind).toBe('EARLY_LEAVE');
  });

  // ---------- Kelmagan kun ----------

  it('sababsiz kelmagan kun → aynan 1 kunlik ish haqi (272 727 so‘m), IKKI MARTA ushlanmaydi', () => {
    const r = calc([
      day('2026-07-14', { status: WorkDayStatus.ABSENT, workedMinutes: 0 }),
      day('2026-07-15'),
    ]);
    expect(r.penaltyAmount).toBe(Math.round(DAILY)); // 27 272 727 tiyin
    // Baza to'liq oylik bo'lib qoladi — absent faqat jarima sifatida bir marta ushlanadi
    expect(r.baseSalary).toBe(SALARY);
    expect(r.totalAmount).toBe(SALARY - Math.round(DAILY));
  });

  it('sababli (excused) kelmagan kun — jarima YO‘Q, lekin kun to‘lanmaydi', () => {
    const r = calc([
      day('2026-07-14', {
        status: WorkDayStatus.ABSENT,
        workedMinutes: 0,
        isExcused: true,
        excuseReason: 'Kasal bola',
      }),
    ]);
    expect(r.penaltyAmount).toBe(0);
    expect(r.baseSalary).toBe(SALARY - Math.round(DAILY));
    const u = (r.breakdown as any).unpaid[0];
    expect(u.kind).toBe('EXCUSED');
  });

  it('absent qoidasi o‘chirilgan bo‘lsa ham ishlanmagan kun to‘lanmaydi (jarimasiz)', () => {
    const r = calc(
      [day('2026-07-14', { status: WorkDayStatus.ABSENT, workedMinutes: 0 })],
      {},
      { absent: { active: false, thresholdMinutes: 0, multiplier: 1 } },
    );
    expect(r.penaltyAmount).toBe(0);
    expect(r.baseSalary).toBe(SALARY - Math.round(DAILY));
    expect((r.breakdown as any).unpaid[0].kind).toBe('ABSENT_UNPAID');
  });

  // ---------- Yarim kun ----------

  it('yarim kundan kam ishlangan kun → ushlanma kamida kunlikning yarmi', () => {
    // 30 daqiqa kechikkan, lekin bor-yo'g'i 200/480 daqiqa ishlagan
    const r = calc([
      day('2026-07-08', {
        status: WorkDayStatus.LATE,
        lateMinutes: 30,
        workedMinutes: 200,
      }),
    ]);
    const half = Math.round(DAILY / 2); // 13 636 364
    expect(r.penaltyAmount).toBe(half);
    const kinds = (r.breakdown as any).penalties.map((p: any) => p.kind);
    expect(kinds).toContain('LATE');
    expect(kinds).toContain('HALF_DAY');
  });

  it('4 soatdan ko‘p ishlagan bo‘lsa faqat daqiqa jarimasi (half-day emas)', () => {
    const r = calc([
      day('2026-07-08', { status: WorkDayStatus.LATE, lateMinutes: 30, workedMinutes: 450 }),
    ]);
    expect(r.penaltyAmount).toBe(Math.round(30 * MR));
  });

  // ---------- Kunlik chegara (cap) ----------

  it('bir kunlik jami ushlanma kunlik stavkadan oshmaydi', () => {
    const r = calc([
      day('2026-07-09', { status: WorkDayStatus.LATE, lateMinutes: 500, workedMinutes: 40 }),
    ]);
    expect(r.penaltyAmount).toBe(Math.round(DAILY));
  });

  // ---------- Overtime ----------

  it('2 soat overtime × 1.5 → 2 × soatlik × 1.5', () => {
    const r = calc([day('2026-07-05', { overtimeMinutes: 120, workedMinutes: 600 })]);
    expect(r.overtimeAmount).toBe(Math.round(120 * MR * 1.5)); // 10 227 273
    const o = (r.breakdown as any).overtimePay[0];
    expect(o.kind).toBe('WEEKDAY');
    expect(o.formula).toContain('× 1.5');
  });

  it('overtime nofaol bo‘lsa qo‘shimcha haq to‘lanmaydi', () => {
    const r = calc(
      [day('2026-07-05', { overtimeMinutes: 120, workedMinutes: 600 })],
      {},
      { overtimeActive: false },
    );
    expect(r.overtimeAmount).toBe(0);
  });

  // ---------- Dam olish / bayram kuni ----------

  it('dam olish kuni 8 soat ish → worked × daqiqalik × 2 (weekend policy)', () => {
    const r = calc([
      day('2026-07-11', { scheduledMinutes: 0, workedMinutes: 480 }), // shanba
    ]);
    expect(r.overtimeAmount).toBe(Math.round(480 * MR * 2)); // 54 545 455
    expect((r.breakdown as any).overtimePay[0].kind).toBe('WEEKEND');
  });

  it('bayram kuni ish → holiday koeffitsiyenti (masalan 3x)', () => {
    const r = calc(
      [day('2026-07-20', { scheduledMinutes: 0, workedMinutes: 480 })],
      { holidayDates: ['2026-07-20'] },
      { holidayMultiplier: 3 },
    );
    expect(r.overtimeAmount).toBe(Math.round(480 * MR * 3));
    expect((r.breakdown as any).overtimePay[0].kind).toBe('HOLIDAY');
  });

  it('bayram kuni kelmagan xodim absent bo‘lmaydi', () => {
    // Bayram kuni scheduledMinutes=0 bo'lib keladi (recalc); jarima yo'q
    const r = calc(
      [day('2026-07-20', { scheduledMinutes: 0, workedMinutes: 0 })],
      { holidayDates: ['2026-07-20'] },
    );
    expect(r.penaltyAmount).toBe(0);
    expect(r.totalAmount).toBe(SALARY);
  });

  // ---------- Bonuslar va tuzatishlar ----------

  it('FULL_ATTENDANCE bonusi — sababli kun uni buzmaydi', () => {
    const r = calc(
      [
        day('2026-07-01'),
        day('2026-07-02', { status: WorkDayStatus.ABSENT, workedMinutes: 0, isExcused: true }),
      ],
      {
        bonusRules: [{ type: BonusType.FULL_ATTENDANCE, amount: 50_000_000, isActive: true }],
      },
    );
    expect(r.bonusAmount).toBe(50_000_000);
  });

  it('avans va performance bonus tuzatishlari netga to‘g‘ri qo‘shiladi/ayiriladi', () => {
    const r = calc([day('2026-07-01')], {
      adjustments: [
        { type: PayrollAdjustmentType.ADVANCE, amount: 50_000_000, note: 'Avans' },
        { type: PayrollAdjustmentType.BONUS, amount: 20_000_000, note: 'Performance' },
      ],
    });
    expect(r.bonusAmount).toBe(20_000_000);
    expect(r.totalAmount).toBe(SALARY + 20_000_000 - 50_000_000);
    expect((r.breakdown as any).totals.deductions).toBe(50_000_000);
  });

  it('to‘liq stsenariy: net = oylik + bonus + OT − jarima − avans', () => {
    const r = calc(
      [
        day('2026-07-03', { status: WorkDayStatus.LATE, lateMinutes: 12, workedMinutes: 468 }),
        day('2026-07-08', { status: WorkDayStatus.LATE, lateMinutes: 31, workedMinutes: 449 }),
        day('2026-07-14', { status: WorkDayStatus.ABSENT, workedMinutes: 0 }),
        day('2026-07-05', { overtimeMinutes: 120, workedMinutes: 600 }),
        day('2026-07-11', { scheduledMinutes: 0, workedMinutes: 480 }),
      ],
      {
        adjustments: [{ type: PayrollAdjustmentType.ADVANCE, amount: 50_000_000, note: null }],
      },
    );
    const expectedPenalty =
      Math.round(12 * MR) + Math.round(31 * MR) + Math.round(DAILY);
    const expectedOvertime = Math.round(120 * MR * 1.5) + Math.round(480 * MR * 2);
    expect(r.penaltyAmount).toBe(expectedPenalty);
    expect(r.overtimeAmount).toBe(expectedOvertime);
    expect(r.totalAmount).toBe(SALARY + expectedOvertime - expectedPenalty - 50_000_000);
  });

  // ---------- HOURLY ----------

  it('soatbay xodim: baza = ishlagan daqiqa × stavka; kechikish uchun QO‘SHIMCHA jarima yo‘q', () => {
    const rate = 3_000_000; // 30 000 so'm/soat
    const r = calcPayroll({
      salaryType: SalaryType.HOURLY,
      salaryAmount: rate,
      monthExpectedMinutes: E,
      monthWorkingDays: D,
      holidayDates: [],
      workDays: [
        day('2026-07-01', { status: WorkDayStatus.LATE, lateMinutes: 30, workedMinutes: 450 }),
      ],
      policy: defaultPolicy(),
      bonusRules: [],
      adjustments: [],
    });
    expect(r.baseSalary).toBe(Math.round(450 * (rate / 60))); // 22 500 000
    expect(r.penaltyAmount).toBe(0); // vaqt allaqachon pulda aks etgan
  });

  it('soatbay overtime: bazada 1x bor — faqat ustama (k−1) qo‘shiladi', () => {
    const rate = 3_000_000;
    const r = calcPayroll({
      salaryType: SalaryType.HOURLY,
      salaryAmount: rate,
      monthExpectedMinutes: E,
      monthWorkingDays: D,
      holidayDates: [],
      workDays: [day('2026-07-01', { overtimeMinutes: 120, workedMinutes: 600 })],
      policy: defaultPolicy(),
      bonusRules: [],
      adjustments: [],
    });
    expect(r.baseSalary).toBe(Math.round(600 * (rate / 60)));
    expect(r.overtimeAmount).toBe(Math.round(120 * (rate / 60) * 0.5));
  });

  // ---------- Foiz ishlatilmasligi kafolati ----------

  it('jarima hech qachon oylikning foizi sifatida hisoblanmaydi', () => {
    // 1 daqiqa kechikish — jarima aynan 1 daqiqalik ish haqi bo'lishi kerak
    const r = calc(
      [day('2026-07-03', { status: WorkDayStatus.LATE, lateMinutes: 1, workedMinutes: 479 })],
      {},
      { late: { active: true, thresholdMinutes: 0, multiplier: 1 } },
    );
    expect(r.penaltyAmount).toBe(Math.round(MR)); // ≈ 568 so'm, hech qanday 10%/20% emas
    expect(r.penaltyAmount).toBeLessThan(SALARY * 0.001);
  });
});

describe('monthScheduleStats — oylik ish vaqti avtomatik aniqlanadi', () => {
  const MON_FRI = [1, 2, 3, 4, 5].map((dow) => ({
    dayOfWeek: dow,
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 0,
    lunchStart: '13:00',
    lunchEnd: '14:00',
  }));

  it('2026-iyul, Dush–Juma 09:00–18:00 (tushlik 1s) → 23 kun × 8s = 184 soat', () => {
    const s = monthScheduleStats(MON_FRI, '2026-07', new Set());
    expect(s.workingDays).toBe(23);
    expect(s.expectedMinutes).toBe(23 * 480);
  });

  it('bayram ish kunlari hisobidan chiqariladi', () => {
    // 2026-07-20 — dushanba
    const s = monthScheduleStats(MON_FRI, '2026-07', new Set(['2026-07-20']));
    expect(s.workingDays).toBe(22);
    expect(s.expectedMinutes).toBe(22 * 480); // = 176 soat (user misolidagi raqam)
  });

  it('tungi smena kunlari ham to‘g‘ri hisoblanadi (22:00–06:00)', () => {
    const nights = [1, 2, 3, 4, 5].map((dow) => ({
      dayOfWeek: dow,
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 0,
    }));
    const s = monthScheduleStats(nights, '2026-07', new Set());
    expect(s.workingDays).toBe(23);
    expect(s.expectedMinutes).toBe(23 * 480);
  });
});
