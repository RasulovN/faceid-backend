import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type {
  SnapshotCompanyEntry,
  SnapshotTableEntry,
} from '../modules/storage-analytics/interfaces/storage-analytics.interfaces';

/** bigint ustunlar string qaytaradi — number ga o'giramiz (Number.MAX_SAFE_INTEGER yetarli) */
const bigintTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v == null ? null : Number(v)),
};

/**
 * Soatlik storage snapshot — Growth Analytics va model o'sish statistikasi manbai.
 * StorageSnapshotProcessor har soatda yozadi, 400 kundan eskilari tozalanadi.
 */
@Entity('storage_snapshots')
export class StorageSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  databaseSizeBytes: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  totalRows: number;

  @Column({ type: 'int' })
  totalTables: number;

  /** Kompaniya kesimida taxminiy hajm: SnapshotCompanyEntry[] */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  companyStorage: SnapshotCompanyEntry[];

  /** Jadval kesimida hajm: SnapshotTableEntry[] */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  tableStorage: SnapshotTableEntry[];

  @Index('IDX_storage_snapshots_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
