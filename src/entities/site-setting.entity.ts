import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Sayt (landing) uchun global sozlamalar — bitta qatorli singleton.
 * Superadmin paneldan tahrirlanadi, landing public endpoint orqali o'qiydi.
 */
@Entity('site_settings')
export class SiteSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ---------- Aloqa ----------
  @Column({ type: 'varchar', length: 255, default: '' })
  contactEmail: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  contactPhone: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  contactAddress: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  workingHours: string;

  // ---------- Ijtimoiy tarmoqlar (URL, bo'sh bo'lsa ko'rsatilmaydi) ----------
  @Column({ type: 'varchar', length: 512, default: '' })
  telegram: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  instagram: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  facebook: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  youtube: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  linkedin: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  twitter: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
