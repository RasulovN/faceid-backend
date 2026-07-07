import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additiv migration: landing sahifa tashriflari analitikasi (site_visits).
 * Cookie-rozilik bergan mehmonlar: IP/hudud, qurilma, manba, davomiylik.
 */
export class AddSiteVisits1783800000000 implements MigrationInterface {
  name = 'AddSiteVisits1783800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "site_visits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "visitorId" varchar(64) NOT NULL,
        "sessionId" varchar(64) NOT NULL,
        "ip" varchar(45) NOT NULL,
        "country" varchar(80),
        "region" varchar(120),
        "city" varchar(120),
        "deviceType" varchar(16) NOT NULL,
        "os" varchar(40),
        "browser" varchar(40),
        "referrer" varchar(512),
        "referrerHost" varchar(190),
        "utmSource" varchar(120),
        "utmMedium" varchar(120),
        "utmCampaign" varchar(120),
        "path" varchar(255) NOT NULL,
        "locale" varchar(8),
        "screenWidth" int,
        "screenHeight" int,
        "isNewVisitor" boolean NOT NULL DEFAULT false,
        "durationSeconds" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_site_visits_createdAt" ON "site_visits" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_site_visits_visitorId" ON "site_visits" ("visitorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_site_visits_sessionId" ON "site_visits" ("sessionId")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_site_visits_country" ON "site_visits" ("country")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_site_visits_country"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_site_visits_sessionId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_site_visits_visitorId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_site_visits_createdAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "site_visits"`);
  }
}
