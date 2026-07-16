import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  FindOptionsWhere,
  ILike,
  IsNull,
  Repository,
} from 'typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { FaceEmbedding } from '../../entities/face-embedding.entity';
import { User } from '../../entities/user.entity';
import { WorkDay } from '../../entities/work-day.entity';
import { WorkSchedule } from '../../entities/work-schedule.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { EmployeeStatus, PersonType, SalaryType, UserRole } from '../../common/enums';
import { Paginated } from '../../common/dto/pagination.dto';
import { generatePassword } from '../../common/utils/crypto.util';
import { slugify } from '../../common/utils/slug.util';
import { UploadedFile } from '../../common/utils/multipart.util';
import { addDaysToDateStr, zonedTimeToUtc } from '../../common/utils/tz.util';
import { FaceService } from '../face/face.service';
import { MinioService } from '../files/minio.service';
import { MailService } from '../mail/mail.service';
import { TariffLimitsService } from '../tariffs/tariff-limits.service';
import {
  CreateEmployeeDto,
  EmployeeAttendanceQueryDto,
  EmployeeListQueryDto,
  UpdateEmployeeDto,
  UpdateEmployeeStatusDto,
} from './dto/employee.dtos';

export interface PhotoUploadResult {
  embeddingId: string | null;
  photoUrl: string | null;
  quality: number | null;
  ok: boolean;
  errorCode?: string;
  /** FACE_ALREADY_ENROLLED: bu yuz allaqachon biriktirilgan xodim */
  duplicateOf?: { id: string; fullName: string } | null;
  /** Dublikat aniqlanganda o'xshashlik darajasi (0..1) */
  similarity?: number;
}

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(FaceEmbedding)
    private readonly embeddingRepository: Repository<FaceEmbedding>,
    @InjectRepository(WorkDay) private readonly workDayRepository: Repository<WorkDay>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @InjectRepository(WorkSchedule)
    private readonly scheduleRepository: Repository<WorkSchedule>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly faceService: FaceService,
    private readonly minioService: MinioService,
    private readonly mailService: MailService,
    private readonly tariffLimitsService: TariffLimitsService,
  ) {}

  // ---------- Ro'yxat ----------

  async findAll(companyId: string, query: EmployeeListQueryDto) {
    const base: FindOptionsWhere<Employee> = {
      companyId,
      deletedAt: IsNull(),
      // Default EMPLOYEE — mavjud "Xodimlar" sahifasi o'quvchilarsiz ishlayveradi
      personType: query.type ?? PersonType.EMPLOYEE,
    };
    if (query.branchId) base.branchId = query.branchId;
    if (query.status) base.status = query.status;
    if (query.department) base.department = query.department;
    const where: FindOptionsWhere<Employee>[] = query.search
      ? [
          { ...base, firstName: ILike(`%${query.search}%`) },
          { ...base, lastName: ILike(`%${query.search}%`) },
          { ...base, tabNumber: ILike(`%${query.search}%`) },
        ]
      : [base];
    const [items, total] = await this.employeeRepository.findAndCount({
      where,
      relations: { branch: true, user: true, schedule: true },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    const presented = await Promise.all(items.map((e) => this.present(e, false)));
    return Paginated.of(presented, total, query);
  }

  async findOne(companyId: string, id: string) {
    const employee = await this.employeeRepository.findOne({
      where: { id, companyId, deletedAt: IsNull() },
      relations: { branch: true, user: true, schedule: true },
    });
    if (!employee) throw AppException.notFound('Xodim topilmadi');
    return this.present(employee, true);
  }

  // ---------- Yaratish (bitta tranzaksiya) ----------

  async create(companyId: string, dto: CreateEmployeeDto) {
    const personType = dto.personType ?? PersonType.EMPLOYEE;
    // O'quvchilar tarif "xodim" limitiga kirmaydi (MVP: cheklanmagan)
    if (personType === PersonType.EMPLOYEE) {
      await this.tariffLimitsService.assertCanCreate(companyId, 'employee');
    }

    const branch = await this.branchRepository.findOne({
      where: { id: dto.branchId, companyId },
    });
    if (!branch) throw AppException.notFound('Filial topilmadi');

    const tabNumber =
      dto.tabNumber?.trim() ||
      (await this.generateTabNumber(companyId, personType === PersonType.STUDENT ? 'S' : 'T'));
    if (
      dto.tabNumber &&
      (await this.employeeRepository.exists({
        where: { companyId, tabNumber, deletedAt: IsNull() },
      }))
    ) {
      throw AppException.conflict(`Tab raqami "${tabNumber}" allaqachon band`);
    }

    if (dto.scheduleId) await this.assertScheduleExists(companyId, dto.scheduleId);

    const baseFields = {
      companyId,
      branchId: dto.branchId,
      personType,
      parentPhones: [...new Set((dto.parentPhones ?? []).map((p) => p.trim()).filter(Boolean))],
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName ?? null,
      birthDate: dto.birthDate ?? null,
      gender: dto.gender ?? null,
      position: dto.position ?? null,
      department: dto.department ?? null,
      tabNumber,
      hiredAt: dto.hiredAt ?? null,
      salaryType: dto.salaryType ?? SalaryType.FIXED,
      salaryAmount: dto.salaryAmount ?? 0,
      scheduleId: dto.scheduleId ?? null,
      passportSeries: dto.passportSeries ?? null,
      notes: dto.notes ?? null,
    };

    // STUDENT: login yaratilmaydi — User yozuvisiz, userId=null
    if (personType === PersonType.STUDENT) {
      const created = await this.employeeRepository.save(
        this.employeeRepository.create({ ...baseFields, userId: null }),
      );
      return this.findOne(companyId, created.id);
    }

    if (!dto.credentials) {
      throw AppException.validation('Xodim uchun login ma’lumotlari (credentials) majburiy');
    }
    const email = dto.credentials.email?.trim().toLowerCase() || null;
    const phone = dto.credentials.phone?.trim() || null;
    if (!email && !phone) {
      throw AppException.validation('Email yoki telefon raqamidan kamida bittasini kiriting');
    }
    if (!dto.credentials.password && !email) {
      throw AppException.validation(
        'Parolni avtogeneratsiya qilib yuborish uchun email kiritilishi shart',
      );
    }
    const username =
      dto.credentials.username?.trim().toLowerCase() ||
      (await this.generateUsername(dto.firstName, dto.lastName));
    await this.assertCredentialsUnique(username, email, phone);

    const generatedPassword = dto.credentials.password ? null : generatePassword(12);
    const password = dto.credentials.password ?? generatedPassword!;
    const passwordHash = await argon2.hash(password);

    const employee = await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).save(
        manager.getRepository(User).create({
          username,
          email,
          phone,
          passwordHash,
          role: UserRole.EMPLOYEE,
          companyId,
        }),
      );

      const created = await manager.getRepository(Employee).save(
        manager.getRepository(Employee).create({ ...baseFields, userId: user.id }),
      );

      return created;
    });

    if (generatedPassword && email) {
      const company = await this.companyRepository.findOne({ where: { id: companyId } });
      await this.mailService.sendEmployeeCredentials(
        email,
        `${dto.firstName} ${dto.lastName}`,
        company?.name ?? 'FaceID',
        username,
        generatedPassword,
      );
    }

    return this.findOne(companyId, employee.id);
  }

  // ---------- Yangilash / o'chirish ----------

  async update(companyId: string, id: string, dto: UpdateEmployeeDto) {
    const employee = await this.getEntity(companyId, id);
    if (dto.branchId && dto.branchId !== employee.branchId) {
      const branch = await this.branchRepository.exists({
        where: { id: dto.branchId, companyId },
      });
      if (!branch) throw AppException.notFound('Filial topilmadi');
    }
    if (dto.tabNumber && dto.tabNumber !== employee.tabNumber) {
      const exists = await this.employeeRepository.exists({
        where: { companyId, tabNumber: dto.tabNumber, deletedAt: IsNull() },
      });
      if (exists) throw AppException.conflict(`Tab raqami "${dto.tabNumber}" allaqachon band`);
    }
    const { scheduleId, ...fields } = dto;
    Object.assign(employee, fields);
    if (scheduleId !== undefined) {
      // null → grafik uzib qo'yiladi; uuid → shablonga to'g'ridan-to'g'ri havola
      if (scheduleId) await this.assertScheduleExists(companyId, scheduleId);
      employee.scheduleId = scheduleId ?? null;
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Employee).save(employee);
      if (scheduleId !== undefined) {
        // Eski mexanizmdan qolgan individual klon-grafiklarni tozalaymiz
        await manager
          .getRepository(WorkSchedule)
          .delete({ companyId, employeeId: employee.id });
      }
    });
    return this.findOne(companyId, id);
  }

  async updateStatus(companyId: string, id: string, dto: UpdateEmployeeStatusDto) {
    const employee = await this.getEntity(companyId, id);
    employee.status = dto.status;
    if (dto.status === EmployeeStatus.FIRED) {
      employee.firedAt = dto.firedAt ?? new Date().toISOString().slice(0, 10);
      if (employee.userId) {
        await this.userRepository.update(
          { id: employee.userId },
          { isActive: false, refreshTokenHash: null },
        );
      }
    } else {
      employee.firedAt = null;
      if (employee.userId) {
        await this.userRepository.update({ id: employee.userId }, { isActive: true });
      }
    }
    await this.employeeRepository.save(employee);
    return this.findOne(companyId, id);
  }

  /** Soft delete: Employee soft-o'chadi, bog'liq User deaktiv bo'ladi */
  async remove(companyId: string, id: string): Promise<{ ok: boolean }> {
    const employee = await this.getEntity(companyId, id);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Employee).softDelete({ id: employee.id });
      if (employee.userId) {
        await manager
          .getRepository(User)
          .update({ id: employee.userId }, { isActive: false, refreshTokenHash: null });
      }
    });
    return { ok: true };
  }

  // ---------- Rasmlar / embeddinglar ----------

  async addPhotos(
    companyId: string,
    id: string,
    files: UploadedFile[],
  ): Promise<PhotoUploadResult[]> {
    if (files.length === 0) {
      throw AppException.validation('Kamida 1 ta rasm yuboring (maksimal 5 ta)');
    }
    const employee = await this.getEntity(companyId, id);
    const results: PhotoUploadResult[] = [];

    for (const file of files) {
      const extraction = await this.faceService.extract(file.buffer);
      if (!extraction.ok || !extraction.embedding) {
        results.push({
          embeddingId: null,
          photoUrl: null,
          quality: extraction.quality ?? null,
          ok: false,
          errorCode: extraction.errorCode ?? 'FACE_NOT_FOUND',
        });
        continue;
      }

      // DUBLIKAT TEKSHIRUVI: bu yuz kompaniyada BOSHQA xodimga allaqachon
      // biriktirilgan bo'lsa — rasm SAQLANMAYDI (bitta odam ikki xil nom
      // bilan ro'yxatdan o'tib ketishining oldi olinadi).
      const duplicate = await this.findDuplicateFace(companyId, employee.id, extraction.embedding);
      if (duplicate) {
        results.push({
          embeddingId: null,
          photoUrl: null,
          quality: extraction.quality ?? null,
          ok: false,
          errorCode: 'FACE_ALREADY_ENROLLED',
          duplicateOf: { id: duplicate.employeeId, fullName: duplicate.fullName },
          similarity: duplicate.similarity,
        });
        continue;
      }

      // MinIO kaliti embeddingId bilan nomlanadi — panel DELETE uchun URL'dan ID oladi
      const embeddingId = randomUUID();
      const extension = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const key = `${companyId}/${employee.id}/${embeddingId}.${extension}`;
      const photoUrl = await this.minioService.uploadWithKey(
        this.minioService.employeesBucket,
        key,
        file.buffer,
        file.mimetype,
      );
      await this.embeddingRepository.insert({
        id: embeddingId,
        employeeId: employee.id,
        embedding: extraction.embedding,
        sourcePhotoUrl: photoUrl,
        quality: extraction.quality ?? null,
      });
      employee.photoUrls = [...(employee.photoUrls ?? []), photoUrl];
      results.push({
        embeddingId,
        photoUrl,
        quality: extraction.quality ?? null,
        ok: true,
      });
    }

    await this.employeeRepository.save(employee);
    return results;
  }

  /**
   * Yangi embedding kompaniya ichida BOSHQA xodimning yuziga mos kelsa —
   * dublikat (pgvector cosine, kiosk identify bilan bir xil o'lchov).
   * FIRED va o'chirilgan xodimlar hisobga olinmaydi (qayta ishga olish holati),
   * shuning uchun ular bilan to'qnashuv yangi yozuvni bloklamaydi.
   */
  private async findDuplicateFace(
    companyId: string,
    employeeId: string,
    embedding: number[],
  ): Promise<{ employeeId: string; fullName: string; similarity: number } | null> {
    const threshold = Number(this.config.get('FACE_DUPLICATE_THRESHOLD') ?? 0.5);
    const rows = await this.embeddingRepository.query(
      `SELECT fe."employeeId"       AS "employeeId",
              e."firstName"          AS "firstName",
              e."lastName"           AS "lastName",
              1 - (fe.embedding <=> $1::vector) AS similarity
       FROM face_embeddings fe
       JOIN employees e ON e.id = fe."employeeId"
       WHERE e."companyId" = $2
         AND e."deletedAt" IS NULL
         AND e.status != 'FIRED'
         AND fe."employeeId" != $3
       ORDER BY fe.embedding <=> $1::vector
       LIMIT 1`,
      [`[${embedding.join(',')}]`, companyId, employeeId],
    );
    const row = rows[0] as
      | { employeeId: string; firstName: string; lastName: string; similarity: string | number }
      | undefined;
    if (!row || Number(row.similarity) < threshold) return null;
    return {
      employeeId: row.employeeId,
      fullName: [row.lastName, row.firstName].filter(Boolean).join(' '),
      similarity: Number(row.similarity),
    };
  }

  async removePhoto(companyId: string, id: string, embeddingId: string): Promise<{ ok: boolean }> {
    const employee = await this.getEntity(companyId, id);
    const embedding = await this.embeddingRepository.findOne({
      where: { id: embeddingId, employeeId: employee.id },
    });
    if (!embedding) throw AppException.notFound('Embedding topilmadi');
    await this.embeddingRepository.remove(embedding);
    if (embedding.sourcePhotoUrl) {
      employee.photoUrls = (employee.photoUrls ?? []).filter(
        (url) => url !== embedding.sourcePhotoUrl,
      );
      await this.employeeRepository.save(employee);
    }
    return { ok: true };
  }

  // ---------- Davomat (har kun uchun WorkDay + eventlar) ----------

  async attendance(companyId: string, id: string, query: EmployeeAttendanceQueryDto) {
    const employee = await this.getEntity(companyId, id);
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from = query.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw AppException.validation('`from` `to`dan katta bo‘lishi mumkin emas');

    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    const timezone = company?.timezone || 'Asia/Tashkent';
    const rangeStart = zonedTimeToUtc(from, '00:00', timezone);
    const rangeEnd = zonedTimeToUtc(addDaysToDateStr(to, 1), '00:00', timezone);

    const [workDays, events] = await Promise.all([
      this.workDayRepository.find({
        where: { employeeId: employee.id, date: Between(from, to) },
      }),
      this.eventRepository.find({
        where: { employeeId: employee.id, timestamp: Between(rangeStart, rangeEnd) },
        order: { timestamp: 'ASC' },
      }),
    ]);
    const workDayMap = new Map(workDays.map((w) => [w.date, w]));

    // Eventlarni kompaniya timezone'idagi sanasi bo'yicha guruhlash
    const eventsByDate = new Map<string, AttendanceEvent[]>();
    for (const event of events) {
      const shifted = new Date(event.timestamp.getTime());
      const dateStr = this.dateInTz(shifted, timezone);
      const list = eventsByDate.get(dateStr) ?? [];
      list.push(event);
      eventsByDate.set(dateStr, list);
    }

    const days: Array<{ date: string; workDay: WorkDay | null; events: AttendanceEvent[] }> = [];
    for (let date = from; date <= to; date = addDaysToDateStr(date, 1)) {
      days.push({
        date,
        workDay: workDayMap.get(date) ?? null,
        events: eventsByDate.get(date) ?? [],
      });
    }
    return days;
  }

  /** EMPLOYEE roli faqat o'z yozuviga kirishi mumkinligini tekshiradi */
  async assertOwnEmployee(companyId: string, employeeId: string, userId: string): Promise<void> {
    const employee = await this.employeeRepository.findOne({
      where: { id: employeeId, companyId, deletedAt: IsNull() },
    });
    if (!employee || employee.userId !== userId) {
      throw AppException.forbidden('Faqat o‘z davomatingizni ko‘rishingiz mumkin');
    }
  }

  // ---------- Yordamchilar ----------

  async getEntity(companyId: string, id: string): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({
      where: { id, companyId, deletedAt: IsNull() },
    });
    if (!employee) throw AppException.notFound('Xodim topilmadi');
    return employee;
  }

  private async assertScheduleExists(companyId: string, scheduleId: string): Promise<void> {
    const exists = await this.scheduleRepository.exists({
      where: { id: scheduleId, companyId },
    });
    if (!exists) throw AppException.notFound('Ko‘rsatilgan ish grafigi topilmadi');
  }

  private async present(employee: Employee, detail: boolean) {
    const embeddings = await this.embeddingRepository.find({
      where: { employeeId: employee.id },
      order: { createdAt: 'ASC' },
    });
    const user = employee.user
      ? {
          id: employee.user.id,
          username: employee.user.username,
          email: employee.user.email,
          phone: employee.user.phone,
          isActive: employee.user.isActive,
        }
      : undefined;
    const { passportSeries: _pp, ...rest } = employee;
    return {
      ...rest,
      user,
      fullName: employee.fullName,
      embeddingsCount: embeddings.length,
      ...(detail
        ? {
            embeddings: embeddings.map((e) => ({
              id: e.id,
              sourcePhotoUrl: e.sourcePhotoUrl,
              quality: e.quality,
            })),
          }
        : {}),
    };
  }

  private dateInTz(date: Date, timeZone: string): string {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return dtf.format(date);
  }

  private async assertCredentialsUnique(
    username: string,
    email: string | null,
    phone: string | null,
  ): Promise<void> {
    const conflicts: string[] = [];
    if (await this.userRepository.exists({ where: { username: username.toLowerCase() } })) {
      conflicts.push('username');
    }
    if (email && (await this.userRepository.exists({ where: { email } }))) {
      conflicts.push('email');
    }
    if (phone && (await this.userRepository.exists({ where: { phone } }))) {
      conflicts.push('phone');
    }
    if (conflicts.length > 0) {
      throw AppException.conflict(`Credentials band: ${conflicts.join(', ')}`, {
        fields: conflicts,
      });
    }
  }

  /** Ism-familiyadan unikal username yasaydi (kirill → lotin, band bo'lsa raqamli suffiks) */
  private async generateUsername(firstName: string, lastName: string): Promise<string> {
    const base =
      slugify(`${firstName} ${lastName}`).replace(/-/g, '.').slice(0, 48) || 'xodim';
    const padded = base.length >= 3 ? base : `${base}user`.slice(0, 8);
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = attempt === 0 ? padded : `${padded}${attempt + 1}`;
      if (!(await this.userRepository.exists({ where: { username: candidate } }))) {
        return candidate;
      }
    }
    return `${padded}.${Date.now().toString(36)}`;
  }

  /** Kompaniyadagi eng katta raqamdan keyingi bo'sh tab raqamini topadi (T-001 / S-001) */
  private async generateTabNumber(companyId: string, prefix: 'T' | 'S' = 'T'): Promise<string> {
    // Soft-o'chirilgan xodimlar raqami ham qayta ishlatilmasin
    const existing = await this.employeeRepository.find({
      where: { companyId },
      select: { tabNumber: true },
      withDeleted: true,
    });
    let max = 0;
    for (const e of existing) {
      if (!e.tabNumber?.startsWith(`${prefix}-`)) continue;
      const match = /(\d+)\s*$/.exec(e.tabNumber);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    let next = max + 1;
    for (;;) {
      const candidate = `${prefix}-${String(next).padStart(3, '0')}`;
      const taken = await this.employeeRepository.exists({
        where: { companyId, tabNumber: candidate },
        withDeleted: true,
      });
      if (!taken) return candidate;
      next += 1;
    }
  }
}
