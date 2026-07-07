import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CompanyStatus } from '../common/enums';
import { Tariff } from './tariff.entity';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index('UQ_companies_slug', { unique: true })
  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  logoUrl: string | null;

  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({
    type: 'enum',
    enum: CompanyStatus,
    enumName: 'company_status_enum',
    default: CompanyStatus.PENDING,
  })
  status: CompanyStatus;

  @Column({ type: 'uuid', nullable: true })
  tariffId: string | null;

  @ManyToOne(() => Tariff, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tariffId' })
  tariff?: Tariff | null;

  @Column({ type: 'timestamptz', nullable: true })
  subscriptionStartsAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  subscriptionEndsAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contactEmail: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  contactPhone: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 64, default: 'Asia/Tashkent' })
  timezone: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings: Record<string, unknown>;

  /**
   * Custom tarif tanlanganda kompaniya konfiguratsiyasi (effektiv limitlar).
   * `null` — oddiy tarif yoki hali tanlanmagan.
   */
  @Column({ type: 'jsonb', nullable: true })
  customLimits: { branches: number; employees: number; devices: number } | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
