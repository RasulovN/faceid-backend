import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { AppDataSource } from './database/data-source';
import {
  Branch,
  BonusRule,
  Company,
  Employee,
  FaceEmbedding,
  OvertimeRule,
  PenaltyRule,
  Role,
  Subscription,
  Tariff,
  User,
  WorkSchedule,
} from './entities';
import { DEFAULT_ROLES } from './common/constants/default-roles';
import {
  BonusType,
  CompanyStatus,
  EmployeeStatus,
  Gender,
  PenaltyType,
  SalaryType,
  ScheduleType,
  SubscriptionStatus,
  UserRole,
} from './common/enums';

loadEnv();

/** Normalizatsiyalangan tasodifiy 512 o'lchamli embedding */
function fakeEmbedding(): number[] {
  const vector: number[] = [];
  for (let i = 0; i < 512; i++) {
    // Box-Muller — normal taqsimot
    const u1 = (randomBytes(4).readUInt32BE(0) + 1) / 4294967296;
    const u2 = (randomBytes(4).readUInt32BE(0) + 1) / 4294967296;
    vector.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return vector.map((v) => Number((v / norm).toFixed(8)));
}

const WEEKDAYS_9_18 = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
}));

async function seedSuperadmin(ds: DataSource): Promise<void> {
  const userRepo = ds.getRepository(User);
  const username = (process.env.SEED_SUPERADMIN_USERNAME ?? 'superadmin').toLowerCase();
  if (await userRepo.exists({ where: { username } })) {
    console.log(`✓ Superadmin mavjud: ${username}`);
    return;
  }
  await userRepo.save(
    userRepo.create({
      username,
      email: (process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@example.com').toLowerCase(),
      phone: '+998900000000',
      passwordHash: await argon2.hash(process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123!'),
      role: UserRole.SUPERADMIN,
      companyId: null,
      isEmailVerified: true,
    }),
  );
  console.log(`+ Superadmin yaratildi: ${username}`);
}

async function seedTariffs(ds: DataSource): Promise<Tariff[]> {
  const tariffRepo = ds.getRepository(Tariff);
  const defs = [
    {
      name: 'Start',
      description: 'Kichik jamoalar uchun boshlang‘ich tarif',
      priceMonthly: 199000 * 100, // tiyin
      maxBranches: 1,
      maxEmployees: 15,
      maxDevices: 1,
      historyRetentionDays: 90,
      features: ['1 filial', '15 xodim', '1 kiosk qurilma', '90 kun tarix'],
      sortOrder: 1,
    },
    {
      name: 'Business',
      description: 'O‘sib borayotgan biznes uchun',
      priceMonthly: 499000 * 100,
      maxBranches: 5,
      maxEmployees: 100,
      maxDevices: 5,
      historyRetentionDays: 365,
      features: ['5 filial', '100 xodim', '5 kiosk qurilma', '1 yil tarix', 'Oylik hisob-kitob'],
      sortOrder: 2,
    },
    {
      name: 'Enterprise',
      description: 'Yirik korxonalar uchun moslashtiriladigan (custom) tarif',
      priceMonthly: 1499000 * 100,
      maxBranches: 100,
      maxEmployees: 5000,
      maxDevices: 100,
      historyRetentionDays: 1095,
      features: ['100 filialgacha', '5000 xodimgacha', '100 kiosk qurilmagacha', '3 yil tarix', 'Prioritet qo‘llab-quvvatlash'],
      sortOrder: 3,
      // Custom tarif — narx tanlangan miqdorga qarab dinamik (tiyin)
      isCustom: true,
      basePrice: 500000 * 100,
      pricePerBranch: 30000 * 100,
      pricePerEmployee: 1500 * 100,
      pricePerDevice: 20000 * 100,
    },
  ];
  const result: Tariff[] = [];
  for (const def of defs) {
    let tariff = await tariffRepo.findOne({ where: { name: def.name } });
    if (!tariff) {
      tariff = await tariffRepo.save(tariffRepo.create(def));
      console.log(`+ Tarif yaratildi: ${def.name}`);
    } else {
      // Idempotent yangilash — custom narx maydonlari mavjud tarifga ham qo'llansin
      tariff = await tariffRepo.save(tariffRepo.merge(tariff, def));
      console.log(`✓ Tarif yangilandi: ${def.name}`);
    }
    result.push(tariff);
  }
  return result;
}

/** Kompaniya uchun default (isSystem) rollarni idempotent seed qiladi. */
async function seedDefaultRoles(ds: DataSource, companyId: string): Promise<void> {
  const roleRepo = ds.getRepository(Role);
  for (const def of DEFAULT_ROLES) {
    if (await roleRepo.exists({ where: { companyId, name: def.name } })) continue;
    await roleRepo.save(
      roleRepo.create({
        companyId,
        name: def.name,
        description: def.description,
        permissions: [...def.permissions],
        isSystem: true,
      }),
    );
    console.log(`+ Default rol yaratildi: ${def.name}`);
  }
}

async function seedDemoCompany(ds: DataSource, business: Tariff): Promise<void> {
  const companyRepo = ds.getRepository(Company);
  const userRepo = ds.getRepository(User);

  const existingCompany = await companyRepo.findOne({ where: { slug: 'demo-kompaniya' } });
  if (existingCompany) {
    console.log('✓ Demo kompaniya mavjud');
    await seedDefaultRoles(ds, existingCompany.id);
    return;
  }

  const now = new Date();
  const trialDays = Number(process.env.TRIAL_DAYS ?? 14);
  const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
  const demoPasswordHash = await argon2.hash('Demo123!');

  const company = await companyRepo.save(
    companyRepo.create({
      name: 'Demo Kompaniya',
      slug: 'demo-kompaniya',
      status: CompanyStatus.ACTIVE,
      tariffId: business.id,
      subscriptionStartsAt: now,
      subscriptionEndsAt: trialEndsAt,
      contactEmail: 'demo@faceid.uz',
      contactPhone: '+998901112233',
      address: 'Toshkent sh., Amir Temur ko‘chasi 1',
      timezone: 'Asia/Tashkent',
      settings: { gracePeriodMinutes: 10 },
    }),
  );

  const owner = await userRepo.save(
    userRepo.create({
      username: 'demo',
      email: 'demo@faceid.uz',
      phone: '+998901112233',
      passwordHash: demoPasswordHash,
      role: UserRole.COMPANY_OWNER,
      companyId: company.id,
      isEmailVerified: true,
    }),
  );
  company.ownerId = owner.id;
  await companyRepo.save(company);

  await seedDefaultRoles(ds, company.id);

  await ds.getRepository(Subscription).save(
    ds.getRepository(Subscription).create({
      companyId: company.id,
      tariffId: business.id,
      startsAt: now,
      endsAt: trialEndsAt,
      status: SubscriptionStatus.ACTIVE,
      isTrial: true,
    }),
  );

  // ---------- Filiallar ----------
  const branchRepo = ds.getRepository(Branch);
  const mainBranch = await branchRepo.save(
    branchRepo.create({
      companyId: company.id,
      name: 'Bosh ofis',
      address: 'Toshkent sh., Amir Temur ko‘chasi 1',
      latitude: 41.311081,
      longitude: 69.240562,
      geofenceRadius: 50,
      workingHoursDefault: WEEKDAYS_9_18,
      isMain: true,
    }),
  );
  const secondBranch = await branchRepo.save(
    branchRepo.create({
      companyId: company.id,
      name: 'Chilonzor filiali',
      address: 'Toshkent sh., Chilonzor tumani',
      latitude: 41.326,
      longitude: 69.228,
      geofenceRadius: 50,
      workingHoursDefault: WEEKDAYS_9_18,
      isMain: false,
    }),
  );

  // ---------- Ish grafigi (FIXED, Du–Ju 09:00–18:00) ----------
  const scheduleRepo = ds.getRepository(WorkSchedule);
  await scheduleRepo.save(
    scheduleRepo.create({
      companyId: company.id,
      branchId: mainBranch.id,
      name: 'Standart grafik (Du–Ju 09:00–18:00)',
      type: ScheduleType.FIXED,
      days: WEEKDAYS_9_18,
      gracePeriodMinutes: 10,
    }),
  );
  await scheduleRepo.save(
    scheduleRepo.create({
      companyId: company.id,
      branchId: secondBranch.id,
      name: 'Chilonzor grafigi (Du–Ju 09:00–18:00)',
      type: ScheduleType.FIXED,
      days: WEEKDAYS_9_18,
      gracePeriodMinutes: 10,
    }),
  );

  // ---------- Xodimlar ----------
  const employeeRepo = ds.getRepository(Employee);
  const embeddingRepo = ds.getRepository(FaceEmbedding);
  const employeeDefs = [
    { first: 'Aziz', last: 'Karimov', gender: Gender.MALE, position: 'Sotuv menejeri', salaryType: SalaryType.FIXED, salary: 4000000 * 100, branch: mainBranch },
    { first: 'Malika', last: 'Yusupova', gender: Gender.FEMALE, position: 'Buxgalter', salaryType: SalaryType.FIXED, salary: 5000000 * 100, branch: mainBranch },
    { first: 'Jasur', last: 'Toshmatov', gender: Gender.MALE, position: 'Omborchi', salaryType: SalaryType.HOURLY, salary: 25000 * 100, branch: mainBranch },
    { first: 'Nilufar', last: 'Rahimova', gender: Gender.FEMALE, position: 'Operator', salaryType: SalaryType.FIXED, salary: 3500000 * 100, branch: secondBranch },
    { first: 'Bobur', last: 'Aliyev', gender: Gender.MALE, position: 'Sotuvchi', salaryType: SalaryType.HOURLY, salary: 20000 * 100, branch: secondBranch },
  ];

  for (let i = 0; i < employeeDefs.length; i++) {
    const def = employeeDefs[i];
    const empUser = await userRepo.save(
      userRepo.create({
        username: `emp${i + 1}`,
        email: `emp${i + 1}@demo.uz`,
        phone: `+99890111${String(2240 + i).padStart(4, '0')}`,
        passwordHash: demoPasswordHash,
        role: UserRole.EMPLOYEE,
        companyId: company.id,
        isEmailVerified: true,
      }),
    );
    const employee = await employeeRepo.save(
      employeeRepo.create({
        companyId: company.id,
        branchId: def.branch.id,
        userId: empUser.id,
        firstName: def.first,
        lastName: def.last,
        gender: def.gender,
        position: def.position,
        department: def.branch.isMain ? 'Asosiy bo‘lim' : 'Filial bo‘limi',
        tabNumber: `T-${String(i + 1).padStart(3, '0')}`,
        hiredAt: '2026-01-01',
        status: EmployeeStatus.ACTIVE,
        salaryType: def.salaryType,
        salaryAmount: def.salary,
      }),
    );
    // Fake embeddinglar (2 tadan)
    for (let j = 0; j < 2; j++) {
      await embeddingRepo.save(
        embeddingRepo.create({
          employeeId: employee.id,
          embedding: fakeEmbedding(),
          sourcePhotoUrl: null,
          quality: 0.9,
        }),
      );
    }
  }

  // ---------- Qoidalar (maoshdan proporsional, daqiqa asosida) ----------
  const penaltyRepo = ds.getRepository(PenaltyRule);
  // Kechikish — har kechikkan daqiqa uchun maoshdan proporsional ushlab qolish (maosh/30/smena daqiqalari)
  await penaltyRepo.save(
    penaltyRepo.create({
      companyId: company.id,
      type: PenaltyType.LATE_SALARY,
      amount: 0,
      thresholdMinutes: 1,
      multiplier: 1,
      isActive: true,
    }),
  );
  // Erta ketish — har daqiqa uchun proporsional (LATE_SALARY bilan simmetrik)
  await penaltyRepo.save(
    penaltyRepo.create({
      companyId: company.id,
      type: PenaltyType.EARLY_LEAVE_SALARY,
      amount: 0,
      thresholdMinutes: 1,
      multiplier: 1,
      isActive: true,
    }),
  );
  // Sababsiz kelmagan — NOFAOL (kelmagan kun asosiy ish haqiga kirmaydi → ikki marta jarima bo'lmasin;
  // xohlansa panelдан yoqiladi).
  await penaltyRepo.save(
    penaltyRepo.create({
      companyId: company.id,
      type: PenaltyType.ABSENT_SALARY,
      amount: 0,
      thresholdMinutes: 0,
      multiplier: 1,
      isActive: false,
    }),
  );
  const bonusRepo = ds.getRepository(BonusRule);
  await bonusRepo.save(
    bonusRepo.create({
      companyId: company.id,
      type: BonusType.FULL_ATTENDANCE,
      amount: 300000 * 100,
    }),
  );
  await ds.getRepository(OvertimeRule).save(
    ds.getRepository(OvertimeRule).create({
      companyId: company.id,
      multiplier: 1.5,
      requiresApproval: false,
    }),
  );

  console.log('+ Demo kompaniya yaratildi (demo / Demo123!, xodimlar: emp1..emp5 / Demo123!)');
}

async function main(): Promise<void> {
  const ds = await AppDataSource.initialize();
  try {
    console.log('Seed boshlandi...');
    await seedSuperadmin(ds);
    const tariffs = await seedTariffs(ds);
    const business = tariffs.find((t) => t.name === 'Business')!;
    await seedDemoCompany(ds, business);
    console.log('Seed muvaffaqiyatli yakunlandi.');
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('Seed xatosi:', err);
  process.exit(1);
});
