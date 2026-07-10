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
import { DeviceDirection, DeviceType } from '../common/enums';
import { Branch } from './branch.entity';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_devices_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Index('IDX_devices_branchId')
  @Column({ type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { nullable: true })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Index('UQ_devices_deviceToken', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  deviceToken: string;

  @Column({ type: 'enum', enum: DeviceType, enumName: 'device_type_enum', default: DeviceType.KIOSK })
  type: DeviceType;

  @Column({
    type: 'enum',
    enum: DeviceDirection,
    enumName: 'device_direction_enum',
    default: DeviceDirection.BOTH,
  })
  direction: DeviceDirection;

  /**
   * Qo'lda rejim (faqat direction=BOTH uchun ma'noli): kioskda xodim avval
   * "Kirish" yoki "Chiqish" tugmasini bosadi, keyin yuz skanerlanadi.
   * Eshik yonidan shunchaki o'tib ketganda kamera avtomatik qayd
   * qilib yubormasligi uchun. Default: o'chirilgan (avtomatik rejim).
   */
  @Column({ type: 'boolean', default: false })
  manualMode: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
