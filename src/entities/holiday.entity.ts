import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Kompaniya bayram (ishlanmaydigan) kunlari. Bayram kuni:
 *  - kelish talab qilinmaydi (absent hisoblanmaydi, oylik kutilgan vaqtga kirmaydi);
 *  - ishlangan vaqt bayram koeffitsiyenti (OvertimeRule.holidayMultiplier) bilan to'lanadi.
 */
@Entity('holidays')
@Index('UQ_holidays_company_date', ['companyId', 'date'], { unique: true })
export class Holiday {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_holidays_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  /** 'YYYY-MM-DD' */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
