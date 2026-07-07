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
  endTime: string; // 'HH:mm' (endTime <= startTime bo'lsa — tungi smena, keyingi kunga o'tadi)
  /** Legacy: tushlik oynasi ko'rsatilmagan grafiklar uchun tanaffus (daqiqa) */
  breakMinutes: number;
  /** Tushlik oynasi — bu oraliqdagi ish vaqti hisobga olinmaydi (masalan 13:00–14:00) */
  lunchStart?: string | null; // 'HH:mm'
  lunchEnd?: string | null; // 'HH:mm'
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

  /**
   * Moslashuvchan kelish oynasi (daqiqa): start..start+flexible oralig'ida kelish
   * kechikish hisoblanmaydi; kutilgan ketish vaqti kelishga mos ravishda suriladi.
   */
  @Column({ type: 'int', default: 0 })
  flexibleMinutes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
