import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EDUCATION vertikali: tizim endi ish davomatidan tashqari o'quv markazlarga
 * ham xizmat qiladi. Alohida "students" jadvali YARATILMAYDI — o'quvchilar
 * mavjud employees jadvalida personType=STUDENT bilan saqlanadi, shu tufayli
 * yuz galereyasi (face_embeddings), kiosk oqimi va attendance_events
 * o'zgarishsiz qayta ishlatiladi.
 *
 * - companies.industry: BUSINESS | EDUCATION (registratsiyada tanlanadi)
 * - employees.personType + parentPhone; userId endi nullable (o'quvchiga login yo'q)
 * - groups + group_students: o'quv guruhlari va a'zolik
 * - attendance_events.groupId: check-in qaysi darsga tegishli
 * - telegram_contacts: ota-ona telefoni ↔ Telegram chat bog'lanishi
 */
export class EducationVertical1784500000000 implements MigrationInterface {
  name = 'EducationVertical1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------- companies.industry ----------
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "company_industry_enum" AS ENUM ('BUSINESS', 'EDUCATION');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "industry" "company_industry_enum" NOT NULL DEFAULT 'BUSINESS'`,
    );

    // ---------- employees: personType, parentPhone, userId nullable ----------
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "person_type_enum" AS ENUM ('EMPLOYEE', 'STUDENT');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(
      `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "personType" "person_type_enum" NOT NULL DEFAULT 'EMPLOYEE'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_employees_personType" ON "employees" ("personType")`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "parentPhone" character varying(20)`,
    );
    await queryRunner.query(`ALTER TABLE "employees" ALTER COLUMN "userId" DROP NOT NULL`);

    // ---------- groups ----------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "groups" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL,
        "branchId" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
        "teacherId" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
        "name" character varying(150) NOT NULL,
        "days" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "gracePeriodMinutes" integer NOT NULL DEFAULT 10,
        "absentAfterMinutes" integer NOT NULL DEFAULT 20,
        "archived" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_groups" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_groups_companyId" ON "groups" ("companyId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_groups_branchId" ON "groups" ("branchId")`,
    );

    // ---------- group_students ----------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_students" (
        "groupId" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
        "studentId" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_students" PRIMARY KEY ("groupId", "studentId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_group_students_studentId" ON "group_students" ("studentId")`,
    );

    // ---------- attendance_events.groupId ----------
    await queryRunner.query(
      `ALTER TABLE "attendance_events" ADD COLUMN IF NOT EXISTS "groupId" uuid REFERENCES "groups"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_att_events_groupId" ON "attendance_events" ("groupId")`,
    );

    // ---------- telegram_contacts ----------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_contacts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "phone" character varying(20) NOT NULL,
        "chatId" bigint NOT NULL,
        "firstName" character varying(100),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_telegram_contacts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_telegram_contacts_phone" ON "telegram_contacts" ("phone")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_contacts"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_att_events_groupId"`);
    await queryRunner.query(`ALTER TABLE "attendance_events" DROP COLUMN IF EXISTS "groupId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_students"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "groups"`);
    // userId NOT NULL qaytarilmaydi — STUDENT qatorlari null qiymatga ega bo'lishi mumkin
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "parentPhone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_employees_personType"`);
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "personType"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "person_type_enum"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "industry"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "company_industry_enum"`);
  }
}
