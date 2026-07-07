import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PayrollAdjustmentType } from '../common/enums';
import { Employee } from './employee.entity';

const bigintToNumber = { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) };

/**
 * Oylikka qo'lda kiritiladigan tuzatishlar: avans (ADVANCE), qarz ushlanmasi (LOAN),
 * boshqa ushlanma (DEDUCTION) yoki qo'shimcha mukofot (BONUS, masalan performance bonus).
 * Payroll generatsiyasida davr bo'yicha avtomatik qo'shiladi/ayiriladi.
 */
@Entity('payroll_adjustments')
export class PayrollAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_payroll_adjustments_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Index('IDX_payroll_adjustments_employee_period')
  @Column({ type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee;

  /** 'YYYY-MM' */
  @Column({ type: 'varchar', length: 7 })
  periodMonth: string;

  @Column({
    type: 'enum',
    enum: PayrollAdjustmentType,
    enumName: 'payroll_adjustment_type_enum',
  })
  type: PayrollAdjustmentType;

  /** Summa, tiyin (musbat; BONUS qo'shiladi, qolganlari ayiriladi) */
  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
