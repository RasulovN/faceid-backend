import { calcWorkDay } from './workday-calc';
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
