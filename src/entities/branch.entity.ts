import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface WorkingHoursDay {
  dayOfWeek: number; // 1..7 (Dushanba=1)
  startTime: string; // 'HH:mm'
  endTime: string;
  breakMinutes: number;
}

@Entity('branches')
export class Branch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_branches_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  address: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) },
  })
  latitude: number | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) },
  })
  longitude: number | null;

  /** Geofence radiusi, metr */
  @Column({ type: 'int', default: 50 })
  geofenceRadius: number;

  @Column({ type: 'jsonb', nullable: true })
  workingHoursDefault: WorkingHoursDay[] | null;

  @Column({ type: 'boolean', default: false })
  isMain: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
