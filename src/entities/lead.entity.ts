import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadStatus } from '../common/enums';

/**
 * Landing sahifasidagi "Savolingiz bormi?" formasidan kelgan murojaatlar.
 * Superadmin panelda kanban (drag-drop) yoki ro'yxat ko'rinishida boshqariladi;
 * APPROVED/REJECTED bosqichiga o'tganda mijozga rasmiy email yuboriladi.
 */
@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 190 })
  email: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'text' })
  message: string;

  @Index('IDX_leads_status')
  @Column({
    type: 'enum',
    enum: LeadStatus,
    enumName: 'lead_status_enum',
    default: LeadStatus.NEW,
  })
  status: LeadStatus;

  /** Superadmin ichki izohi (mijozga ko'rinmaydi) */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Oxirgi statusni o'zgartirgan superadmin */
  @Column({ type: 'uuid', nullable: true })
  handledByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  statusChangedAt: Date | null;

  @Index('IDX_leads_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
