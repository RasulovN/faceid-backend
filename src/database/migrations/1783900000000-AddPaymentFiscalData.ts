import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additiv migration: to'lovga fiskal (soliq) chek ma'lumotlari ustuni.
 * Payme SetFiscalData metodi orqali kelgan PERFORM/CANCEL fiskal cheklari saqlanadi.
 */
export class AddPaymentFiscalData1783900000000 implements MigrationInterface {
  name = 'AddPaymentFiscalData1783900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "fiscalData" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "fiscalData"`);
  }
}
