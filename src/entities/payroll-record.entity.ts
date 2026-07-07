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
import { PayrollStatus } from '../common/enums';
import { Employee } from './employee.entity';

const bigintToNumber = { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) };

@Entity('payroll_records')
@Index('UQ_payroll_employee_period', ['employeeId', 'periodMonth'], { unique: true })
export class PayrollRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee;

  /** 'YYYY-MM' */
  @Index('IDX_payroll_periodMonth')
  @Column({ type: 'varchar', length: 7 })
  periodMonth: string;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  baseSalary: number;

  @Column({ type: 'int', default: 0 })
  workedMinutes: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  overtimeAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  penaltyAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  bonusAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  totalAmount: number;

  @Column({
    type: 'enum',
    enum: PayrollStatus,
    enumName: 'payroll_status_enum',
    default: PayrollStatus.DRAFT,
  })
  status: PayrollStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  breakdown: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
