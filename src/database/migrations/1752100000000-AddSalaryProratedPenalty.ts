import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Maoshga-proporsional jarima turlari:
 * - `penalty_type_enum` ga LATE_SALARY va EARLY_LEAVE_SALARY qiymatlari qo'shiladi.
 * - `penalty_rules.multiplier` (float, default 1) — 1 = aynan 1 daqiqalik ish haqi.
 * Kechikkan/erta ketilgan har daqiqa uchun xodimning o'z maoshidan (oylik/30/smena/60)
 * proporsional ushlab qolinadi.
 */
export class AddSalaryProratedPenalty1752100000000 implements MigrationInterface {
  name = 'AddSalaryProratedPenalty1752100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "penalty_type_enum" ADD VALUE IF NOT EXISTS 'LATE_SALARY'`,
    );
    await queryRunner.query(
      `ALTER TYPE "penalty_type_enum" ADD VALUE IF NOT EXISTS 'EARLY_LEAVE_SALARY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "penalty_rules" ADD COLUMN IF NOT EXISTS "multiplier" double precision NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Enum qiymatini olib tashlash Postgres'da murakkab (ustunlar ishlatilayotgan bo'lishi mumkin) —
    // faqat qo'shilgan ustunni qaytaramiz.
    await queryRunner.query(`ALTER TABLE "penalty_rules" DROP COLUMN IF EXISTS "multiplier"`);
  }
}
