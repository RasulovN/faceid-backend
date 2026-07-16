import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O'quvchiga BIR NECHTA ota-ona telefoni: employees.parentPhone (varchar)
 * → employees.parentPhones (jsonb massiv). Mavjud qiymatlar massivga o'raladi.
 * GIN index — Telegram bot telefon bo'yicha o'quvchi qidirishda (@> containment).
 */
export class ParentPhonesMulti1784600000000 implements MigrationInterface {
  name = 'ParentPhonesMulti1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "parentPhones" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(`
      UPDATE "employees"
      SET "parentPhones" = jsonb_build_array("parentPhone")
      WHERE "parentPhone" IS NOT NULL AND "parentPhone" != ''
    `);
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "parentPhone"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_employees_parentPhones" ON "employees" USING GIN ("parentPhones")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_employees_parentPhones"`);
    await queryRunner.query(
      `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "parentPhone" character varying(20)`,
    );
    await queryRunner.query(`
      UPDATE "employees"
      SET "parentPhone" = "parentPhones"->>0
      WHERE jsonb_array_length("parentPhones") > 0
    `);
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "parentPhones"`);
  }
}
