import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { MobileErrorLog } from '../../entities/mobile-error-log.entity';
import {
  CreateMobileLogDto,
  MobileLogListQueryDto,
} from './dto/mobile-logs.dtos';

/** Bitta IP'dan daqiqasiga qabul qilinadigan maksimal yozuvlar (spam himoya) */
const MAX_LOGS_PER_IP_PER_MINUTE = 30;

export interface MobileLogStats {
  totalNew: number;
  today: number;
  fatalToday: number;
  week: number;
  byPlatform: { platform: string; count: number }[];
}

@Injectable()
export class MobileLogsService {
  private readonly logger = new Logger(MobileLogsService.name);
  /** IP → shu daqiqadagi yozuvlar soni (oddiy in-memory hisoblagich) */
  private readonly ipCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @InjectRepository(MobileErrorLog)
    private readonly logRepository: Repository<MobileErrorLog>,
  ) {}

  /** Public ingest — xatoni saqlaydi; spam bo'lsa jimgina tashlab yuboradi */
  async record(dto: CreateMobileLogDto, ip: string): Promise<{ ok: boolean }> {
    if (!this.allowIp(ip)) return { ok: true }; // spamerga ham 200 — retry bo'ronini qo'zg'atmaslik uchun

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : null;
    await this.logRepository.save(
      this.logRepository.create({
        message: dto.message,
        stack: dto.stack ?? null,
        isFatal: dto.isFatal ?? true,
        platform: dto.platform,
        osVersion: dto.osVersion ?? null,
        deviceModel: dto.deviceModel ?? null,
        appVersion: dto.appVersion ?? null,
        route: dto.route ?? null,
        username: dto.username ?? null,
        userId: dto.userId ?? null,
        extra: dto.extra ?? null,
        ip,
        occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
      }),
    );
    this.logger.warn(
      `Mobil xato qabul qilindi [${dto.platform}${dto.isFatal === false ? '' : ', FATAL'}]: ${dto.message.slice(0, 120)}`,
    );
    return { ok: true };
  }

  private allowIp(ip: string): boolean {
    const now = Date.now();
    const entry = this.ipCounters.get(ip);
    if (!entry || entry.resetAt < now) {
      this.ipCounters.set(ip, { count: 1, resetAt: now + 60_000 });
      // Xarita cheksiz o'smasin
      if (this.ipCounters.size > 10_000) this.ipCounters.clear();
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_LOGS_PER_IP_PER_MINUTE;
  }

  async list(query: MobileLogListQueryDto): Promise<Paginated<MobileErrorLog>> {
    const qb = this.logRepository.createQueryBuilder('l');

    if (query.platform) qb.andWhere('l.platform = :platform', { platform: query.platform });
    if (query.status) qb.andWhere('l.status = :status', { status: query.status });
    if (query.isFatal !== undefined) qb.andWhere('l.isFatal = :fatal', { fatal: query.isFatal });
    if (query.dateFrom) qb.andWhere('l.createdAt >= :from', { from: query.dateFrom });
    if (query.dateTo) qb.andWhere('l.createdAt <= :to', { to: query.dateTo });
    if (query.search) {
      qb.andWhere(
        '(l.message ILIKE :term OR l.deviceModel ILIKE :term OR l.username ILIKE :term OR l.route ILIKE :term)',
        { term: `%${query.search}%` },
      );
    }

    const sortBy = ['createdAt', 'platform', 'deviceModel'].includes(query.sortBy ?? '')
      ? query.sortBy!
      : 'createdAt';
    qb.orderBy(`l.${sortBy}`, query.sortOrder).skip(query.skip).take(query.limit);

    const [items, total] = await qb.getManyAndCount();
    return Paginated.of(items, total, query);
  }

  async stats(): Promise<MobileLogStats> {
    const [totalNew, today, fatalToday, week, byPlatform] = await Promise.all([
      this.logRepository.count({ where: { status: 'NEW' } }),
      this.logRepository
        .createQueryBuilder('l')
        .where(`l."createdAt" >= date_trunc('day', now())`)
        .getCount(),
      this.logRepository
        .createQueryBuilder('l')
        .where(`l."createdAt" >= date_trunc('day', now()) AND l."isFatal" = true`)
        .getCount(),
      this.logRepository
        .createQueryBuilder('l')
        .where(`l."createdAt" >= now() - interval '7 days'`)
        .getCount(),
      this.logRepository
        .createQueryBuilder('l')
        .select('l.platform', 'platform')
        .addSelect('COUNT(*)::int', 'count')
        .where(`l."createdAt" >= now() - interval '7 days'`)
        .groupBy('l.platform')
        .getRawMany<{ platform: string; count: number }>(),
    ]);

    return { totalNew, today, fatalToday, week, byPlatform };
  }

  async setStatus(id: string, status: string): Promise<MobileErrorLog> {
    const log = await this.logRepository.findOne({ where: { id } });
    if (!log) throw AppException.notFound('Log topilmadi');
    log.status = status;
    return this.logRepository.save(log);
  }

  async remove(id: string): Promise<void> {
    const result = await this.logRepository.delete({ id });
    if (!result.affected) throw AppException.notFound('Log topilmadi');
  }

  /** Ko'rib chiqilgan (RESOLVED) loglarni bulk o'chirish */
  async clearResolved(): Promise<{ deleted: number }> {
    const result = await this.logRepository.delete({ status: 'RESOLVED' });
    return { deleted: result.affected ?? 0 };
  }
}
