import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_audit_logs_userId')
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Index('IDX_audit_logs_companyId')
  @Column({ type: 'uuid', nullable: true })
  companyId: string | null;

  @Index('IDX_audit_logs_action')
  @Column({ type: 'varchar', length: 150 })
  action: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entityType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldValue: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  newValue: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Index('IDX_audit_logs_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
