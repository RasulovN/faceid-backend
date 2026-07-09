import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additiv migration: kompaniyalarning tizimdan foydalanish rollupi (usage_daily).
 * Kompaniya × foydalanuvchi × kun kesimida requests/logins/actions hisoblanadi
 * (kun chegarasi Asia/Tashkent). Tarixiy davr audit_logs'dan backfill qilinadi
 * (faqat mutatsiyalar audit qilingani uchun taxminiy — requests=actions).
 * Qo'shimcha: attendance_events."timestamp" ga indeks (davomat skanlari agregati uchun).
 */
export class AddUsageDaily1784000000000 implements MigrationInterface {
  name = 'AddUsageDaily1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "usage_daily" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "date" date NOT NULL,
        "requests" int NOT NULL DEFAULT 0,
        "logins" int NOT NULL DEFAULT 0,
        "actions" int NOT NULL DEFAULT 0,
        CONSTRAINT "UQ_usage_daily_company_user_date" UNIQUE ("companyId", "userId", "date"),
        CONSTRAINT "FK_usage_daily_company" FOREIGN KEY ("companyId")
          REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_usage_daily_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_usage_daily_date" ON "usage_daily" ("date")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_daily_companyId" ON "usage_daily" ("companyId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_daily_user_date" ON "usage_daily" ("userId", "date")`,
    );
    // Davomat skanlarini davr bo'yicha agregatlash uchun (usage analitikasi)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_att_events_timestamp" ON "attendance_events" ("timestamp")`,
    );

    // Tarixiy backfill: audit_logs faqat mutatsiyalarni yozadi, shuning uchun
    // requests = actions (o'qishlar tarixda yo'q); login'lar audit'da userId'siz
    // yozilgani sabab 0 bo'ladi — bu taxminiy boshlang'ich nuqta, xolos.
    await queryRunner.query(`
      INSERT INTO "usage_daily" ("companyId", "userId", "date", "requests", "logins", "actions")
      SELECT
        "companyId",
        "userId",
        ("createdAt" AT TIME ZONE 'Asia/Tashkent')::date AS day,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE "action" = 'auth.login')::int,
        COUNT(*) FILTER (WHERE "action" NOT LIKE 'auth.%')::int
      FROM "audit_logs" a
      WHERE a."companyId" IS NOT NULL AND a."userId" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = a."companyId")
        AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."userId")
      GROUP BY 1, 2, 3
      ON CONFLICT ("companyId", "userId", "date") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_att_events_timestamp"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_usage_daily_user_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_usage_daily_companyId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_usage_daily_date"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "usage_daily"`);
  }
}
