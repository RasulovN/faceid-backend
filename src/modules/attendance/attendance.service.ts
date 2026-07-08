import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import Redis from 'ioredis';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Device } from '../../entities/device.entity';
import { Employee } from '../../entities/employee.entity';
import { FaceEmbedding } from '../../entities/face-embedding.entity';
import { WorkDay } from '../../entities/work-day.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/constants/error-codes';
import {
  AttendanceEventType,
  AttendanceSource,
  CompanyStatus,
  DeviceDirection,
  EmployeeStatus,
  WorkDayStatus,
} from '../../common/enums';
import { RequestUser } from '../../common/decorators';
import { Paginated } from '../../common/dto/pagination.dto';
import { haversineDistance } from '../../common/utils/geo.util';
import { addDaysToDateStr, dateStrInTz, zonedTimeToUtc } from '../../common/utils/tz.util';
import { AuditService } from '../audit/audit.service';
import { FaceService } from '../face/face.service';
import { MinioService } from '../files/minio.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { WorkDayService } from '../workdays/workday.service';
import { WsService } from '../ws/ws.service';
import {
  DailyQueryDto,
  EventsQueryDto,
  ExcuseDayDto,
  ManualEventDto,
  MonthlyQueryDto,
  StatsQueryDto,
  UpdateEventDto,
} from './dto/attendance.dtos';

interface DebounceValue {
  eventId: string;
  type: AttendanceEventType;
  timestamp: string;
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(WorkDay) private readonly workDayRepository: Repository<WorkDay>,
    @InjectRepository(FaceEmbedding)
    private readonly embeddingRepository: Repository<FaceEmbedding>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly faceService: FaceService,
    private readonly minioService: MinioService,
    private readonly workDayService: WorkDayService,
    private readonly wsService: WsService,
    private readonly auditService: AuditService,
  ) {}

  // ================= KIOSK =================

  async kioskRecognize(device: Device, frame: Buffer) {
    // Yuz-aniqlash FAQAT shu qurilmaning kompaniyasi VA filiali doirasida.
    // Boshqa filial yoki boshqa kompaniya xodimi nomzod ham bo'lmaydi → "yuz aniqlanmadi".
    const identify = await this.faceService.identify(frame, device.companyId, device.branchId);
    if (!identify.matched || !identify.employeeId) {
      return { recognized: false as const, reason: identify.reason ?? 'FACE_NOT_RECOGNIZED' };
    }
    const livenessThreshold = Number(this.config.get('LIVENESS_THRESHOLD') ?? 0.7);
    if (identify.livenessScore !== undefined && identify.livenessScore < livenessThreshold) {
      return { recognized: false as const, reason: 'LIVENESS_FAILED' };
    }

    // Qo'shimcha himoya: identifikatsiya qilingan xodim aynan shu kompaniya + filialga tegishli bo'lsin.
    const employee = await this.employeeRepository.findOne({
      where: {
        id: identify.employeeId,
        companyId: device.companyId,
        branchId: device.branchId,
        deletedAt: IsNull(),
      },
    });
    if (!employee || employee.status === EmployeeStatus.FIRED) {
      return { recognized: false as const, reason: 'FACE_NOT_RECOGNIZED' };
    }

    // Debounce: qisqa vaqt ichida takror urinish
    const debounced = await this.getDebounce(employee.id);
    if (debounced) {
      return {
        recognized: true as const,
        duplicate: true as const,
        employee: this.employeeSummary(employee),
        event: { id: debounced.eventId, type: debounced.type, timestamp: debounced.timestamp },
      };
    }

    const timezone = await this.companyTimezone(device.companyId);
    const type = await this.resolveEventType(device.direction, employee.id, timezone);
    const snapshotUrl = await this.uploadSnapshot(device.companyId, frame);

    const event = await this.saveEventAndRecalc({
      employee,
      branchId: device.branchId,
      deviceId: device.id,
      type,
      source: AttendanceSource.KIOSK,
      timestamp: new Date(),
      confidence: this.finiteOrNull(identify.confidence),
      livenessScore: this.finiteOrNull(identify.livenessScore),
      snapshotUrl,
      timezone,
    });

    return {
      recognized: true as const,
      employee: this.employeeSummary(employee),
      event: { id: event.id, type: event.type, timestamp: event.timestamp },
      confidence: identify.confidence ?? null,
      livenessScore: identify.livenessScore ?? null,
    };
  }

  // ================= MOBILE =================

  async mobileCheck(
    user: RequestUser,
    frames: Buffer[],
    fields: {
      latitude: number;
      longitude: number;
      accuracy: number;
      isMockLocation: boolean;
      type: AttendanceEventType;
    },
  ) {
    const { employee, embeddings } = await this.prepareMobileSession(user.id, fields);
    const verify = await this.verifyFrames({ id: user.id }, employee, frames, embeddings);
    return this.finalizeMobileEvent(employee, frames[0], fields, verify);
  }

  /**
   * Mobil davomat sessiyasining KIRISH tekshiruvlari (HTTP ham, WS ham):
   * xodim profili → subscription → filial koordinatalari → geofence →
   * mock location (audit bilan) → enrolled embeddinglar mavjudligi.
   */
  async prepareMobileSession(
    userId: string,
    fields: { latitude: number; longitude: number; isMockLocation: boolean },
  ): Promise<{ employee: Employee; embeddings: FaceEmbedding[] }> {
    const employee = await this.employeeRepository.findOne({
      where: { userId, deletedAt: IsNull() },
      relations: { branch: true },
    });
    if (!employee) throw AppException.notFound('Xodim profili topilmadi');
    if (employee.status === EmployeeStatus.FIRED) {
      throw AppException.forbidden('Hisobingiz faol emas');
    }

    // Obuna: WS oqimida HTTP SubscriptionGuard ishlamaydi — shu yerda tekshiramiz.
    const company = await this.companyRepository.findOne({ where: { id: employee.companyId } });
    if (
      company &&
      (company.status === CompanyStatus.SUSPENDED || company.status === CompanyStatus.EXPIRED)
    ) {
      throw new AppException(
        ErrorCodes.SUBSCRIPTION_EXPIRED,
        'Obunangiz muddati tugagan yoki to‘xtatilgan. To‘lovni amalga oshiring.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const branch = employee.branch;
    if (!branch || branch.latitude == null || branch.longitude == null) {
      throw AppException.validation('Filial koordinatalari sozlanmagan — administratorga murojaat qiling');
    }

    // 1) Geofence
    const distance = haversineDistance(
      branch.latitude,
      branch.longitude,
      fields.latitude,
      fields.longitude,
    );
    if (distance > branch.geofenceRadius) {
      throw new AppException(
        ErrorCodes.OUT_OF_GEOFENCE,
        `Siz filialdan ${Math.round(distance)} m uzoqdasiz (ruxsat: ${branch.geofenceRadius} m)`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        { distance: Math.round(distance) },
      );
    }

    // 2) Mock location
    if (fields.isMockLocation) {
      await this.auditService.log({
        userId,
        companyId: employee.companyId,
        action: 'attendance.mockLocationAttempt',
        entityType: 'attendance',
        entityId: employee.id,
        newValue: {
          latitude: fields.latitude,
          longitude: fields.longitude,
          suspicious: true,
        },
      });
      throw new AppException(
        ErrorCodes.MOCK_LOCATION,
        'Soxta joylashuv (mock location) aniqlandi. Bu urinish qayd etildi.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // 3) Enrolled embeddinglar
    const embeddings = await this.embeddingRepository.find({
      where: { employeeId: employee.id },
    });
    if (embeddings.length === 0) {
      throw new AppException(
        ErrorCodes.FACE_NOT_FOUND,
        'Sizda yuz namunalari yo‘q. HR bo‘limiga murojaat qiling.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { employee, embeddings };
  }

  /** Debounce holatini tashqi (WS) oqim uchun ochiq tekshirish. */
  async isDebounced(employeeId: string): Promise<boolean> {
    return (await this.getDebounce(employeeId)) !== null;
  }

  /**
   * WS oqimi uchun: darvozadan o'tgan kadrlarni tekshirib eventni yakunlaydi.
   * Muvaffaqiyatsizlik AppException (aniq kod) bilan otiladi.
   */
  async verifyAndFinalize(
    actorUserId: string,
    employee: Employee,
    frames: Buffer[],
    embeddings: FaceEmbedding[],
    fields: { latitude: number; longitude: number; type: AttendanceEventType },
    rotation = 0,
  ) {
    const verify = await this.verifyFrames(
      { id: actorUserId },
      employee,
      frames,
      embeddings,
      rotation,
    );
    return this.finalizeMobileEvent(employee, frames[0], fields, verify);
  }

  /** Verifikatsiyadan O'TGAN mobil urinishni eventga aylantiradi (debounce bilan). */
  private async finalizeMobileEvent(
    employee: Employee,
    snapshot: Buffer,
    fields: { latitude: number; longitude: number; type: AttendanceEventType },
    verify: { confidence: number; livenessScore: number },
  ) {
    if (await this.getDebounce(employee.id)) {
      throw new AppException(
        ErrorCodes.DEBOUNCE,
        'Yaqinda davomat qayd etilgan. Biroz kuting.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const timezone = await this.companyTimezone(employee.companyId);
    const snapshotUrl = await this.uploadSnapshot(employee.companyId, snapshot);
    const event = await this.saveEventAndRecalc({
      employee,
      branchId: employee.branchId,
      deviceId: null,
      type: fields.type,
      source: AttendanceSource.MOBILE,
      timestamp: new Date(),
      confidence: this.finiteOrNull(verify.confidence),
      livenessScore: this.finiteOrNull(verify.livenessScore),
      snapshotUrl,
      latitude: fields.latitude,
      longitude: fields.longitude,
      timezone,
    });

    return { ok: true, event };
  }

  /**
   * Kadr(lar)ni face-service orqali tekshiradi; muvaffaqiyatsizlik aniq xato
   * kodiga aylanadi. Spoof urinishi (LIVENESS_FAILED) xavfsizlik hodisasi
   * sifatida audit-log qilinadi.
   *
   * - `FACE_NOT_DETECTED` — kadrda yuz ko'rinmadi (transient, klient qayta uradi)
   * - `CHALLENGE_FAILED` — bosh burilishi/blink kuzatilmadi (transient)
   * - `LIVENESS_FAILED` — rasm/ekran gumoni (audit-log bilan)
   * - `FACE_NOT_RECOGNIZED` — jonli yuz, lekin xodimga mos emas
   */
  private async verifyFrames(
    user: { id: string },
    employee: Employee,
    frames: Buffer[],
    embeddings: FaceEmbedding[],
    rotation = 0,
  ): Promise<{ confidence: number; livenessScore: number }> {
    const enrolled = embeddings.map((e) => e.embedding);

    if (frames.length >= 2) {
      const challenge =
        this.config.get<string>('FACE_CHALLENGE') === 'none' ? ('none' as const) : ('turn' as const);
      const res = await this.faceService.verifyLive(frames, enrolled, challenge, rotation);
      if (res.match) {
        return { confidence: res.confidence, livenessScore: res.livenessScore };
      }
      switch (res.errorCode) {
        case 'FACE_NOT_FOUND':
          throw new AppException(
            ErrorCodes.FACE_NOT_DETECTED,
            'Kadrda yuz aniqlanmadi. Yuzingizni oval ichiga joylashtiring.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        case 'CHALLENGE_FAILED':
          throw new AppException(
            ErrorCodes.CHALLENGE_FAILED,
            'Boshingizni sekin chapga va o‘ngga burib qayta urinib ko‘ring.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        case 'LIVENESS_FAILED':
          await this.logSpoofAttempt(user, employee, {
            livenessScore: res.livenessScore,
            consistency: res.consistency,
            reasons: res.reasons,
            framesValid: res.framesValid,
          });
          throw new AppException(
            ErrorCodes.LIVENESS_FAILED,
            'Jonlilik tekshiruvi muvaffaqiyatsiz. Iltimos, kameraga jonli qarang — rasm yoki ekran qabul qilinmaydi.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        default:
          throw new AppException(
            ErrorCodes.FACE_NOT_RECOGNIZED,
            'Yuz tasdiqlanmadi. Yorug‘roq joyda qayta urinib ko‘ring.',
            HttpStatus.NOT_FOUND,
          );
      }
    }

    // Orqaga moslik: eski klient bitta selfie yuboradi — faqat passiv liveness.
    const verify = await this.faceService.verify(frames[0], enrolled);
    if (verify.match) {
      return { confidence: verify.confidence, livenessScore: verify.livenessScore };
    }
    if (verify.errorCode === 'FACE_NOT_FOUND') {
      throw new AppException(
        ErrorCodes.FACE_NOT_DETECTED,
        'Kadrda yuz aniqlanmadi. Yuzingizni oval ichiga joylashtiring.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (verify.errorCode === 'LIVENESS_FAILED') {
      await this.logSpoofAttempt(user, employee, { livenessScore: verify.livenessScore });
      throw new AppException(
        ErrorCodes.LIVENESS_FAILED,
        'Jonlilik tekshiruvi muvaffaqiyatsiz. Iltimos, kameraga jonli qarang — rasm yoki ekran qabul qilinmaydi.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    throw new AppException(
      ErrorCodes.FACE_NOT_RECOGNIZED,
      'Yuz tasdiqlanmadi. Yorug‘roq joyda qayta urinib ko‘ring.',
      HttpStatus.NOT_FOUND,
    );
  }

  /** Spoof (rasm/ekran) urinishini xavfsizlik hodisasi sifatida qayd etadi. */
  private async logSpoofAttempt(
    user: { id: string },
    employee: Employee,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.log({
      userId: user.id,
      companyId: employee.companyId,
      action: 'attendance.spoofAttempt',
      entityType: 'attendance',
      entityId: employee.id,
      newValue: { ...details, suspicious: true },
    });
  }

  // ================= PANEL =================

  async findEvents(companyId: string, query: EventsQueryDto) {
    const where: FindOptionsWhere<AttendanceEvent> = {
      employee: { companyId },
    };
    if (query.branchId) where.branchId = query.branchId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.type) where.type = query.type;
    if (query.source) where.source = query.source;
    if (query.from || query.to) {
      const from = query.from ? new Date(query.from) : new Date(0);
      const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
      where.timestamp = Between(from, to);
    }
    const [items, total] = await this.eventRepository.findAndCount({
      where,
      relations: { employee: true, branch: true },
      order: { timestamp: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return Paginated.of(
      items.map((e) => this.presentEvent(e)),
      total,
      query,
    );
  }

  async daily(companyId: string, query: DailyQueryDto) {
    const timezone = await this.companyTimezone(companyId);
    const employees = await this.employeeRepository.find({
      where: {
        companyId,
        deletedAt: IsNull(),
        status: In([EmployeeStatus.ACTIVE, EmployeeStatus.VACATION]),
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      relations: { branch: true },
      order: { lastName: 'ASC' },
    });
    if (employees.length === 0) return [];
    const employeeIds = employees.map((e) => e.id);
    const dayStart = zonedTimeToUtc(query.date, '00:00', timezone);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const [workDays, events] = await Promise.all([
      this.workDayRepository.find({
        where: { employeeId: In(employeeIds), date: query.date },
      }),
      this.eventRepository.find({
        where: { employeeId: In(employeeIds), timestamp: Between(dayStart, dayEnd) },
        order: { timestamp: 'ASC' },
      }),
    ]);
    const workDayMap = new Map(workDays.map((w) => [w.employeeId, w]));
    return employees.map((employee) => {
      const workDay = workDayMap.get(employee.id);
      return {
        employee: this.employeeSummary(employee),
        workDay: workDay
          ? {
              status: workDay.status,
              scheduledMinutes: workDay.scheduledMinutes,
              workedMinutes: workDay.workedMinutes,
              lateMinutes: workDay.lateMinutes,
              earlyLeaveMinutes: workDay.earlyLeaveMinutes,
              overtimeMinutes: workDay.overtimeMinutes,
              isExcused: workDay.isExcused,
              excuseReason: workDay.excuseReason,
            }
          : null,
        events: events
          .filter((e) => e.employeeId === employee.id)
          .map((e) => ({
            id: e.id,
            type: e.type,
            source: e.source,
            timestamp: e.timestamp,
            confidence: e.confidence,
            snapshotUrl: e.snapshotUrl,
            isManual: e.isManual,
          })),
      };
    });
  }

  async monthly(companyId: string, query: MonthlyQueryDto) {
    const from = `${query.month}-01`;
    const to = addDaysToDateStr(`${query.month}-01`, 31).slice(0, 8) + '01';
    const rows = await this.workDayRepository
      .createQueryBuilder('wd')
      .innerJoinAndSelect('wd.employee', 'employee')
      .where('employee."companyId" = :companyId', { companyId })
      .andWhere('employee."deletedAt" IS NULL')
      .andWhere('wd.date >= :from AND wd.date < :to', { from, to })
      .andWhere(query.branchId ? 'employee."branchId" = :branchId' : 'TRUE', {
        branchId: query.branchId,
      })
      .orderBy('employee."lastName"', 'ASC')
      .addOrderBy('wd.date', 'ASC')
      .getMany();

    const byEmployee = new Map<string, { employee: Employee; days: WorkDay[] }>();
    for (const row of rows) {
      const entry = byEmployee.get(row.employeeId) ?? { employee: row.employee!, days: [] };
      entry.days.push(row);
      byEmployee.set(row.employeeId, entry);
    }
    return [...byEmployee.values()].map(({ employee, days }) => ({
      employee: this.employeeSummary(employee),
      days: days.map((d) => ({
        date: d.date,
        status: d.status,
        workedMinutes: d.workedMinutes,
        lateMinutes: d.lateMinutes,
        overtimeMinutes: d.overtimeMinutes,
      })),
      totals: {
        presentDays: days.filter(
          (d) => d.status === WorkDayStatus.PRESENT || d.status === WorkDayStatus.LATE,
        ).length,
        lateDays: days.filter((d) => d.status === WorkDayStatus.LATE).length,
        absentDays: days.filter((d) => d.status === WorkDayStatus.ABSENT).length,
        workedMinutes: days.reduce((s, d) => s + d.workedMinutes, 0),
        lateMinutes: days.reduce((s, d) => s + d.lateMinutes, 0),
        overtimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
      },
    }));
  }

  /**
   * Davomat statistikasi: oylik va tanlangan kunlik kesimda
   * kelgan / kechikkan / kelmagan / sababli xodimlar (kun-yozuvlari) soni.
   */
  async stats(companyId: string, query: StatsQueryDto) {
    const monthFrom = `${query.month}-01`;
    const monthTo = addDaysToDateStr(`${query.month}-01`, 31).slice(0, 8) + '01';

    const base = () => {
      const qb = this.workDayRepository
        .createQueryBuilder('wd')
        .innerJoin('wd.employee', 'e')
        .where('e."companyId" = :companyId', { companyId })
        .andWhere('e."deletedAt" IS NULL');
      if (query.branchId) qb.andWhere('e."branchId" = :branchId', { branchId: query.branchId });
      return qb;
    };

    const [monthDays, dayDays] = await Promise.all([
      base()
        .andWhere('wd.date >= :monthFrom AND wd.date < :monthTo', { monthFrom, monthTo })
        .getMany(),
      base().andWhere('wd.date = :date', { date: query.date }).getMany(),
    ]);

    const agg = (rows: WorkDay[]) => ({
      total: rows.length,
      // Kelgan = kelgan + kechikkan (kechikkan ham ishga kelgan hisoblanadi)
      present: rows.filter(
        (d) => d.status === WorkDayStatus.PRESENT || d.status === WorkDayStatus.LATE,
      ).length,
      late: rows.filter((d) => d.status === WorkDayStatus.LATE).length,
      // Kelmagan — faqat SABABSIZ (sababli alohida sanaladi)
      absent: rows.filter((d) => d.status === WorkDayStatus.ABSENT && !d.isExcused).length,
      excused: rows.filter((d) => d.isExcused).length,
    });

    return { monthly: agg(monthDays), daily: agg(dayDays) };
  }

  async createManual(companyId: string, actor: RequestUser, dto: ManualEventDto) {
    const employee = await this.employeeRepository.findOne({
      where: { id: dto.employeeId, companyId, deletedAt: IsNull() },
    });
    if (!employee) throw AppException.notFound('Xodim topilmadi');
    const timezone = await this.companyTimezone(companyId);
    const event = await this.saveEventAndRecalc({
      employee,
      branchId: employee.branchId,
      deviceId: null,
      type: dto.type,
      // Kontrakt source'ni KIOSK|MOBILE bilan cheklaydi; manual belgisi isManual=true
      source: AttendanceSource.KIOSK,
      timestamp: new Date(dto.timestamp),
      confidence: null,
      livenessScore: null,
      snapshotUrl: null,
      isManual: true,
      manualByUserId: actor.id,
      note: dto.note ?? null,
      timezone,
      skipDebounce: true,
    });
    return this.presentEvent(
      (await this.eventRepository.findOne({
        where: { id: event.id },
        relations: { employee: true, branch: true },
      }))!,
    );
  }

  /**
   * Biror kunni "sababli" (uzrli) qilib belgilaydi yoki ortga qaytaradi.
   * Sababli kunga jarima qo'llanmaydi va u davomat bonusini buzmaydi (payroll-calc).
   */
  async setExcused(companyId: string, actor: RequestUser, dto: ExcuseDayDto) {
    const employee = await this.employeeRepository.findOne({
      where: { id: dto.employeeId, companyId, deletedAt: IsNull() },
    });
    if (!employee) throw AppException.notFound('Xodim topilmadi');
    if (dto.isExcused && !dto.reason?.trim()) {
      throw AppException.validation('Sababli qilish uchun izoh kiriting');
    }

    const timezone = await this.companyTimezone(companyId);
    // WorkDay yozuvi yo'q bo'lsa (masalan sababsiz kelmagan kun) — avval hisoblab yaratamiz.
    let workDay = await this.workDayRepository.findOne({
      where: { employeeId: employee.id, date: dto.date },
    });
    if (!workDay) {
      workDay = await this.workDayService.recalc(employee, dto.date, timezone);
    }
    if (!workDay) {
      throw AppException.validation(
        'Bu sana uchun ish kuni yozuvi yo‘q (dam olish kuni yoki grafik belgilanmagan)',
      );
    }

    const oldValue = { isExcused: workDay.isExcused, excuseReason: workDay.excuseReason };
    workDay.isExcused = dto.isExcused;
    workDay.excuseReason = dto.isExcused ? (dto.reason?.trim() ?? null) : null;
    const saved = await this.workDayRepository.save(workDay);

    await this.auditService.log({
      userId: actor.id,
      companyId,
      action: dto.isExcused ? 'attendance.dayExcused' : 'attendance.dayUnexcused',
      entityType: 'workDay',
      entityId: saved.id,
      oldValue,
      newValue: {
        date: dto.date,
        employeeId: employee.id,
        isExcused: saved.isExcused,
        excuseReason: saved.excuseReason,
      },
    });

    return {
      employeeId: employee.id,
      date: saved.date,
      status: saved.status,
      isExcused: saved.isExcused,
      excuseReason: saved.excuseReason,
    };
  }

  /** @returns yangilangan event; oldValue audit uchun alohida qaytadi */
  async updateEvent(companyId: string, id: string, dto: UpdateEventDto) {
    const event = await this.getCompanyEvent(companyId, id);
    const oldValue = {
      type: event.type,
      timestamp: event.timestamp,
      note: event.note,
    };
    const timezone = await this.companyTimezone(companyId);
    const oldDate = dateStrInTz(event.timestamp, timezone);
    if (dto.type) event.type = dto.type;
    if (dto.timestamp) event.timestamp = new Date(dto.timestamp);
    if (dto.note !== undefined) event.note = dto.note;
    event.isManual = true;
    await this.eventRepository.save(event);

    const employee = await this.employeeRepository.findOne({
      where: { id: event.employeeId },
    });
    if (employee) {
      const newDate = dateStrInTz(event.timestamp, timezone);
      await this.workDayService.recalc(employee, oldDate, timezone);
      if (newDate !== oldDate) await this.workDayService.recalc(employee, newDate, timezone);
    }
    return { oldValue, event: this.presentEvent(event) };
  }

  async deleteEvent(companyId: string, id: string) {
    const event = await this.getCompanyEvent(companyId, id);
    const oldValue = {
      employeeId: event.employeeId,
      type: event.type,
      timestamp: event.timestamp,
    };
    const timezone = await this.companyTimezone(companyId);
    const date = dateStrInTz(event.timestamp, timezone);
    await this.eventRepository.remove(event);
    const employee = await this.employeeRepository.findOne({
      where: { id: oldValue.employeeId },
    });
    if (employee) await this.workDayService.recalc(employee, date, timezone);
    return { oldValue, ok: true };
  }

  // ================= Statistika (WS payload) =================

  async todayStats(companyId: string, timezone: string) {
    const today = dateStrInTz(new Date(), timezone);
    const total = await this.employeeRepository.count({
      where: { companyId, status: EmployeeStatus.ACTIVE, deletedAt: IsNull() },
    });
    const workDays = await this.workDayRepository
      .createQueryBuilder('wd')
      .innerJoin('wd.employee', 'employee')
      .where('employee."companyId" = :companyId AND wd.date = :today', { companyId, today })
      .select(['wd.status AS status', 'COUNT(*)::int AS count'])
      .groupBy('wd.status')
      .getRawMany<{ status: WorkDayStatus; count: number }>();
    const byStatus = Object.fromEntries(workDays.map((r) => [r.status, Number(r.count)]));
    const present = (byStatus[WorkDayStatus.PRESENT] ?? 0) + (byStatus[WorkDayStatus.LATE] ?? 0);

    const dayStart = zonedTimeToUtc(today, '00:00', timezone);
    const checkedOutRow = await this.eventRepository.query(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT DISTINCT ON (ae."employeeId") ae."employeeId", ae."type"
         FROM attendance_events ae
         JOIN employees e ON e.id = ae."employeeId"
         WHERE e."companyId" = $1 AND ae."timestamp" >= $2
         ORDER BY ae."employeeId", ae."timestamp" DESC
       ) last_events WHERE last_events."type" = 'CHECK_OUT'`,
      [companyId, dayStart],
    );
    return {
      total,
      present,
      late: byStatus[WorkDayStatus.LATE] ?? 0,
      absent: Math.max(0, total - present),
      checkedOut: Number(checkedOutRow[0]?.count ?? 0),
    };
  }

  // ================= Ichki yordamchilar =================

  private async saveEventAndRecalc(params: {
    employee: Employee;
    branchId: string;
    deviceId: string | null;
    type: AttendanceEventType;
    source: AttendanceSource;
    timestamp: Date;
    confidence: number | null;
    livenessScore: number | null;
    snapshotUrl: string | null;
    latitude?: number;
    longitude?: number;
    isManual?: boolean;
    manualByUserId?: string;
    note?: string | null;
    timezone: string;
    skipDebounce?: boolean;
  }): Promise<AttendanceEvent> {
    const event = await this.eventRepository.save(
      this.eventRepository.create({
        employeeId: params.employee.id,
        branchId: params.branchId,
        deviceId: params.deviceId,
        type: params.type,
        source: params.source,
        timestamp: params.timestamp,
        confidence: params.confidence,
        livenessScore: params.livenessScore,
        snapshotUrl: params.snapshotUrl,
        latitude: params.latitude ?? null,
        longitude: params.longitude ?? null,
        isManual: params.isManual ?? false,
        manualByUserId: params.manualByUserId ?? null,
        note: params.note ?? null,
      }),
    );

    if (!params.skipDebounce) {
      await this.setDebounce(params.employee.id, {
        eventId: event.id,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
      });
    }

    const dateStr = dateStrInTz(event.timestamp, params.timezone);
    await this.workDayService.recalc(params.employee, dateStr, params.timezone);

    const todayStats = await this.todayStats(params.employee.companyId, params.timezone);
    this.wsService.emitAttendanceNew(params.employee.companyId, params.branchId, {
      event: {
        id: event.id,
        type: event.type,
        source: event.source,
        timestamp: event.timestamp,
        snapshotUrl: event.snapshotUrl,
        isManual: event.isManual,
      },
      employee: this.employeeSummary(params.employee),
      todayStats,
    });

    return event;
  }

  /** direction=BOTH: bugungi oxirgi eventga qarab IN/OUT almashadi */
  private async resolveEventType(
    direction: DeviceDirection,
    employeeId: string,
    timezone: string,
  ): Promise<AttendanceEventType> {
    if (direction === DeviceDirection.IN) return AttendanceEventType.CHECK_IN;
    if (direction === DeviceDirection.OUT) return AttendanceEventType.CHECK_OUT;
    const today = dateStrInTz(new Date(), timezone);
    const dayStart = zonedTimeToUtc(today, '00:00', timezone);
    const lastEvent = await this.eventRepository.findOne({
      where: { employeeId, timestamp: Between(dayStart, new Date()) },
      order: { timestamp: 'DESC' },
    });
    return lastEvent?.type === AttendanceEventType.CHECK_IN
      ? AttendanceEventType.CHECK_OUT
      : AttendanceEventType.CHECK_IN;
  }

  /** NaN / undefined qiymatlarni null'ga aylantiradi (Postgres float NaN'ni saqlab qolmasligi uchun). */
  private finiteOrNull(v: number | null | undefined): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  private async uploadSnapshot(companyId: string, image: Buffer): Promise<string | null> {
    try {
      return await this.minioService.upload(
        this.minioService.snapshotsBucket,
        `${companyId}/${new Date().toISOString().slice(0, 10)}`,
        image,
        'image/jpeg',
        'jpg',
      );
    } catch {
      // Snapshot saqlanmasa ham davomat qayd etilaveradi
      return null;
    }
  }

  private async getDebounce(employeeId: string): Promise<DebounceValue | null> {
    const raw = await this.redis.get(this.debounceKey(employeeId));
    return raw ? (JSON.parse(raw) as DebounceValue) : null;
  }

  private async setDebounce(employeeId: string, value: DebounceValue): Promise<void> {
    const ttl = Number(this.config.get('ATTENDANCE_DEBOUNCE_SECONDS') ?? 60);
    await this.redis.set(this.debounceKey(employeeId), JSON.stringify(value), 'EX', ttl);
  }

  private debounceKey(employeeId: string): string {
    return `attendance:debounce:${employeeId}`;
  }

  private async getCompanyEvent(companyId: string, id: string): Promise<AttendanceEvent> {
    const event = await this.eventRepository.findOne({
      where: { id, employee: { companyId } },
      relations: { employee: true },
    });
    if (!event) throw AppException.notFound('Davomat eventi topilmadi');
    return event;
  }

  private async companyTimezone(companyId: string): Promise<string> {
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    return company?.timezone || 'Asia/Tashkent';
  }

  private employeeSummary(employee: Employee) {
    return {
      id: employee.id,
      fullName: employee.fullName,
      photoUrl: employee.photoUrls?.[0] ?? null,
      position: employee.position,
    };
  }

  private presentEvent(event: AttendanceEvent) {
    return {
      id: event.id,
      employee: event.employee
        ? {
            id: event.employee.id,
            fullName: event.employee.fullName,
            photoUrl: event.employee.photoUrls?.[0] ?? null,
          }
        : null,
      branch: event.branch ? { id: event.branch.id, name: event.branch.name } : null,
      type: event.type,
      source: event.source,
      timestamp: event.timestamp,
      confidence: event.confidence,
      snapshotUrl: event.snapshotUrl,
      isManual: event.isManual,
      note: event.note,
    };
  }
}
