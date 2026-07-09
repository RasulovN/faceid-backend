import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Mobil ilova xatolik logi — ilovadagi JS crash/xatolar public endpoint orqali
 * shu jadvalga tushadi va superadmin panelning "Mobil loglar" sahifasida ko'rinadi.
 * Ilova offline bo'lsa xato navbatga yozilib keyinroq yuboriladi (occurredAt ≠ createdAt).
 */
@Entity('mobile_error_logs')
export class MobileErrorLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Xato matni (Error.message) */
  @Column({ type: 'text' })
  message: string;

  /** Stack trace (bo'lsa) */
  @Column({ type: 'text', nullable: true })
  stack: string | null;

  /** Ilovani qulatgan (fatal) xatomi yoki ushlangan (ErrorBoundary) */
  @Index('IDX_mobile_error_logs_isFatal')
  @Column({ type: 'boolean', default: true })
  isFatal: boolean;

  /** android | ios */
  @Index('IDX_mobile_error_logs_platform')
  @Column({ type: 'varchar', length: 16 })
  platform: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  osVersion: string | null;

  /** Qurilma modeli (masalan "POCO X6 Pro 5G") */
  @Column({ type: 'varchar', length: 120, nullable: true })
  deviceModel: string | null;

  /** Ilova versiyasi (app.json version) */
  @Column({ type: 'varchar', length: 40, nullable: true })
  appVersion: string | null;

  /** Xato yuz bergan ekran (expo-router yo'li), bo'lsa */
  @Column({ type: 'varchar', length: 255, nullable: true })
  route: string | null;

  /** Login bo'lgan foydalanuvchi (bo'lsa) — tez ko'rish uchun denormalizatsiya */
  @Column({ type: 'varchar', length: 120, nullable: true })
  username: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** Qo'shimcha kontekst (componentStack va h.k.) */
  @Column({ type: 'jsonb', nullable: true })
  extra: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  /** NEW | RESOLVED — panelda ko'rib chiqilganini belgilash uchun */
  @Index('IDX_mobile_error_logs_status')
  @Column({ type: 'varchar', length: 16, default: 'NEW' })
  status: string;

  /** Xato qurilmada yuz bergan vaqt (offline navbatdan kelsa createdAt'dan oldin) */
  @Column({ type: 'timestamptz', nullable: true })
  occurredAt: Date | null;

  @Index('IDX_mobile_error_logs_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
