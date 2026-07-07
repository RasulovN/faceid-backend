import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sayt (landing) global sozlamalari — bitta qatorli singleton jadval.
 * Aloqa maʼlumotlari + ijtimoiy tarmoq havolalari. Superadmin paneldan tahrirlanadi.
 * Landing'dagi hozirgi qattiq (hardcoded) qiymatlar bilan default qator seed qilinadi.
 */
export class AddSiteSettings1752000000000 implements MigrationInterface {
  name = 'AddSiteSettings1752000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "site_settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contactEmail" varchar(255) NOT NULL DEFAULT '',
        "contactPhone" varchar(64) NOT NULL DEFAULT '',
        "contactAddress" varchar(512) NOT NULL DEFAULT '',
        "workingHours" varchar(255) NOT NULL DEFAULT '',
        "telegram" varchar(512) NOT NULL DEFAULT '',
        "instagram" varchar(512) NOT NULL DEFAULT '',
        "facebook" varchar(512) NOT NULL DEFAULT '',
        "youtube" varchar(512) NOT NULL DEFAULT '',
        "linkedin" varchar(512) NOT NULL DEFAULT '',
        "twitter" varchar(512) NOT NULL DEFAULT '',
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `INSERT INTO "site_settings"
        ("contactEmail", "contactPhone", "contactAddress", "workingHours", "telegram", "instagram")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'info@faceid.uz',
        '+998 71 200 00 00',
        "Toshkent sh., Mirobod tumani, Amir Temur ko'chasi 108",
        'Du–Ju: 09:00–18:00, Sh: 10:00–14:00',
        'https://t.me/faceid',
        'https://instagram.com/faceid',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "site_settings"`);
  }
}
