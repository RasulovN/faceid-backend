import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ScheduleType } from '../common/enums';

export interface ScheduleDay {
  dayOfWeek: number; // 1..7 (Dushanba=1)
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
  breakMinutes: number;
}

@Entity('work_schedules')
export class WorkSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_work_schedules_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  /** Filialga biriktirilgan grafik */
  @Index('IDX_work_schedules_branchId')
  @Column({ type: 'uuid', nullable: true })
  branchId: string | null;

  /** Individual override — muayyan xodim uchun */
  @Index('IDX_work_schedules_employeeId')
  @Column({ type: 'uuid', nullable: true })
  employeeId: string | null;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'enum', enum: ScheduleType, enumName: 'schedule_type_enum', default: ScheduleType.FIXED })
  type: ScheduleType;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  days: ScheduleDay[];

  @Column({ type: 'int', default: 10 })
  gracePeriodMinutes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
