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
import { PaymentProvider } from '../common/enums';
import type { PaymentFiscalData } from '../modules/payments/payme.types';
import { Tariff } from './tariff.entity';

const bigintToNumber = { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) };

/**
 * Payme holatlari: 0 — yaratilgan (kutilmoqda), 1 — tranzaksiya yaratilgan,
 * 2 — bajarilgan, -1 — bekor (yaratilgandan keyin), -2 — bekor (bajarilgandan keyin)
 */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_payments_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId: string | null;

  /** Checkout paytida tanlangan tarif va oylar soni */
  @Column({ type: 'uuid', nullable: true })
  tariffId: string | null;

  @ManyToOne(() => Tariff, { nullable: true })
  @JoinColumn({ name: 'tariffId' })
  tariff?: Tariff | null;

  @Column({ type: 'int', default: 1 })
  months: number;

  /** Summa, tiyin */
  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentProvider,
    enumName: 'payment_provider_enum',
    default: PaymentProvider.PAYME,
  })
  provider: PaymentProvider;

  @Index('IDX_payments_paymeTransactionId')
  @Column({ type: 'varchar', length: 64, nullable: true })
  paymeTransactionId: string | null;

  @Column({ type: 'int', default: 0 })
  state: number;

  /** Payme yuborgan tranzaksiya yaratilish vaqti (ms) */
  @Column({ type: 'bigint', nullable: true, transformer: bigintToNumber })
  paymeTime: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  performTime: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelTime: Date | null;

  @Column({ type: 'int', nullable: true })
  reason: number | null;

  /**
   * Payme SetFiscalData orqali kelgan soliq (fiskal) chek ma'lumotlari.
   * { perform?: FiscalEntry, cancel?: FiscalEntry } — chek turi bo'yicha.
   */
  @Column({ type: 'jsonb', nullable: true })
  fiscalData: PaymentFiscalData | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
