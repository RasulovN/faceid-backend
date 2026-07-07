import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Landing sahifa tashrifi — cookie-rozilik bergan mehmonlar analitikasi.
 * Bir sessiya = bitta yozuv; davomiylik heartbeat orqali server tomonda yangilanadi.
 * Geo (davlat/viloyat/shahar) IP bo'yicha asinxron to'ldiriladi.
 */
@Entity('site_visits')
export class SiteVisit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Anonim mehmon ID (365 kunlik cookie) — qaytgan tashrifchini aniqlash uchun */
  @Index('IDX_site_visits_visitorId')
  @Column({ type: 'varchar', length: 64 })
  visitorId: string;

  /** Brauzer sessiyasi ID (sessionStorage) — bitta kirish davri */
  @Index('IDX_site_visits_sessionId')
  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  @Index('IDX_site_visits_country')
  @Column({ type: 'varchar', length: 80, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  region: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  /** DESKTOP | MOBILE | TABLET */
  @Column({ type: 'varchar', length: 16 })
  deviceType: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  os: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  browser: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  referrer: string | null;

  /** Referrer'ning faqat host qismi — manbalar bo'yicha guruhlash uchun */
  @Column({ type: 'varchar', length: 190, nullable: true })
  referrerHost: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmSource: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmMedium: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmCampaign: string | null;

  @Column({ type: 'varchar', length: 255 })
  path: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  locale: string | null;

  @Column({ type: 'int', nullable: true })
  screenWidth: number | null;

  @Column({ type: 'int', nullable: true })
  screenHeight: number | null;

  /** visitorId birinchi marta yaratilgan tashrifmi (yangi mehmon) */
  @Column({ type: 'boolean', default: false })
  isNewVisitor: boolean;

  /** Sessiya davomiyligi (soniya) — heartbeat kelganda now()-createdAt dan hisoblanadi */
  @Column({ type: 'int', default: 0 })
  durationSeconds: number;

  @Index('IDX_site_visits_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
