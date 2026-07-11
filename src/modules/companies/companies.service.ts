import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, IsNull, Not, Repository } from 'typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Device } from '../../entities/device.entity';
import { Employee } from '../../entities/employee.entity';
import { Payment } from '../../entities/payment.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Tariff } from '../../entities/tariff.entity';
import { User } from '../../entities/user.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { CompanyStatus, EmployeeStatus, PaymeState, SubscriptionStatus } from '../../common/enums';
import { MailService } from '../mail/mail.service';
import { Paginated } from '../../common/dto/pagination.dto';
import {
  AdminUpdateCompanyDto,
  CompanyListQueryDto,
  UpdateCompanyProfileDto,
  UpdateCompanyStatusDto,
} from './dto/company.dtos';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
    @InjectRepository(Subscription) private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
    @InjectRepository(AttendanceEvent)
    private readonly attendanceEventRepository: Repository<AttendanceEvent>,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  // ---------- Superadmin ----------

  async findAll(query: CompanyListQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search) where.name = ILike(`%${query.search}%`);
    const [items, total] = await this.companyRepository.findAndCount({
      where,
      relations: { tariff: true },
      order: { [query.sortBy ?? 'createdAt']: query.sortOrder },
      skip: query.skip,
      take: query.limit,
    });
    const enriched = await Promise.all(
      items.map(async (company) => ({
        ...company,
        owner: company.ownerId ? await this.publicOwner(company.ownerId) : null,
        employeeCount: await this.employeeRepository.count({
          where: {
            companyId: company.id,
            status: Not(EmployeeStatus.FIRED),
            deletedAt: IsNull(),
          },
        }),
      })),
    );
    return Paginated.of(enriched, total, query);
  }

  async findOneFull(id: string) {
    const company = await this.companyRepository.findOne({
      where: { id },
      relations: { tariff: true },
    });
    if (!company) throw AppException.notFound('Kompaniya topilmadi');
    const [subscriptions, payments, stats, owner] = await Promise.all([
      this.subscriptionRepository.find({
        where: { companyId: id },
        relations: { tariff: true },
        order: { endsAt: 'DESC' },
      }),
      this.paymentRepository.find({ where: { companyId: id }, order: { createdAt: 'DESC' } }),
      this.stats(id),
      company.ownerId ? this.publicOwner(company.ownerId) : Promise.resolve(null),
    ]);
    return {
      ...company,
      owner,
      subscription: subscriptions[0] ?? null,
      subscriptions,
      payments,
      stats,
    };
  }

  private async publicOwner(ownerId: string) {
    const owner = await this.userRepository.findOne({ where: { id: ownerId } });
    if (!owner) return null;
    return {
      id: owner.id,
      username: owner.username,
      email: owner.email,
      phone: owner.phone,
      role: owner.role,
      isActive: owner.isActive,
      lastLoginAt: owner.lastLoginAt,
      createdAt: owner.createdAt,
    };
  }

  async adminUpdate(id: string, dto: AdminUpdateCompanyDto): Promise<Company> {
    const company = await this.getById(id);
    Object.assign(company, dto);
    return this.companyRepository.save(company);
  }

  async updateStatus(id: string, dto: UpdateCompanyStatusDto): Promise<Company> {
    const company = await this.getById(id);
    const wasPending = company.status === CompanyStatus.PENDING;
    company.status = dto.status;

    // Superadmin PENDING kompaniyani tasdiqlaganda — bepul trial obuna beriladi
    if (wasPending && dto.status === CompanyStatus.ACTIVE && !company.tariffId) {
      const trialTariff = await this.tariffRepository.findOne({
        where: { isActive: true },
        order: { sortOrder: 'ASC' },
      });
      if (trialTariff) {
        const trialDays = Number(this.config.get('TRIAL_DAYS') ?? 14);
        const now = new Date();
        const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
        company.tariffId = trialTariff.id;
        company.subscriptionStartsAt = now;
        company.subscriptionEndsAt = trialEndsAt;
        await this.subscriptionRepository.save(
          this.subscriptionRepository.create({
            companyId: company.id,
            tariffId: trialTariff.id,
            startsAt: now,
            endsAt: trialEndsAt,
            status: SubscriptionStatus.ACTIVE,
            isTrial: true,
          }),
        );
      }
    }

    const saved = await this.companyRepository.save(company);

    if (wasPending && dto.status === CompanyStatus.ACTIVE && company.ownerId) {
      const owner = await this.userRepository.findOne({ where: { id: company.ownerId } });
      if (owner?.email) {
        await this.mailService.sendCompanyApproved(
          owner.email,
          company.name,
          company.subscriptionEndsAt,
        );
      }
    }

    return saved;
  }

  /**
   * Kompaniyani BUTUNLAY o'chirish (superadmin).
   * Kompaniya-scoped jadvallar (filial, xodim, qurilma, obuna, to'lov, grafik,
   * rol, qoida va h.k.) FK CASCADE orqali o'chadi. `users.companyId` FK'si
   * SET NULL bo'lgani uchun kompaniya userlari alohida o'chiriladi —
   * aks holda ular "egasiz" holda tizimga kira olardi.
   */
  async remove(id: string): Promise<{ ok: boolean }> {
    const company = await this.getById(id);
    await this.dataSource.transaction(async (manager) => {
      // Userlar ro'yxatini kompaniya o'chishidan OLDIN olamiz (keyin companyId NULL bo'ladi)
      const users = await manager.getRepository(User).find({
        where: { companyId: id },
        select: { id: true },
        withDeleted: true,
      });
      // Avval kompaniya — cascade employees'ni o'chiradi, so'ng userlarni o'chirish mumkin
      await manager.getRepository(Company).delete({ id });
      if (users.length > 0) {
        await manager.getRepository(User).delete(users.map((u) => u.id));
      }
    });
    this.logger.warn(`Kompaniya o'chirildi: ${company.name} (${id})`);
    return { ok: true };
  }

  async stats(id: string) {
    await this.getById(id);

    // Attendance grafigi uchun oxirgi 14 kun (bugungi kun ham kiradi).
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 13);

    const [branchesCount, employeesCount, devicesCount, attendanceRows, paymentRows] =
      await Promise.all([
        this.branchRepository.count({ where: { companyId: id } }),
        this.employeeRepository.count({
          where: { companyId: id, status: Not(EmployeeStatus.FIRED), deletedAt: IsNull() },
        }),
        this.deviceRepository.count({ where: { companyId: id } }),
        // Kunlik davomat hodisalari soni (filial orqali kompaniyaga bog'lanadi).
        this.attendanceEventRepository
          .createQueryBuilder('ae')
          .innerJoin('ae.branch', 'b')
          .select("to_char(ae.\"timestamp\", 'YYYY-MM-DD')", 'date')
          .addSelect('COUNT(*)', 'count')
          .where('b.companyId = :id', { id })
          .andWhere('ae.timestamp >= :since', { since })
          .groupBy('date')
          .orderBy('date', 'ASC')
          .getRawMany<{ date: string; count: string }>(),
        // Oylik muvaffaqiyatli to'lovlar summasi (tiyin).
        this.paymentRepository
          .createQueryBuilder('p')
          .select("to_char(p.\"createdAt\", 'YYYY-MM')", 'month')
          .addSelect('COALESCE(SUM(p.amount), 0)', 'amount')
          .where('p."companyId" = :id AND p.state = :state', { id, state: PaymeState.PERFORMED })
          .groupBy('month')
          .orderBy('month', 'ASC')
          .getRawMany<{ month: string; amount: string }>(),
      ]);

    return {
      branchesCount,
      employeesCount,
      devicesCount,
      attendanceChart: attendanceRows.map((r) => ({ date: r.date, count: Number(r.count) })),
      paymentsChart: paymentRows.map((r) => ({ month: r.month, amount: Number(r.amount) })),
    };
  }

  // ---------- Kompaniya profili ----------

  async getProfile(companyId: string) {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: { tariff: true },
    });
    if (!company) throw AppException.notFound('Kompaniya topilmadi');
    return company;
  }

  async updateProfile(companyId: string, dto: UpdateCompanyProfileDto): Promise<Company> {
    const company = await this.getById(companyId);
    Object.assign(company, dto);
    return this.companyRepository.save(company);
  }

  async getById(id: string): Promise<Company> {
    const company = await this.companyRepository.findOne({ where: { id } });
    if (!company) throw AppException.notFound('Kompaniya topilmadi');
    return company;
  }
}
