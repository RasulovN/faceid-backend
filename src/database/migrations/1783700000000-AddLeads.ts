import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Landing "Savolingiz bormi?" formasi murojaatlari (leads) — superadmin kanban:
 * NEW → CONTACTED → DEMO → APPROVED / REJECTED. Additiv.
 */
export class AddLeads1783700000000 implements MigrationInterface {
  name = 'AddLeads1783700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "lead_status_enum" AS ENUM ('NEW', 'CONTACTED', 'DEMO', 'APPROVED', 'REJECTED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(150) NOT NULL,
        "email" varchar(190) NOT NULL,
        "phone" varchar(50),
        "message" text NOT NULL,
        "status" "lead_status_enum" NOT NULL DEFAULT 'NEW',
        "note" text,
        "handledByUserId" uuid,
        "statusChangedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_leads_status" ON "leads" ("status")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_leads_createdAt" ON "leads" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "leads"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "lead_status_enum"`);
  }
}
