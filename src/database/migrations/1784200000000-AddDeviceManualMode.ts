import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `devices.manualMode` (default false) — kioskda qo'lda Kirish/Chiqish rejimi.
 * Faqat direction=BOTH qurilmalar uchun ma'noli: xodim avval tugmani bosadi,
 * keyin yuz skanerlanadi — eshik yonidan o'tib ketganda kamera avtomatik
 * qayd qilib yubormasligi uchun himoya.
 */
export class AddDeviceManualMode1784200000000 implements MigrationInterface {
  name = 'AddDeviceManualMode1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "manualMode" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices" DROP COLUMN IF EXISTS "manualMode"`);
  }
}
