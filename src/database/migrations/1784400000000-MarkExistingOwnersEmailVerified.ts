import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login endi COMPANY_OWNER uchun email tasdiqlanganini talab qiladi.
 * Ilgari ro'yxatdan o'tgan (feature'dan oldingi) egalar qulflanib qolmasligi
 * uchun mavjud ownerlarni tasdiqlangan deb belgilaymiz.
 */
export class MarkExistingOwnersEmailVerified1784400000000 implements MigrationInterface {
  name = 'MarkExistingOwnersEmailVerified1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "isEmailVerified" = true, "emailVerificationToken" = NULL
       WHERE "role" = 'COMPANY_OWNER' AND "isEmailVerified" = false`,
    );
  }

  public async down(): Promise<void> {
    // Ma'lumot yo'qolgani uchun (qaysi user oldin unverified bo'lgani) ortga qaytarilmaydi
  }
}
