import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Telegram bot orqali ulangan telefon → chat bog'lanishi (tenant'lararo umumiy).
 * Ota-ona botga kontaktini yuborganda yoziladi; o'quvchi davomati xabarlari
 * employees.parentPhone shu jadval orqali chatId'ga yetkaziladi.
 */
@Entity('telegram_contacts')
export class TelegramContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Normallashtirilgan format: +998XXXXXXXXX */
  @Index('UQ_telegram_contacts_phone', { unique: true })
  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'bigint' })
  chatId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
