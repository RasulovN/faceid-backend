import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('tariffs')
export class Tariff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Oylik narx, tiyin'da */
  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  priceMonthly: number;

  /** Custom (moslashtiriladigan) tarif — narx miqdorga qarab dinamik hisoblanadi */
  @Column({ type: 'boolean', default: false })
  isCustom: boolean;

  /** Custom tarif: bazaviy narx, tiyin'da */
  @Column({
    type: 'bigint',
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  basePrice: number;

  /** Custom tarif: har bir filial uchun narx, tiyin'da */
  @Column({
    type: 'bigint',
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  pricePerBranch: number;

  /** Custom tarif: har bir xodim uchun narx, tiyin'da */
  @Column({
    type: 'bigint',
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  pricePerEmployee: number;

  /** Custom tarif: har bir qurilma uchun narx, tiyin'da */
  @Column({
    type: 'bigint',
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  pricePerDevice: number;

  @Column({ type: 'int' })
  maxBranches: number;

  @Column({ type: 'int' })
  maxEmployees: number;

  @Column({ type: 'int' })
  maxDevices: number;

  @Column({ type: 'int', default: 365 })
  historyRetentionDays: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  features: string[];

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
