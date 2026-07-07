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
import { WorkDayStatus } from '../common/enums';
import { Employee } from './employee.entity';

@Entity('work_days')
@Index('UQ_work_days_employee_date', ['employeeId', 'date'], { unique: true })
export class WorkDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee;

  @Index('IDX_work_days_date')
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'int', default: 0 })
  scheduledMinutes: number;

  @Column({ type: 'int', default: 0 })
  workedMinutes: number;

  @Column({ type: 'int', default: 0 })
  lateMinutes: number;

  @Column({ type: 'int', default: 0 })
  earlyLeaveMinutes: number;

  @Column({ type: 'int', default: 0 })
  overtimeMinutes: number;

  @Column({ type: 'enum', enum: WorkDayStatus, enumName: 'work_day_status_enum' })
  status: WorkDayStatus;

  /**
   * Sababli kun — HR tomonidan uzrli deb belgilangan. Bunday kunga jarima
   * qo'llanmaydi va u davomat bonusini buzmaydi. `excuseReason` — izoh.
   */
  @Column({ type: 'boolean', default: false })
  isExcused: boolean;

  @Column({ type: 'text', nullable: true })
  excuseReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
