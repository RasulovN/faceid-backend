import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xodim yaratishda email va telefondan faqat bittasi majburiy bo'lishi uchun
 * `users.email` va `users.phone` NULL bo'lishi mumkin qilinadi.
 * Unique indekslar saqlanadi — Postgres'da NULL qiymatlar unique'ga zid emas.
 */
export class UsersEmailPhoneOptional1784300000000 implements MigrationInterface {
  name = 'UsersEmailPhoneOptional1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`);
  }
}
