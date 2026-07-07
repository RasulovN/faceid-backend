import { calcWorkDay, scheduledMinutesOf } from './workday-calc';
import { AttendanceEventType, EmployeeStatus, WorkDayStatus } from '../../common/enums';
import { haversineDistance } from '../../common/utils/geo.util';

const SCHEDULE_DAY = {
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
};
const START = 9 * 60; // 540
const END = 18 * 60; // 1080

function events(...pairs: Array<[AttendanceEventType, number]>) {
  return pairs.map(([type, minutes]) => ({ type, minutes }));
}

describe('calcWorkDay', () => {
  const base = {
    scheduleDay: SCHEDULE_DAY,
    gracePeriodMinutes: 10,
    employeeStatus: EmployeeStatus.ACTIVE,
  };

  it('vaqtida kelib ketgan xodim — PRESENT, to‘liq ish vaqti', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, START],
        [AttendanceEventType.CHECK_OUT, END],
      ),
    });
    expect(result.status).toBe(WorkDayStatus.PRESENT);
    expect(result.scheduledMinutes).toBe(END - START - 60);
    expect(result.workedMinutes).toBe(END - START - 60); // tanaffus ayirilgan
    expect(result.lateMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
  });

  it('grace davridan keyin kelgan — LATE, lateMinutes to‘liq hisoblanadi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, START + 25],
        [AttendanceEventType.CHECK_OUT, END],
      ),
    });
    expect(result.status).toBe(WorkDayStatus.LATE);
    expect(result.lateMinutes).toBe(25);
  });

  it('grace ichida kelgan kechikish hisoblanmaydi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, START + 9],
        [AttendanceEventType.CHECK_OUT, END],
      ),
    });
    expect(result.status).toBe(WorkDayStatus.PRESENT);
    expect(result.lateMinutes).toBe(0);
  });

  it('erta ketish earlyLeaveMinutes sifatida qayd etiladi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, START],
        [AttendanceEventType.CHECK_OUT, END - 45],
      ),
    });
    expect(result.earlyLeaveMinutes).toBe(45);
  });

  it('grafikdan keyin ketish overtime hisoblanadi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, START],
        [AttendanceEventType.CHECK_OUT, END + 90],
      ),
    });
    expect(result.overtimeMinutes).toBe(90);
  });

  it('event bo‘lmasa scheduled kunda ABSENT', () => {
    const result = calcWorkDay({ ...base, events: [] });
    expect(result.status).toBe(WorkDayStatus.ABSENT);
    expect(result.workedMinutes).toBe(0);
  });

  it('ta’tildagi xodim — VACATION', () => {
    const result = calcWorkDay({
      ...base,
      employeeStatus: EmployeeStatus.VACATION,
      events: [],
    });
    expect(result.status).toBe(WorkDayStatus.VACATION);
  });

  it('yopilmagan CHECK_IN grafik tugashi bilan cheklanadi', () => {
    const result = calcWorkDay({
      ...base,
      events: events([AttendanceEventType.CHECK_IN, START]),
      // nowMinutes berilmagan — o'tgan kun deb hisoblanadi
    });
    expect(result.workedMinutes).toBe(END - START - 60);
  });

  it('bir necha IN/OUT juftliklari yig‘iladi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, START],
        [AttendanceEventType.CHECK_OUT, START + 180],
        [AttendanceEventType.CHECK_IN, START + 240],
        [AttendanceEventType.CHECK_OUT, END],
      ),
    });
    // 180 + (1080 - 780) = 480; 480 - 60 tanaffus = 420
    expect(result.workedMinutes).toBe(420);
  });
});

describe('calcWorkDay — tushlik oynasi', () => {
  const LUNCH_DAY = {
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 0,
    lunchStart: '13:00',
    lunchEnd: '14:00',
  };
  const base = {
    scheduleDay: LUNCH_DAY,
    gracePeriodMinutes: 5,
    employeeStatus: EmployeeStatus.ACTIVE,
  };

  it('tushlik oynasi rejadan ham, ishlagan vaqtdan ham chiqariladi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, 9 * 60],
        [AttendanceEventType.CHECK_OUT, 18 * 60],
      ),
    });
    expect(result.scheduledMinutes).toBe(480); // 9s − 1s tushlik
    expect(result.workedMinutes).toBe(480); // tushlik overlap chiqarilgan
  });

  it('tushlikkacha ketgan xodimning ish vaqti tushliksiz hisoblanadi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, 9 * 60],
        [AttendanceEventType.CHECK_OUT, 13 * 60 + 30], // 13:30 da ketdi
      ),
    });
    // 09:00–13:30 = 270; tushlik bilan kesishma 30 → 240
    expect(result.workedMinutes).toBe(240);
  });
});

describe('calcWorkDay — flexible (moslashuvchan kelish)', () => {
  const DAY = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', breakMinutes: 0 };
  const base = {
    scheduleDay: DAY,
    gracePeriodMinutes: 5,
    flexibleMinutes: 15,
    employeeStatus: EmployeeStatus.ACTIVE,
  };

  it('09:13 da kelgan (09:00–09:15 flexible) — kechikish EMAS', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, 9 * 60 + 13],
        [AttendanceEventType.CHECK_OUT, 18 * 60 + 13],
      ),
    });
    expect(result.status).toBe(WorkDayStatus.PRESENT);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
  });

  it('flexible oynada kelgan xodimning kutilgan ketishi suriladi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, 9 * 60 + 10],
        [AttendanceEventType.CHECK_OUT, 18 * 60], // 18:00 da ketdi, kutilgan 18:10
      ),
    });
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(10);
  });

  it('flexible + grace dan keyin kelgan — kechikish flex oynadan boshlab hisoblanadi', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, 9 * 60 + 25], // 09:25, flex 15 + grace 5 dan tashqarida
        [AttendanceEventType.CHECK_OUT, 18 * 60 + 15],
      ),
    });
    expect(result.status).toBe(WorkDayStatus.LATE);
    expect(result.lateMinutes).toBe(10); // 09:25 − (09:00+15)
  });
});

describe('calcWorkDay — tungi smena (cross-midnight)', () => {
  const NIGHT = { dayOfWeek: 1, startTime: '22:00', endTime: '06:00', breakMinutes: 0 };
  const base = {
    scheduleDay: NIGHT,
    gracePeriodMinutes: 10,
    employeeStatus: EmployeeStatus.ACTIVE,
  };
  const IN = 22 * 60; // 1320
  const OUT = 6 * 60 + 1440; // keyingi kun 06:00 = 1800

  it('rejalashtirilgan vaqt to‘g‘ri: 22:00–06:00 = 8 soat', () => {
    expect(scheduledMinutesOf(NIGHT)).toBe(480);
  });

  it('to‘liq smena: 22:00 kirdi, ertasi 06:00 chiqdi — PRESENT, 480 daqiqa', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, IN],
        [AttendanceEventType.CHECK_OUT, OUT],
      ),
    });
    expect(result.status).toBe(WorkDayStatus.PRESENT);
    expect(result.workedMinutes).toBe(480);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
  });

  it('22:30 da kelgan — 30 daqiqa kechikish', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, IN + 30],
        [AttendanceEventType.CHECK_OUT, OUT],
      ),
    });
    expect(result.status).toBe(WorkDayStatus.LATE);
    expect(result.lateMinutes).toBe(30);
  });

  it('ertasi 07:00 gacha ishlagan — 60 daqiqa overtime', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, IN],
        [AttendanceEventType.CHECK_OUT, OUT + 60],
      ),
    });
    expect(result.overtimeMinutes).toBe(60);
    expect(result.workedMinutes).toBe(540);
  });

  it('ertasi 05:00 da ketgan — 60 daqiqa erta ketish', () => {
    const result = calcWorkDay({
      ...base,
      events: events(
        [AttendanceEventType.CHECK_IN, IN],
        [AttendanceEventType.CHECK_OUT, OUT - 60],
      ),
    });
    expect(result.earlyLeaveMinutes).toBe(60);
  });

  it('yarim tundan keyingi tushlik oynasi (02:00–02:30) chiqariladi', () => {
    const result = calcWorkDay({
      ...base,
      scheduleDay: { ...NIGHT, lunchStart: '02:00', lunchEnd: '02:30' },
      events: events(
        [AttendanceEventType.CHECK_IN, IN],
        [AttendanceEventType.CHECK_OUT, OUT],
      ),
    });
    expect(result.scheduledMinutes).toBe(450);
    expect(result.workedMinutes).toBe(450);
  });
});

describe('haversineDistance (geofence)', () => {
  it('bir xil nuqta uchun 0 ga yaqin', () => {
    expect(haversineDistance(41.311081, 69.240562, 41.311081, 69.240562)).toBeLessThan(0.001);
  });

  it('Toshkent markazidan ~1.85 km masofani to‘g‘ri hisoblaydi', () => {
    // 41.311081,69.240562 → 41.326,69.228 oralig'i taxminan 1.9 km
    const distance = haversineDistance(41.311081, 69.240562, 41.326, 69.228);
    expect(distance).toBeGreaterThan(1500);
    expect(distance).toBeLessThan(2500);
  });

  it('50 metrlik geofence ichidagi nuqtani to‘g‘ri aniqlaydi', () => {
    // ~0.0003 daraja latitude ≈ 33 metr
    const distance = haversineDistance(41.311081, 69.240562, 41.311381, 69.240562);
    expect(distance).toBeLessThan(50);
    expect(distance).toBeGreaterThan(20);
  });
});
