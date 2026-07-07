import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../entities';

loadEnv();

/**
 * TypeORM CLI va runtime uchun yagona DataSource.
 * Migration-first: synchronize har doim o'chirilgan.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgresql://faceid:faceid_dev_password@localhost:5432/faceid',
  entities: ALL_ENTITIES,
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn', 'migration'] : ['error'],
});

// DIQQAT: faqat BITTA DataSource eksporti bo'lishi shart (TypeORM CLI talabi).
// `export default` qo'shilsa "must contain only one export of DataSource" xatosi chiqadi.
