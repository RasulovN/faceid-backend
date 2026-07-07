import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Kompaniya-scoped dinamik rol (custom role).
 * Enum UserRole routing/account-type uchun qoladi; bu rol enum ustiga
 * qo'shiladigan granular permission manbai.
 */
@Entity('roles')
@Index('UQ_roles_company_name', ['companyId', 'name'], { unique: true })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_roles_companyId')
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /** PERMISSIONS katalogidan olingan kalitlar ro'yxati */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  permissions: string[];

  /** Default (tizim) rollar — o'chirib bo'lmaydi; perm tahrirlansa bo'ladi */
  @Column({ type: 'boolean', default: false })
  isSystem: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
