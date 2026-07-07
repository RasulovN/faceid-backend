import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VAQT = PUL payroll engine uchun sxema kengaytmalari (barchasi additiv):
 *  - work_schedules.flexibleMinutes — moslashuvchan kelish oynasi (daqiqa);
 *  - overtime_rules.weekendMultiplier / holidayMultiplier — dam olish/bayram koeffitsiyentlari;
 *  - holidays — kompaniya bayram kunlari;
 *  - payroll_adjustments — avans/qarz/ushlanma/mukofot tuzatishlari.
 * ScheduleDay jsonb'iga lunchStart/lunchEnd qo'shildi — jsonb, migration talab qilmaydi.
 */
export class PayrollTimeEngine1783600000000 implements MigrationInterface {
  name = 'PayrollTimeEngine1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "work_schedules" ADD COLUMN IF NOT EXISTS "flexibleMinutes" int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "overtime_rules" ADD COLUMN IF NOT EXISTS "weekendMultiplier" double precision NOT NULL DEFAULT 2`,
    );
    await queryRunner.query(
      `ALTER TABLE "overtime_rules" ADD COLUMN IF NOT EXISTS "holidayMultiplier" double precision NOT NULL DEFAULT 2`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "holidays" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "date" date NOT NULL,
        "name" varchar(150) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_holidays_company_date" ON "holidays" ("companyId", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_holidays_companyId" ON "holidays" ("companyId")`,
    );

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "payroll_adjustment_type_enum" AS ENUM ('ADVANCE', 'LOAN', 'DEDUCTION', 'BONUS');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payroll_adjustments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "employeeId" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
        "periodMonth" varchar(7) NOT NULL,
        "type" "payroll_adjustment_type_enum" NOT NULL,
        "amount" bigint NOT NULL,
        "note" text,
        "createdByUserId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payroll_adjustments_companyId" ON "payroll_adjustments" ("companyId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payroll_adjustments_employee_period" ON "payroll_adjustments" ("employeeId", "periodMonth")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payroll_adjustments"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payroll_adjustment_type_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "holidays"`);
    await queryRunner.query(`ALTER TABLE "overtime_rules" DROP COLUMN IF EXISTS "holidayMultiplier"`);
    await queryRunner.query(`ALTER TABLE "overtime_rules" DROP COLUMN IF EXISTS "weekendMultiplier"`);
    await queryRunner.query(`ALTER TABLE "work_schedules" DROP COLUMN IF EXISTS "flexibleMinutes"`);
  }
}
