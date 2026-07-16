import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Employee } from './employee.entity';
import { Group } from './group.entity';

/** Guruh ↔ o'quvchi bog'lanishi (bitta o'quvchi bir nechta guruhda o'qishi mumkin) */
@Entity('group_students')
export class GroupStudent {
  @PrimaryColumn({ type: 'uuid' })
  groupId: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group?: Group;

  /** employees jadvalidagi personType=STUDENT yozuvi */
  @PrimaryColumn({ type: 'uuid' })
  studentId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student?: Employee;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
