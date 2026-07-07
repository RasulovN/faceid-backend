import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { Paginated } from '../../common/dto/pagination.dto';
import { AuditQueryDto } from './dto/audit-query.dto';

export interface AuditEntry {
  userId?: string | null;
  companyId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /** Yozish — asosiy oqimni bloklamaydi */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.auditRepository.save(
        this.auditRepository.create({
        userId: entry.userId ?? null,
        companyId: entry.companyId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`Audit yozishda xato: ${(err as Error).message}`);
    }
  }

  async findAll(query: AuditQueryDto, companyId?: string): Promise<Paginated<AuditLog>> {
    const where: FindOptionsWhere<AuditLog> = {};
    if (companyId) where.companyId = companyId;
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.from && query.to) {
      where.createdAt = Between(new Date(query.from), new Date(`${query.to}T23:59:59.999Z`));
    }
    const [items, total] = await this.auditRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return Paginated.of(items, total, query);
  }
}
