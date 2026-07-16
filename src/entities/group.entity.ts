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
import { Branch } from './branch.entity';
import { Employee } from './employee.entity';

/** Guruh dars jadvali kuni — WorkSchedule.ScheduleDay bilan bir xil format (soddalashtirilgan) */
export interface LessonDay {
  dayOfWeek: number; // 1..7 (Dushanba=1)
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
}

/**
 * EDUCATION vertikali: o'quv guruhi (sinf). O'quvchilar group_students orqali
 * biriktiriladi; kioskdan o'tgan o'quvchining eventi shu guruh darsiga bog'lanadi.
 */
@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_groups_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  /** Guruh o'tadigan filial (kiosk shu filialda turadi) */
  @Index('IDX_groups_branchId')
  @Column({ type: 'uuid', nullable: true })
  branchId: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch | null;

  /** O'qituvchi — employees jadvalidagi personType=EMPLOYEE yozuvi */
  @Column({ type: 'uuid', nullable: true })
  teacherId: string | null;

  @ManyToOne(() => Employee, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teacherId' })
  teacher?: Employee | null;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** Dars jadvali: qaysi kunlari nechadan nechagacha */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  days: LessonDay[];

  /** Dars boshlangach shu daqiqagacha kelish kechikish hisoblanmaydi */
  @Column({ type: 'int', default: 10 })
  gracePeriodMinutes: number;

  /** Dars boshlangach shu daqiqadan keyin kelmaganlarga "kelmadi" xabari yuboriladi */
  @Column({ type: 'int', default: 20 })
  absentAfterMinutes: number;

  /** Arxivlangan guruh dars aniqlash va jurnalda qatnashmaydi */
  @Column({ type: 'boolean', default: false })
  archived: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
