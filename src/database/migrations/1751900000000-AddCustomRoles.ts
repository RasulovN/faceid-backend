import { MigrationInterface, QueryRunner } from 'typeorm';
import { DEFAULT_ROLES } from '../../common/constants/default-roles';

/**
 * Additiv migration: kompaniya-scoped custom rollar.
 * - `roles` jadval + indekslar + FK (companies.id ON DELETE CASCADE)
 * - `users.roleId` ustun + FK (roles.id ON DELETE SET NULL)
 * - Mavjud har bir kompaniyaga 3 default (isSystem) rolni backfill qiladi.
 */
export class AddCustomRoles1751900000000 implements MigrationInterface {
  name = 'AddCustomRoles1751900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------- roles ----------
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL,
        "name" varchar(64) NOT NULL,
        "description" varchar(255),
        "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "isSystem" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_roles_company" FOREIGN KEY ("companyId")
          REFERENCES "companies"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_roles_companyId" ON "roles" ("companyId")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_roles_company_name" ON "roles" ("companyId", "name")`,
    );

    // ---------- users.roleId ----------
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "roleId" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_users_roleId" ON "users" ("roleId")`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_role" FOREIGN KEY ("roleId")
        REFERENCES "roles"("id") ON DELETE SET NULL`,
    );

    // ---------- Backfill: har bir kompaniyaga default system rollar ----------
    const companies: Array<{ id: string }> = await queryRunner.query(
      `SELECT "id" FROM "companies"`,
    );
    for (const company of companies) {
      for (const def of DEFAULT_ROLES) {
        await queryRunner.query(
          `INSERT INTO "roles" ("companyId", "name", "description", "permissions", "isSystem")
           VALUES ($1, $2, $3, $4::jsonb, true)
           ON CONFLICT ("companyId", "name") DO NOTHING`,
          [company.id, def.name, def.description, JSON.stringify(def.permissions)],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_role"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_roleId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "roleId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}
