import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AttendanceEventType, AttendanceSource } from '../common/enums';
import { Branch } from './branch.entity';
import { Employee } from './employee.entity';
import { Group } from './group.entity';

const numericTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v == null ? null : Number(v)),
};

@Entity('attendance_events')
@Index('IDX_att_events_employee_ts', ['employeeId', 'timestamp'])
@Index('IDX_att_events_branch_ts', ['branchId', 'timestamp'])
export class AttendanceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee;

  @Column({ type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { nullable: true })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  /** EDUCATION: o'quvchi check-in qilganda aniqlangan dars guruhi */
  @Index('IDX_att_events_groupId')
  @Column({ type: 'uuid', nullable: true })
  groupId: string | null;

  @ManyToOne(() => Group, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'groupId' })
  group?: Group | null;

  @Column({ type: 'enum', enum: AttendanceEventType, enumName: 'attendance_event_type_enum' })
  type: AttendanceEventType;

  @Column({ type: 'enum', enum: AttendanceSource, enumName: 'attendance_source_enum' })
  source: AttendanceSource;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'float', nullable: true })
  confidence: number | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  snapshotUrl: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, transformer: numericTransformer })
  latitude: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, transformer: numericTransformer })
  longitude: number | null;

  @Column({ type: 'float', nullable: true })
  livenessScore: number | null;

  @Column({ type: 'boolean', default: false })
  isManual: boolean;

  @Column({ type: 'uuid', nullable: true })
  manualByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
