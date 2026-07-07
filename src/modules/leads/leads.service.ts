import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, MoreThan, Repository } from 'typeorm';
import { Lead } from '../../entities/lead.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { LeadStatus } from '../../common/enums';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { MailService } from '../mail/mail.service';

export interface LeadsListQuery extends PaginationDto {
  status?: LeadStatus;
}

/** Bir email'dan shu oynada takror yuborilgan bir xil xabar spam deb hisoblanadi */
const DUPLICATE_WINDOW_MS = 60_000;

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead) private readonly leadRepository: Repository<Lead>,
    private readonly mailService: MailService,
  ) {}

  /** Landing formasidan yangi murojaat (public) */
  async createFromLanding(dto: {
    name: string;
    email: string;
    phone?: string;
    message: string;
  }): Promise<{ ok: boolean }> {
    // Takror yuborishdan himoya: 1 daqiqa ichida bir xil email+xabar → jimgina OK
    const duplicate = await this.leadRepository.findOne({
      where: {
        email: dto.email,
        message: dto.message,
        createdAt: MoreThan(new Date(Date.now() - DUPLICATE_WINDOW_MS)),
      },
    });
    if (duplicate) return { ok: true };

    const lead = await this.leadRepository.save(
      this.leadRepository.create({
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        message: dto.message.trim(),
        status: LeadStatus.NEW,
      }),
    );
    this.logger.log(`Yangi lead: ${lead.email} (${lead.id})`);
    return { ok: true };
  }

  async findAll(query: LeadsListQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: ILike(`%${query.search}%`) } : {}),
    };
    // search bo'yicha ham ism, ham email qidiriladi
    const [items, total] = await this.leadRepository.findAndCount({
      where: query.search
        ? [
            { ...where, name: ILike(`%${query.search}%`) },
            { ...(query.status ? { status: query.status } : {}), email: ILike(`%${query.search}%`) },
          ]
        : where,
      order: { createdAt: query.sortOrder === 'ASC' ? 'ASC' : 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return Paginated.of(items, total, query);
  }

  /** Kanban doskasi uchun barcha murojaatlar (paginatsiyasiz, oxirgi 500 tagacha) */
  async board(): Promise<Lead[]> {
    return this.leadRepository.find({
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  /** Kanban ustun sarlavhalari uchun statuslar bo'yicha sonlar */
  async stats(): Promise<Record<LeadStatus, number>> {
    const rows: Array<{ status: LeadStatus; count: string }> = await this.leadRepository
      .createQueryBuilder('l')
      .select('l.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.status')
      .getRawMany();
    const result = Object.fromEntries(
      Object.values(LeadStatus).map((s) => [s, 0]),
    ) as Record<LeadStatus, number>;
    for (const row of rows) result[row.status] = Number(row.count);
    return result;
  }

  async update(
    id: string,
    userId: string,
    dto: { status?: LeadStatus; note?: string | null },
  ): Promise<Lead> {
    const lead = await this.leadRepository.findOne({ where: { id } });
    if (!lead) throw AppException.notFound('Murojaat topilmadi');

    const statusChanged = dto.status !== undefined && dto.status !== lead.status;
    if (dto.status !== undefined) lead.status = dto.status;
    if (dto.note !== undefined) lead.note = dto.note;
    if (statusChanged) {
      lead.handledByUserId = userId;
      lead.statusChangedAt = new Date();
    }
    const saved = await this.leadRepository.save(lead);

    // Yakuniy bosqichga O'TISH paytida mijozga rasmiy email (takror o'tishda emas)
    if (statusChanged && dto.status === LeadStatus.APPROVED) {
      await this.mailService.sendLeadApproved(lead.email, lead.name);
    } else if (statusChanged && dto.status === LeadStatus.REJECTED) {
      await this.mailService.sendLeadRejected(lead.email, lead.name);
    }
    return saved;
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    const lead = await this.leadRepository.findOne({ where: { id } });
    if (!lead) throw AppException.notFound('Murojaat topilmadi');
    await this.leadRepository.remove(lead);
    return { ok: true };
  }
}
