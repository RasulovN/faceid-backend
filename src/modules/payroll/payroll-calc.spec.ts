import { calcPayroll, CalcWorkDayRow } from './payroll-calc';
import { BonusType, PenaltyType, SalaryType, WorkDayStatus } from '../../common/enums';

const SCHEDULED = 480; // 8 soat

function day(
  date: string,
  status: WorkDayStatus,
  overrides: Partial<CalcWorkDayRow> = {},
): CalcWorkDayRow {
  return {
    date,
    status,
    scheduledMinutes: SCHEDULED,
    workedMinutes: status === WorkDayStatus.ABSENT ? 0 : SCHEDULED,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    ...overrides,
  };
}

describe('calcPayroll', () => {
  describe('FIXED', () => {
    const MONTHLY = 460_000_000; // 4 600 000 so'm (tiyin)

    it('to‘liq davomat — to‘liq oylik', () => {
      const workDays = Array.from({ length: 20 }, (_, i) =>
        day(`2026-06-${String(i + 1).padStart(2, '0')}`, WorkDayStatus.PRESENT),
      );
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.baseSalary).toBe(MONTHLY);
      expect(result.totalAmount).toBe(MONTHLY);
      expect(result.penaltyAmount).toBe(0);
    });

    it('kelmagan kunlar proporsional ushlab qolinadi', () => {
      const workDays = [
        ...Array.from({ length: 18 }, (_, i) =>
          day(`2026-06-${String(i + 1).padStart(2, '0')}`, WorkDayStatus.PRESENT),
        ),
        day('2026-06-19', WorkDayStatus.ABSENT),
        day('2026-06-20', WorkDayStatus.ABSENT),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      // 20 ish kunidan 18 tasi: oylik/20*18
      expect(result.baseSalary).toBe(Math.round((MONTHLY / 20) * 18));
    });

    it('LATE_FIXED jarima — threshold oshgan har kechikish uchun', () => {
      const workDays = [
        day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 20 }),
        day('2026-06-02', WorkDayStatus.LATE, { lateMinutes: 10 }), // threshold'dan past
        day('2026-06-03', WorkDayStatus.PRESENT),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.LATE_FIXED, amount: 5_000_000, thresholdMinutes: 15, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.penaltyAmount).toBe(5_000_000); // faqat 20 daqiqalik kechikish
    });

    it('LATE_PER_MINUTE jarima — daqiqasiga', () => {
      const workDays = [day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 30 })];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.LATE_PER_MINUTE, amount: 100_000, thresholdMinutes: 0, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.penaltyAmount).toBe(30 * 100_000);
    });

    it('ABSENT jarima har sababsiz kun uchun', () => {
      const workDays = [
        day('2026-06-01', WorkDayStatus.ABSENT),
        day('2026-06-02', WorkDayStatus.ABSENT),
        day('2026-06-03', WorkDayStatus.PRESENT),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.ABSENT, amount: 20_000_000, thresholdMinutes: 0, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.penaltyAmount).toBe(40_000_000);
    });

    it('overtime soatlik stavka * multiplier bilan qo‘shiladi', () => {
      // 1 kun, 480 daqiqa scheduled, 120 daqiqa overtime
      const workDays = [day('2026-06-01', WorkDayStatus.PRESENT, { overtimeMinutes: 120 })];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: 480_000, // 1 kunlik oy: soatlik = 480000/8 = 60000
        workDays,
        penaltyRules: [],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      // 2 soat * 60000 * 1.5 = 180000
      expect(result.overtimeAmount).toBe(180_000);
      expect(result.totalAmount).toBe(480_000 + 180_000);
    });

    it('o‘chirilgan (isActive=false) qoidalar qo‘llanmaydi', () => {
      const workDays = [day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 30 })];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.LATE_FIXED, amount: 5_000_000, thresholdMinutes: 0, isActive: false },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.penaltyAmount).toBe(0);
    });
  });

  describe('HOURLY', () => {
    const HOURLY_RATE = 2_500_000; // 25 000 so'm/soat (tiyin)

    it('ishlagan daqiqalar bo‘yicha hisoblaydi', () => {
      const workDays = [
        day('2026-06-01', WorkDayStatus.PRESENT, { workedMinutes: 480 }),
        day('2026-06-02', WorkDayStatus.PRESENT, { workedMinutes: 360 }),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.HOURLY,
        salaryAmount: HOURLY_RATE,
        workDays,
        penaltyRules: [],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.workedMinutes).toBe(840);
      expect(result.baseSalary).toBe(Math.round((840 / 60) * HOURLY_RATE));
    });

    it('overtime ustamasi (multiplier − 1) bilan qo‘shiladi', () => {
      const workDays = [
        day('2026-06-01', WorkDayStatus.PRESENT, { workedMinutes: 600, overtimeMinutes: 120 }),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.HOURLY,
        salaryAmount: HOURLY_RATE,
        workDays,
        penaltyRules: [],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      const base = Math.round((600 / 60) * HOURLY_RATE);
      const extra = Math.round((120 / 60) * HOURLY_RATE * 0.5);
      expect(result.baseSalary).toBe(base);
      expect(result.overtimeAmount).toBe(extra);
      expect(result.totalAmount).toBe(base + extra);
    });
  });

  describe('bonuslar va chegaralar', () => {
    it('FULL_ATTENDANCE bonusi faqat mukammal davomatda beriladi', () => {
      const perfect = [day('2026-06-01', WorkDayStatus.PRESENT)];
      const withLate = [day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 5 })];
      const bonusRules = [
        { type: BonusType.FULL_ATTENDANCE, amount: 30_000_000, isActive: true },
      ];
      const base = {
        salaryType: SalaryType.FIXED,
        salaryAmount: 100_000_000,
        penaltyRules: [],
        overtimeMultiplier: 1.5,
      };
      expect(calcPayroll({ ...base, workDays: perfect, bonusRules }).bonusAmount).toBe(30_000_000);
      expect(calcPayroll({ ...base, workDays: withLate, bonusRules }).bonusAmount).toBe(0);
    });

    it('jami summa manfiy bo‘lmaydi', () => {
      const workDays = [day('2026-06-01', WorkDayStatus.ABSENT)];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: 1_000_000,
        workDays,
        penaltyRules: [
          { type: PenaltyType.ABSENT, amount: 99_000_000, thresholdMinutes: 0, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.totalAmount).toBe(0);
    });
  });

  describe('LATE_SALARY — maoshga proporsional kechikish jarimasi', () => {
    // Oylik 4 600 000 so'm, smena 8 soat (480 daq).
    // 1 daqiqalik ish haqi = 460 000 000 / 30 / 480 = 31 944.44 tiyin.
    const MONTHLY = 460_000_000;

    it('kechikkan daqiqalar × daqiqalik ish haqi ushlab qolinadi', () => {
      const workDays = [
        day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 30 }),
        day('2026-06-02', WorkDayStatus.PRESENT),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.LATE_SALARY, amount: 0, thresholdMinutes: 0, multiplier: 1, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      // 30 × 31 944.44 = 958 333.33 → 958 333 tiyin
      expect(result.penaltyAmount).toBe(958_333);
    });

    it('multiplier jarimani ko‘paytiradi', () => {
      const workDays = [day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 10 })];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.LATE_SALARY, amount: 0, thresholdMinutes: 0, multiplier: 2, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      // 10 × 31 944.44 × 2 = 638 888.9 → 638 889
      expect(result.penaltyAmount).toBe(638_889);
    });

    it('sababli (excused) kunga jarima YOZILMAYDI', () => {
      const workDays = [
        day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 30, isExcused: true }),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.LATE_SALARY, amount: 0, thresholdMinutes: 0, multiplier: 1, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.penaltyAmount).toBe(0);
    });

    it('ABSENT_SALARY — kelmagan kun uchun 1 kunlik ish haqi ushlanadi', () => {
      const workDays = [
        day('2026-06-01', WorkDayStatus.ABSENT),
        day('2026-06-02', WorkDayStatus.PRESENT),
      ];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.ABSENT_SALARY, amount: 0, thresholdMinutes: 0, multiplier: 1, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      // 1 kunlik ish haqi = 460 000 000 / 30 = 15 333 333 tiyin
      expect(result.penaltyAmount).toBe(15_333_333);
    });

    it('sababli ABSENT ga ABSENT_SALARY jarima yozilmaydi', () => {
      const workDays = [day('2026-06-01', WorkDayStatus.ABSENT, { isExcused: true })];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.ABSENT_SALARY, amount: 0, thresholdMinutes: 0, multiplier: 1, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.penaltyAmount).toBe(0);
    });

    it('overtimeActive=false — qo‘shimcha ish haqi qo‘shilmaydi', () => {
      const workDays = [day('2026-06-01', WorkDayStatus.PRESENT, { overtimeMinutes: 120 })];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [],
        bonusRules: [],
        overtimeMultiplier: 1.5,
        overtimeActive: false,
      });
      expect(result.overtimeAmount).toBe(0);
    });

    it('threshold ostidagi kechikish jarimasiz', () => {
      const workDays = [day('2026-06-01', WorkDayStatus.LATE, { lateMinutes: 4 })];
      const result = calcPayroll({
        salaryType: SalaryType.FIXED,
        salaryAmount: MONTHLY,
        workDays,
        penaltyRules: [
          { type: PenaltyType.LATE_SALARY, amount: 0, thresholdMinutes: 5, multiplier: 1, isActive: true },
        ],
        bonusRules: [],
        overtimeMultiplier: 1.5,
      });
      expect(result.penaltyAmount).toBe(0);
    });
  });
});
