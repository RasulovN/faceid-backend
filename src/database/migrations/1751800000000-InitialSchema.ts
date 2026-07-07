import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Boshlang'ich sxema: barcha jadvallar, indekslar, pgvector extension
 * va face_embeddings.embedding uchun ivfflat indeks.
 */
export class InitialSchema1751800000000 implements MigrationInterface {
  name = 'InitialSchema1751800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // ---------- Enum tiplar ----------
    await queryRunner.query(
      `CREATE TYPE "user_role_enum" AS ENUM ('SUPERADMIN','COMPANY_OWNER','COMPANY_ADMIN','BRANCH_MANAGER','HR','EMPLOYEE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "company_status_enum" AS ENUM ('PENDING','ACTIVE','SUSPENDED','EXPIRED')`,
    );
    await queryRunner.query(`CREATE TYPE "gender_enum" AS ENUM ('MALE','FEMALE')`);
    await queryRunner.query(
      `CREATE TYPE "employee_status_enum" AS ENUM ('ACTIVE','VACATION','FIRED')`,
    );
    await queryRunner.query(`CREATE TYPE "salary_type_enum" AS ENUM ('FIXED','HOURLY')`);
    await queryRunner.query(
      `CREATE TYPE "schedule_type_enum" AS ENUM ('FIXED','SHIFT','FLEXIBLE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "attendance_event_type_enum" AS ENUM ('CHECK_IN','CHECK_OUT')`,
    );
    await queryRunner.query(`CREATE TYPE "attendance_source_enum" AS ENUM ('KIOSK','MOBILE')`);
    await queryRunner.query(
      `CREATE TYPE "work_day_status_enum" AS ENUM ('PRESENT','LATE','ABSENT','VACATION','SICK')`,
    );
    await queryRunner.query(
      `CREATE TYPE "penalty_type_enum" AS ENUM ('LATE_FIXED','LATE_PER_MINUTE','ABSENT')`,
    );
    await queryRunner.query(`CREATE TYPE "bonus_type_enum" AS ENUM ('FULL_ATTENDANCE','OVERTIME')`);
    await queryRunner.query(
      `CREATE TYPE "payroll_status_enum" AS ENUM ('DRAFT','APPROVED','PAID')`,
    );
    await queryRunner.query(`CREATE TYPE "device_type_enum" AS ENUM ('KIOSK')`);
    await queryRunner.query(`CREATE TYPE "device_direction_enum" AS ENUM ('IN','OUT','BOTH')`);
    await queryRunner.query(
      `CREATE TYPE "subscription_status_enum" AS ENUM ('ACTIVE','EXPIRED','CANCELLED')`,
    );
    await queryRunner.query(`CREATE TYPE "payment_provider_enum" AS ENUM ('PAYME')`);

    // ---------- users ----------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "username" varchar(64) NOT NULL,
        "email" varchar(255) NOT NULL,
        "phone" varchar(20) NOT NULL,
        "passwordHash" varchar(255) NOT NULL,
        "role" "user_role_enum" NOT NULL,
        "companyId" uuid,
        "isEmailVerified" boolean NOT NULL DEFAULT false,
        "emailVerificationToken" varchar(128),
        "passwordResetToken" varchar(128),
        "passwordResetExpiresAt" timestamptz,
        "refreshTokenHash" varchar(255),
        "avatarUrl" varchar(512),
        "lastLoginAt" timestamptz,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "deletedAt" timestamptz
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_username" ON "users" ("username")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_phone" ON "users" ("phone")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_companyId" ON "users" ("companyId")`);

    // ---------- tariffs ----------
    await queryRunner.query(`
      CREATE TABLE "tariffs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "description" text,
        "priceMonthly" bigint NOT NULL,
        "maxBranches" int NOT NULL,
        "maxEmployees" int NOT NULL,
        "maxDevices" int NOT NULL,
        "historyRetentionDays" int NOT NULL DEFAULT 365,
        "features" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "isActive" boolean NOT NULL DEFAULT true,
        "sortOrder" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ---------- companies ----------
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "slug" varchar(80) NOT NULL,
        "logoUrl" varchar(512),
        "ownerId" uuid,
        "status" "company_status_enum" NOT NULL DEFAULT 'PENDING',
        "tariffId" uuid REFERENCES "tariffs"("id") ON DELETE SET NULL,
        "subscriptionStartsAt" timestamptz,
        "subscriptionEndsAt" timestamptz,
        "contactEmail" varchar(255),
        "contactPhone" varchar(20),
        "address" varchar(512),
        "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Tashkent',
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_companies_slug" ON "companies" ("slug")`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL`,
    );

    // ---------- branches ----------
    await queryRunner.query(`
      CREATE TABLE "branches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name" varchar(255) NOT NULL,
        "address" varchar(512),
        "latitude" decimal(10,7),
        "longitude" decimal(10,7),
        "geofenceRadius" int NOT NULL DEFAULT 50,
        "workingHoursDefault" jsonb,
        "isMain" boolean NOT NULL DEFAULT false,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_branches_companyId" ON "branches" ("companyId")`);

    // ---------- employees ----------
    await queryRunner.query(`
      CREATE TABLE "employees" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "branchId" uuid NOT NULL REFERENCES "branches"("id"),
        "userId" uuid NOT NULL REFERENCES "users"("id"),
        "firstName" varchar(100) NOT NULL,
        "lastName" varchar(100) NOT NULL,
        "middleName" varchar(100),
        "birthDate" date,
        "gender" "gender_enum",
        "position" varchar(150),
        "department" varchar(150),
        "tabNumber" varchar(50) NOT NULL,
        "hiredAt" date,
        "firedAt" date,
        "status" "employee_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "salaryType" "salary_type_enum" NOT NULL DEFAULT 'FIXED',
        "salaryAmount" bigint NOT NULL DEFAULT 0,
        "photoUrls" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "passportSeriesEnc" text,
        "notes" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "deletedAt" timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_employees_companyId" ON "employees" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_employees_branchId" ON "employees" ("branchId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_employees_userId" ON "employees" ("userId")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_employees_company_tab" ON "employees" ("companyId", "tabNumber")`,
    );

    // ---------- face_embeddings ----------
    await queryRunner.query(`
      CREATE TABLE "face_embeddings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
        "embedding" vector(512) NOT NULL,
        "sourcePhotoUrl" varchar(512),
        "quality" float,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_face_embeddings_employeeId" ON "face_embeddings" ("employeeId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_face_embeddings_embedding" ON "face_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100)`,
    );

    // ---------- work_schedules ----------
    await queryRunner.query(`
      CREATE TABLE "work_schedules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "branchId" uuid REFERENCES "branches"("id") ON DELETE CASCADE,
        "employeeId" uuid REFERENCES "employees"("id") ON DELETE CASCADE,
        "name" varchar(150) NOT NULL,
        "type" "schedule_type_enum" NOT NULL DEFAULT 'FIXED',
        "days" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "gracePeriodMinutes" int NOT NULL DEFAULT 10,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_work_schedules_companyId" ON "work_schedules" ("companyId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_work_schedules_branchId" ON "work_schedules" ("branchId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_work_schedules_employeeId" ON "work_schedules" ("employeeId")`,
    );

    // ---------- devices ----------
    await queryRunner.query(`
      CREATE TABLE "devices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "branchId" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
        "name" varchar(150) NOT NULL,
        "deviceToken" varchar(128) NOT NULL,
        "type" "device_type_enum" NOT NULL DEFAULT 'KIOSK',
        "direction" "device_direction_enum" NOT NULL DEFAULT 'BOTH',
        "lastSeenAt" timestamptz,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_devices_deviceToken" ON "devices" ("deviceToken")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_devices_companyId" ON "devices" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_devices_branchId" ON "devices" ("branchId")`);

    // ---------- attendance_events ----------
    await queryRunner.query(`
      CREATE TABLE "attendance_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
        "branchId" uuid NOT NULL REFERENCES "branches"("id"),
        "deviceId" uuid REFERENCES "devices"("id") ON DELETE SET NULL,
        "type" "attendance_event_type_enum" NOT NULL,
        "source" "attendance_source_enum" NOT NULL,
        "timestamp" timestamptz NOT NULL,
        "confidence" float,
        "snapshotUrl" varchar(512),
        "latitude" decimal(10,7),
        "longitude" decimal(10,7),
        "livenessScore" float,
        "isManual" boolean NOT NULL DEFAULT false,
        "manualByUserId" uuid,
        "note" text,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_att_events_employee_ts" ON "attendance_events" ("employeeId", "timestamp")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_events_branch_ts" ON "attendance_events" ("branchId", "timestamp")`,
    );

    // ---------- work_days ----------
    await queryRunner.query(`
      CREATE TABLE "work_days" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
        "date" date NOT NULL,
        "scheduledMinutes" int NOT NULL DEFAULT 0,
        "workedMinutes" int NOT NULL DEFAULT 0,
        "lateMinutes" int NOT NULL DEFAULT 0,
        "earlyLeaveMinutes" int NOT NULL DEFAULT 0,
        "overtimeMinutes" int NOT NULL DEFAULT 0,
        "status" "work_day_status_enum" NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_work_days_employee_date" ON "work_days" ("employeeId", "date")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_work_days_date" ON "work_days" ("date")`);

    // ---------- penalty_rules / bonus_rules / overtime_rules ----------
    await queryRunner.query(`
      CREATE TABLE "penalty_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "type" "penalty_type_enum" NOT NULL,
        "amount" bigint NOT NULL,
        "thresholdMinutes" int NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_penalty_rules_companyId" ON "penalty_rules" ("companyId")`,
    );
    await queryRunner.query(`
      CREATE TABLE "bonus_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "type" "bonus_type_enum" NOT NULL,
        "amount" bigint NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_bonus_rules_companyId" ON "bonus_rules" ("companyId")`,
    );
    await queryRunner.query(`
      CREATE TABLE "overtime_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "multiplier" float NOT NULL DEFAULT 1.5,
        "requiresApproval" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_overtime_rules_companyId" ON "overtime_rules" ("companyId")`,
    );

    // ---------- payroll_records ----------
    await queryRunner.query(`
      CREATE TABLE "payroll_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
        "periodMonth" varchar(7) NOT NULL,
        "baseSalary" bigint NOT NULL DEFAULT 0,
        "workedMinutes" int NOT NULL DEFAULT 0,
        "overtimeAmount" bigint NOT NULL DEFAULT 0,
        "penaltyAmount" bigint NOT NULL DEFAULT 0,
        "bonusAmount" bigint NOT NULL DEFAULT 0,
        "totalAmount" bigint NOT NULL DEFAULT 0,
        "status" "payroll_status_enum" NOT NULL DEFAULT 'DRAFT',
        "breakdown" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "generatedAt" timestamptz,
        "approvedByUserId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_payroll_employee_period" ON "payroll_records" ("employeeId", "periodMonth")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payroll_periodMonth" ON "payroll_records" ("periodMonth")`,
    );

    // ---------- subscriptions ----------
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "tariffId" uuid NOT NULL REFERENCES "tariffs"("id"),
        "startsAt" timestamptz NOT NULL,
        "endsAt" timestamptz NOT NULL,
        "status" "subscription_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "isTrial" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_companyId" ON "subscriptions" ("companyId")`,
    );

    // ---------- payments ----------
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "subscriptionId" uuid REFERENCES "subscriptions"("id") ON DELETE SET NULL,
        "tariffId" uuid REFERENCES "tariffs"("id") ON DELETE SET NULL,
        "months" int NOT NULL DEFAULT 1,
        "amount" bigint NOT NULL,
        "provider" "payment_provider_enum" NOT NULL DEFAULT 'PAYME',
        "paymeTransactionId" varchar(64),
        "state" int NOT NULL DEFAULT 0,
        "paymeTime" bigint,
        "performTime" timestamptz,
        "cancelTime" timestamptz,
        "reason" int,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_companyId" ON "payments" ("companyId")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_paymeTransactionId" ON "payments" ("paymeTransactionId")`,
    );

    // ---------- audit_logs ----------
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid,
        "companyId" uuid,
        "action" varchar(150) NOT NULL,
        "entityType" varchar(100),
        "entityId" varchar(64),
        "oldValue" jsonb,
        "newValue" jsonb,
        "ip" varchar(64),
        "userAgent" varchar(512),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_userId" ON "audit_logs" ("userId")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_companyId" ON "audit_logs" ("companyId")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" ("action")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_createdAt" ON "audit_logs" ("createdAt")`,
    );

    // ---------- notifications ----------
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type" varchar(100) NOT NULL,
        "title" varchar(255) NOT NULL,
        "body" text NOT NULL,
        "isRead" boolean NOT NULL DEFAULT false,
        "meta" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_userId" ON "notifications" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payroll_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "overtime_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bonus_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "penalty_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "work_days"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "devices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "work_schedules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "face_embeddings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employees"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "branches"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_company"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "companies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tariffs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    for (const t of [
      'user_role_enum',
      'company_status_enum',
      'gender_enum',
      'employee_status_enum',
      'salary_type_enum',
      'schedule_type_enum',
      'attendance_event_type_enum',
      'attendance_source_enum',
      'work_day_status_enum',
      'penalty_type_enum',
      'bonus_type_enum',
      'payroll_status_enum',
      'device_type_enum',
      'device_direction_enum',
      'subscription_status_enum',
      'payment_provider_enum',
    ]) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${t}"`);
    }
  }
}
