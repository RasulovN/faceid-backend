import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { vectorTransformer } from '../common/utils/vector.transformer';
import { Employee } from './employee.entity';

@Entity('face_embeddings')
export class FaceEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_face_embeddings_employeeId')
  @Column({ type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee;

  /** pgvector vector(512) — kodda number[512] */
  @Column({ type: 'text', transformer: vectorTransformer })
  embedding: number[];

  @Column({ type: 'varchar', length: 512, nullable: true })
  sourcePhotoUrl: string | null;

  @Column({ type: 'float', nullable: true })
  quality: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
