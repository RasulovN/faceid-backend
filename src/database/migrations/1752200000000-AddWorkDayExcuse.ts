import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sababli kun (excused day): `work_days` ga `isExcused` + `excuseReason` ustunlari.
 * Sababli belgilangan kunga jarima qo'llanmaydi va u davomat bonusini buzmaydi.
 */
export class AddWorkDayExcuse1752200000000 implements MigrationInterface {
  name = 'AddWorkDayExcuse1752200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "isExcused" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "excuseReason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_days" DROP COLUMN IF EXISTS "excuseReason"`);
    await queryRunner.query(`ALTER TABLE "work_days" DROP COLUMN IF EXISTS "isExcused"`);
  }
}
