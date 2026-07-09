import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additiv migration: mobil ilova xatolik loglari (mobile_error_logs).
 * Ilovadagi JS crash/xatolar superadmin panelda ko'rish uchun saqlanadi.
 */
export class AddMobileErrorLogs1784100000000 implements MigrationInterface {
  name = 'AddMobileErrorLogs1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mobile_error_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "message" text NOT NULL,
        "stack" text,
        "isFatal" boolean NOT NULL DEFAULT true,
        "platform" varchar(16) NOT NULL,
        "osVersion" varchar(40),
        "deviceModel" varchar(120),
        "appVersion" varchar(40),
        "route" varchar(255),
        "username" varchar(120),
        "userId" uuid,
        "extra" jsonb,
        "ip" varchar(45) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'NEW',
        "occurredAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_mobile_error_logs_createdAt" ON "mobile_error_logs" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_mobile_error_logs_platform" ON "mobile_error_logs" ("platform")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_mobile_error_logs_status" ON "mobile_error_logs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_mobile_error_logs_isFatal" ON "mobile_error_logs" ("isFatal")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mobile_error_logs_isFatal"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mobile_error_logs_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mobile_error_logs_platform"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mobile_error_logs_createdAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mobile_error_logs"`);
  }
}
