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
import { SubscriptionStatus } from '../common/enums';
import { Tariff } from './tariff.entity';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_subscriptions_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  tariffId: string;

  @ManyToOne(() => Tariff, { nullable: true })
  @JoinColumn({ name: 'tariffId' })
  tariff?: Tariff;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    enumName: 'subscription_status_enum',
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  /** Trial obunami (checkoutdan emas, ro'yxatdan o'tishda berilgan) */
  @Column({ type: 'boolean', default: false })
  isTrial: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
