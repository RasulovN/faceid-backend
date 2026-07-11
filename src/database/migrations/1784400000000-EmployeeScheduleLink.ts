import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xodim ↔ grafik bog'lanishi endi to'g'ridan-to'g'ri FK orqali:
 * `employees.scheduleId` → work_schedules(id).
 *
 * Avval har biriktirishda shablon "Nomi (Ism Familiya)" ko'rinishida
 * KLONLANIB individual (employeeId'li) grafik yaratilardi — natijada
 * panel ro'yxati har xodim uchun alohida grafik bilan to'lib ketardi.
 *
 * Data-migratsiya: mavjud klonlar nomidagi " (…)" suffiksi bo'yicha asl
 * shablonga qayta bog'lanadi va o'chiriladi; asli topilmagan klon
 * xodimga o'zi biriktirilib qoladi (ro'yxatda baribir ko'rinmaydi —
 * findAll endi employeeId IS NULL bilan filtrlaydi).
 */
export class EmployeeScheduleLink1784400000000 implements MigrationInterface {
  name = 'EmployeeScheduleLink1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "scheduleId" uuid REFERENCES "work_schedules"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_employees_scheduleId" ON "employees" ("scheduleId")`,
    );

    // Klonni nomi bo'yicha asl shablonga moslashtiramiz; topilmasa klonning o'ziga bog'laymiz
    await queryRunner.query(`
      UPDATE "employees" e
      SET "scheduleId" = COALESCE(b.id, c.id)
      FROM "work_schedules" c
      LEFT JOIN "work_schedules" b
        ON b."companyId" = c."companyId"
       AND b."employeeId" IS NULL
       AND b."name" = regexp_replace(c."name", ' \\([^)]*\\)$', '')
      WHERE c."employeeId" = e.id
    `);

    // Asl shablonga bog'langan xodimlarning klon-grafiklarini o'chiramiz
    await queryRunner.query(`
      DELETE FROM "work_schedules" c
      USING "employees" e
      WHERE c."employeeId" = e.id AND e."scheduleId" IS DISTINCT FROM c.id
    `);

    // Egasi (xodimi) allaqachon o'chirilgan yetim klonlarni ham tozalaymiz
    await queryRunner.query(`
      DELETE FROM "work_schedules" c
      WHERE c."employeeId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "employees" e WHERE e.id = c."employeeId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Klonlar qayta tiklanmaydi — faqat ustun olib tashlanadi
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_employees_scheduleId"`);
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "scheduleId"`);
  }
}
