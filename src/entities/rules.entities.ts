import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BonusType, PenaltyType } from '../common/enums';

const bigintToNumber = { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) };

@Entity('penalty_rules')
export class PenaltyRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_penalty_rules_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'enum', enum: PenaltyType, enumName: 'penalty_type_enum' })
  type: PenaltyType;

  /** Jarima miqdori, tiyin (LATE_PER_MINUTE uchun — har daqiqaga) */
  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  /** Kechikish chegarasi (daqiqa) — undan oshsa jarima qo'llanadi */
  @Column({ type: 'int', default: 0 })
  thresholdMinutes: number;

  /**
   * LATE_SALARY / EARLY_LEAVE_SALARY turlari uchun ko'paytuvchi.
   * 1 = aynan 1 daqiqalik ish haqi, 1.5 = yarim baravar ko'proq jarima va h.k.
   * Boshqa turlar uchun e'tiborsiz qoldiriladi.
   */
  @Column({ type: 'float', default: 1 })
  multiplier: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('bonus_rules')
export class BonusRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_bonus_rules_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'enum', enum: BonusType, enumName: 'bonus_type_enum' })
  type: BonusType;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('overtime_rules')
export class OvertimeRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_overtime_rules_companyId', { unique: true })
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'float', default: 1.5 })
  multiplier: number;

  @Column({ type: 'boolean', default: false })
  requiresApproval: boolean;

  /** Overtime (qo'shimcha ish) haqi to'lanadimi — faol/nofaol to'gligi. */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
