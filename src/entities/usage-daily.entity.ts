import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Company } from './company.entity';
import { User } from './user.entity';

/**
 * Kunlik foydalanish rollupi (kompaniya × foydalanuvchi × kun).
 * Har muvaffaqiyatli so'rovda buferga yig'iladi va 15s da bir additiv upsert qilinadi
 * (usage-tracker.service). Kun chegarasi Asia/Tashkent bo'yicha.
 */
@Entity('usage_daily')
@Unique('UQ_usage_daily_company_user_date', ['companyId', 'userId', 'date'])
@Index('IDX_usage_daily_user_date', ['userId', 'date'])
export class UsageDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_usage_daily_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company?: Company;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Index('IDX_usage_daily_date')
  @Column({ type: 'date' })
  date: string;

  /** Barcha muvaffaqiyatli autentifikatsiyalangan so'rovlar (o'qishlar ham) */
  @Column({ type: 'int', default: 0 })
  requests: number;

  @Column({ type: 'int', default: 0 })
  logins: number;

  /** Yozuvchi so'rovlar: POST/PATCH/PUT/DELETE */
  @Column({ type: 'int', default: 0 })
  actions: number;
}
