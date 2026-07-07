import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EmployeeStatus, Gender, SalaryType } from '../common/enums';
import { decryptString, encryptString } from '../common/utils/crypto.util';
import { Branch } from './branch.entity';
import { User } from './user.entity';

const bigintToNumber = { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) };

@Entity('employees')
@Index('UQ_employees_company_tab', ['companyId', 'tabNumber'], { unique: true })
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_employees_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Index('IDX_employees_branchId')
  @Column({ type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { nullable: true })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  @Index('UQ_employees_userId', { unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  middleName: string | null;

  @Column({ type: 'date', nullable: true })
  birthDate: string | null;

  @Column({ type: 'enum', enum: Gender, enumName: 'gender_enum', nullable: true })
  gender: Gender | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  position: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 50 })
  tabNumber: string;

  @Column({ type: 'date', nullable: true })
  hiredAt: string | null;

  @Column({ type: 'date', nullable: true })
  firedAt: string | null;

  @Column({
    type: 'enum',
    enum: EmployeeStatus,
    enumName: 'employee_status_enum',
    default: EmployeeStatus.ACTIVE,
  })
  status: EmployeeStatus;

  @Column({ type: 'enum', enum: SalaryType, enumName: 'salary_type_enum', default: SalaryType.FIXED })
  salaryType: SalaryType;

  /** FIXED: oylik (tiyin). HOURLY: soatlik stavka (tiyin). */
  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  salaryAmount: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  photoUrls: string[];

  /** Passport seriyasi — DB'da AES-256-GCM bilan shifrlangan holda saqlanadi */
  @Column({
    name: 'passportSeriesEnc',
    type: 'text',
    nullable: true,
    transformer: {
      to: (v?: string | null) => (v ? encryptString(v) : null),
      from: (v?: string | null) => (v ? decryptString(v) : null),
    },
  })
  passportSeries: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  get fullName(): string {
    return [this.lastName, this.firstName, this.middleName].filter(Boolean).join(' ');
  }
}
