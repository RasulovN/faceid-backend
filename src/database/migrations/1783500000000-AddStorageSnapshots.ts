import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additiv migration: Storage Analytics moduli uchun soatlik snapshot jadvali.
 * Growth Analytics (kunlik/oylik o'sish) shu jadvaldan hisoblanadi.
 */
export class AddStorageSnapshots1783500000000 implements MigrationInterface {
  name = 'AddStorageSnapshots1783500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "storage_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "databaseSizeBytes" bigint NOT NULL,
        "totalRows" bigint NOT NULL,
        "totalTables" int NOT NULL,
        "companyStorage" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "tableStorage" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_storage_snapshots_createdAt" ON "storage_snapshots" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_storage_snapshots_createdAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "storage_snapshots"`);
  }
}
