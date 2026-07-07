/**
 * Demo kompaniya xodimlari uchun O'TGAN OY (iyun 2026) davomatini real ko'rinishда
 * to'ldiradi: kirish/chiqish eventlari → WorkDay agregatsiyasi (tizim logikasi bilan)
 * → oylik (payroll) generatsiya. Turli profillar: namunali, kechikuvchi, sababsiz
 * kelmagan, sababli (uzrli), chiqmagan (incomplete), qo'shimcha ishlagan (overtime).
 *
 * Ishga tushirish:  pnpm seed:attendance
 * Idempotent — qayta ishga tushirsa iyun 2026 ma'lumotini tozalab qayta yozadi.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { DataSource, Between, ILike, IsNull, Not, Raw } from 'typeorm';
import { AppModule } from './app.module';
import { WorkDayService } from './modules/workdays/workday.service';
import { PayrollService } from './modules/payroll/payroll.service';
import { AttendanceEvent } from './entities/attendance-event.entity';
import { WorkDay } from './entities/work-day.entity';
import { PayrollRecord } from './entities/payroll-record.entity';
import { Employee } from './entities/employee.entity';
import { Company } from './entities/company.entity';
import { AttendanceEventType, AttendanceSource, EmployeeStatus } from './common/enums';
import { zonedTimeToUtc } from './common/utils/tz.util';

loadEnv();

const MONTH = '2026-06'; // o'tgan oy
const YEAR = 2026;
const MON0 = 5; // 0-indexed → iyun

type Outcome = 'ON_TIME' | 'LATE' | 'OVERTIME' | 'EARLY_LEAVE' | 'ABSENT' | 'INCOMPLETE';

/** [min, max] oralig'ida butun tasodifiy son */
function rnd(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
/** "HH:MM" */
function hm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Iyun 2026 ish kunlari (Du–Ju) sana satrlari */
function workdaysOfJune(): string[] {
  const days: string[] = [];
  const last = new Date(YEAR, MON0 + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const wd = new Date(YEAR, MON0, d).getDay(); // 0=Ya … 6=Sha
    if (wd === 0 || wd === 6) continue; // dam olish
    days.push(`${YEAR}-06-${String(d).padStart(2, '0')}`);
  }
  return days;
}

interface DayPlan {
  outcome: Outcome;
  excused?: boolean;
  excuseReason?: string;
}

/**
 * Xodim indeksi bo'yicha profil: qaysi ish kunlariga qanday holat.
 * Qolgan kunlar — ON_TIME.
 */
function buildPlan(index: number, days: string[]): Map<string, DayPlan> {
  const plan = new Map<string, DayPlan>();
  const set = (dayIdxs: number[], p: DayPlan) => {
    for (const i of dayIdxs) if (days[i]) plan.set(days[i], p);
  };
  const profile = index % 7;
  switch (profile) {
    case 0: // Namunali — hammasi o'z vaqtida → to'liq davomat bonusi
      break;
    case 1: // Tez-tez kechikuvchi → kechikish jarimalari
      set([1, 4, 7, 10, 13, 16], { outcome: 'LATE' });
      break;
    case 2: // Sababsiz kelmagan → absent jarimalari
      set([3, 12], { outcome: 'ABSENT' });
      set([6], { outcome: 'LATE' });
      break;
    case 3: // Sababli (uzrli) — jarima qo'llanmaydi
      set([8], { outcome: 'ABSENT', excused: true, excuseReason: 'Kasallik (shifokor ma’lumotnomasi)' });
      set([2, 15], { outcome: 'LATE' });
      break;
    case 4: // Chiqishni qayd qilmagan (incomplete) + erta ketgan
      set([5], { outcome: 'INCOMPLETE' });
      set([11], { outcome: 'EARLY_LEAVE' });
      break;
    case 5: // Qo'shimcha ishlagan (overtime)
      set([2, 6, 9, 14], { outcome: 'OVERTIME' });
      break;
    default: // Aralash — kechikish + sababli kelmagan + overtime
      set([4, 9], { outcome: 'LATE' });
      set([13], { outcome: 'ABSENT', excused: true, excuseReason: 'Shaxsiy sabab (ruxsat bilan)' });
      set([1, 7], { outcome: 'OVERTIME' });
      break;
  }
  return plan;
}

/** Holatga qarab kirish/chiqish vaqtlari (daqiqa formatida "HH:MM") */
function timesFor(outcome: Outcome): { in?: string; out?: string } {
  switch (outcome) {
    case 'ON_TIME':
      return { in: hm(8, rnd(50, 59)), out: hm(18, rnd(0, 35)) };
    case 'LATE':
      return { in: hm(9, rnd(20, 55)), out: hm(18, rnd(0, 25)) };
    case 'OVERTIME':
      return { in: hm(8, rnd(50, 59)), out: hm(rnd(19, 20), rnd(0, 50)) };
    case 'EARLY_LEAVE':
      return { in: hm(9, rnd(0, 6)), out: hm(rnd(16, 17), rnd(0, 45)) };
    case 'INCOMPLETE':
      return { in: hm(9, rnd(0, 6)) }; // chiqish yo'q
    case 'ABSENT':
      return {}; // event yo'q
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ds = app.get(DataSource);
  const workDayService = app.get(WorkDayService);
  const payrollService = app.get(PayrollService);

  const eventRepo = ds.getRepository(AttendanceEvent);
  const workDayRepo = ds.getRepository(WorkDay);
  const payrollRepo = ds.getRepository(PayrollRecord);
  const employeeRepo = ds.getRepository(Employee);
  const companyRepo = ds.getRepository(Company);

  const company = await companyRepo.findOne({ where: { name: ILike('Demo%') } });
  if (!company) {
    console.error('Demo kompaniya topilmadi — avval `pnpm seed` ni ishga tushiring.');
    await app.close();
    process.exit(1);
  }
  const tz = company.timezone || 'Asia/Tashkent';

  const employees = await employeeRepo.find({
    where: { companyId: company.id, deletedAt: IsNull(), status: Not(EmployeeStatus.FIRED) },
    order: { createdAt: 'ASC' },
  });
  console.log(`Kompaniya: ${company.name} | faol xodimlar: ${employees.length} | oy: ${MONTH} (${tz})`);

  const days = workdaysOfJune();
  console.log(`Iyun ish kunlari: ${days.length} ta`);

  // --- Idempotent tozalash: iyun 2026 event / workday / payroll ---
  const monthStart = zonedTimeToUtc(`${MONTH}-01`, '00:00', tz);
  const monthEnd = zonedTimeToUtc('2026-07-01', '00:00', tz);
  const empIds = employees.map((e) => e.id);
  if (empIds.length) {
    await eventRepo.delete({
      employeeId: Raw((a) => `${a} = ANY(:ids)`, { ids: empIds }),
      timestamp: Between(monthStart, new Date(monthEnd.getTime() - 1)),
    });
    await workDayRepo.delete({
      employeeId: Raw((a) => `${a} = ANY(:ids)`, { ids: empIds }),
      date: Raw((a) => `${a} >= :s AND ${a} < :e`, { s: `${MONTH}-01`, e: '2026-07-01' }),
    });
    await payrollRepo.delete({
      employeeId: Raw((a) => `${a} = ANY(:ids)`, { ids: empIds }),
      periodMonth: MONTH,
    });
  }

  // --- Eventlar generatsiyasi ---
  let eventCount = 0;
  const excusedByEmployee = new Map<string, { date: string; reason: string }[]>();

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i]!;
    const plan = buildPlan(i, days);
    const excused: { date: string; reason: string }[] = [];

    for (const dateStr of days) {
      const dp = plan.get(dateStr) ?? { outcome: 'ON_TIME' as Outcome };
      const times = timesFor(dp.outcome);

      if (times.in) {
        await eventRepo.save(
          eventRepo.create({
            employeeId: emp.id,
            branchId: emp.branchId,
            deviceId: null,
            type: AttendanceEventType.CHECK_IN,
            source: dp.outcome === 'OVERTIME' ? AttendanceSource.KIOSK : AttendanceSource.MOBILE,
            timestamp: zonedTimeToUtc(dateStr, times.in, tz),
            confidence: 0.9 + Math.random() * 0.09,
            livenessScore: 0.9 + Math.random() * 0.09,
            snapshotUrl: null,
            latitude: null,
            longitude: null,
            isManual: false,
          }),
        );
        eventCount++;
      }
      if (times.out) {
        await eventRepo.save(
          eventRepo.create({
            employeeId: emp.id,
            branchId: emp.branchId,
            deviceId: null,
            type: AttendanceEventType.CHECK_OUT,
            source: dp.outcome === 'OVERTIME' ? AttendanceSource.KIOSK : AttendanceSource.MOBILE,
            timestamp: zonedTimeToUtc(dateStr, times.out, tz),
            confidence: 0.9 + Math.random() * 0.09,
            livenessScore: 0.9 + Math.random() * 0.09,
            snapshotUrl: null,
            latitude: null,
            longitude: null,
            isManual: false,
          }),
        );
        eventCount++;
      }
      if (dp.excused) excused.push({ date: dateStr, reason: dp.excuseReason ?? 'Uzrli sabab' });
    }
    excusedByEmployee.set(emp.id, excused);
  }
  console.log(`Eventlar yozildi: ${eventCount} ta`);

  // --- WorkDay agregatsiyasi (tizim logikasi bilan) ---
  let wdCount = 0;
  for (const emp of employees) {
    for (const dateStr of days) {
      await workDayService.recalc(emp, dateStr, tz);
      wdCount++;
    }
  }
  console.log(`WorkDay qayta hisoblandi: ${wdCount} kun`);

  // --- Sababli (uzrli) kunlarni belgilash (jarima qo'llanmaydi) ---
  let excusedCount = 0;
  for (const emp of employees) {
    for (const ex of excusedByEmployee.get(emp.id) ?? []) {
      const wd = await workDayRepo.findOne({ where: { employeeId: emp.id, date: ex.date } });
      if (wd) {
        wd.isExcused = true;
        wd.excuseReason = ex.reason;
        await workDayRepo.save(wd);
        excusedCount++;
      }
    }
  }
  console.log(`Sababli kunlar belgilandi: ${excusedCount} ta`);

  // --- Oylik (payroll) generatsiya — jarima/bonus/overtime qo'llanadi ---
  const generated = await payrollService.generateForCompany(company.id, MONTH);
  console.log(`Payroll generatsiya qilindi: ${generated} ta yozuv (${MONTH})`);

  // --- Qisqa xulosa ---
  const records = await payrollRepo.find({
    where: { periodMonth: MONTH, employee: { companyId: company.id } },
    relations: { employee: true },
    order: { totalAmount: 'DESC' },
  });
  console.log('\n=== Iyun 2026 oylik xulosasi ===');
  for (const r of records) {
    const name = r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId;
    console.log(
      `  ${name}: ` +
        `jami ${(r.totalAmount / 100).toLocaleString('ru-RU')} so'm ` +
        `(jarima −${(r.penaltyAmount / 100).toLocaleString('ru-RU')}, ` +
        `bonus +${(r.bonusAmount / 100).toLocaleString('ru-RU')}, ` +
        `overtime +${(r.overtimeAmount / 100).toLocaleString('ru-RU')})`,
    );
  }

  await app.close();
  console.log('\nTayyor. Company panel → Oylik → 2026-06 da ko\'ring.');
}

main().catch((err) => {
  console.error('seed-attendance xatosi:', err);
  process.exit(1);
});
