import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - `penalty_type_enum` ga ABSENT_SALARY (sababsiz kelmagan kun uchun 1 kunlik ish haqi ushlash).
 * - `overtime_rules.isActive` (default true) — overtime haqini faol/nofaol qilish.
 * Mavjud kompaniyalarga backfill qilinmaydi (eski flat ABSENT bilan ikki marta jarima bo'lmasligi uchun);
 * yangi kompaniyalar registratsiyada toza default qoidalar oladi (RulesService.seedDefaultRules).
 */
export class AddAbsentSalaryAndOvertimeActive1752300000000 implements MigrationInterface {
  name = 'AddAbsentSalaryAndOvertimeActive1752300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "penalty_type_enum" ADD VALUE IF NOT EXISTS 'ABSENT_SALARY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "overtime_rules" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "overtime_rules" DROP COLUMN IF EXISTS "isActive"`);
  }
}
