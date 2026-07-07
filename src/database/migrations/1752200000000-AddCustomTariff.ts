import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custom (moslashtiriladigan) tarif + dinamik narx.
 * - `tariffs` ga: isCustom (bool, default false) va per-unit narxlar (bigint tiyin, default 0).
 * - `companies` ga: customLimits (jsonb, nullable) — custom tarifda tanlangan konfiguratsiya.
 * - Enterprise tarifni custom qilib backfill qiladi.
 *
 * Additiv migration — mavjud ma'lumotlarni buzmaydi.
 */
export class AddCustomTariff1752200000000 implements MigrationInterface {
  name = 'AddCustomTariff1752200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "isCustom" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "basePrice" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "pricePerBranch" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "pricePerEmployee" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "pricePerDevice" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "customLimits" jsonb`,
    );

    // Enterprise tarifni custom qilib backfill (tiyin qiymatlar)
    await queryRunner.query(
      `UPDATE "tariffs" SET
         "isCustom" = true,
         "basePrice" = $1,
         "pricePerBranch" = $2,
         "pricePerEmployee" = $3,
         "pricePerDevice" = $4
       WHERE "name" = 'Enterprise'`,
      [500000 * 100, 30000 * 100, 1500 * 100, 20000 * 100],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "customLimits"`);
    await queryRunner.query(`ALTER TABLE "tariffs" DROP COLUMN IF EXISTS "pricePerDevice"`);
    await queryRunner.query(`ALTER TABLE "tariffs" DROP COLUMN IF EXISTS "pricePerEmployee"`);
    await queryRunner.query(`ALTER TABLE "tariffs" DROP COLUMN IF EXISTS "pricePerBranch"`);
    await queryRunner.query(`ALTER TABLE "tariffs" DROP COLUMN IF EXISTS "basePrice"`);
    await queryRunner.query(`ALTER TABLE "tariffs" DROP COLUMN IF EXISTS "isCustom"`);
  }
}
