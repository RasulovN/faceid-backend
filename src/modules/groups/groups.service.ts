import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Group, LessonDay } from '../../entities/group.entity';
import { GroupStudent } from '../../entities/group-student.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { AttendanceEventType, PersonType } from '../../common/enums';
import {
  dateStrInTz,
  dayOfWeekInTz,
  datesOfMonth,
  minutesFromMidnightInTz,
  timeStrToMinutes,
  zonedTimeToUtc,
} from '../../common/utils/tz.util';
import {
  AddGroupStudentsDto,
  CreateGroupDto,
  GroupListQueryDto,
  UpdateGroupDto,
} from './dto/group.dtos';
import {
  computeLessonMark,
  dowOfDateStr,
  JournalMark,
  LESSON_EARLY_WINDOW_MINUTES,
} from './lesson-marks.util';

export { LESSON_EARLY_WINDOW_MINUTES };
export type { JournalMark };

/** Kiosk check-in'da aniqlangan joriy dars */
export interface ResolvedLesson {
  group: Group;
  day: LessonDay;
  /** 0 — o'z vaqtida (grace ichida); >0 — dars boshidan shuncha daqiqa kechikdi */
  minutesLate: number;
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group) private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupStudent)
    private readonly memberRepository: Repository<GroupStudent>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
  ) {}

  // ---------- CRUD ----------

  async findAll(companyId: string, query: GroupListQueryDto) {
    const qb = this.groupRepository
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.branch', 'branch')
      .leftJoinAndSelect('g.teacher', 'teacher')
      .where('g."companyId" = :companyId', { companyId })
      .orderBy('g."createdAt"', 'DESC');
    if (!query.includeArchived) qb.andWhere('g.archived = false');
    if (query.branchId) qb.andWhere('g."branchId" = :branchId', { branchId: query.branchId });
    if (query.search) qb.andWhere('g.name ILIKE :search', { search: `%${query.search}%` });
    const groups = await qb.getMany();

    const counts = new Map<string, number>();
    if (groups.length > 0) {
      const rows = await this.memberRepository
        .createQueryBuilder('gs')
        .select('gs."groupId"', 'groupId')
        .addSelect('COUNT(*)::int', 'count')
        .where('gs."groupId" IN (:...ids)', { ids: groups.map((g) => g.id) })
        .groupBy('gs."groupId"')
        .getRawMany<{ groupId: string; count: number }>();
      for (const row of rows) counts.set(row.groupId, Number(row.count));
    }
    return groups.map((g) => this.present(g, counts.get(g.id) ?? 0));
  }

  async findOne(companyId: string, id: string) {
    const group = await this.getEntity(companyId, id, true);
    const members = await this.memberRepository.find({
      where: { groupId: group.id },
      relations: { student: true },
      order: { createdAt: 'ASC' },
    });
    const students = members
      .map((m) => m.student)
      .filter((s): s is Employee => !!s && !s.deletedAt)
      .map((s) => this.presentStudent(s));
    return { ...this.present(group, students.length), students };
  }

  async create(companyId: string, dto: CreateGroupDto) {
    await this.assertRefs(companyId, dto);
    const group = await this.groupRepository.save(
      this.groupRepository.create({
        companyId,
        name: dto.name.trim(),
        branchId: dto.branchId ?? null,
        teacherId: dto.teacherId ?? null,
        days: this.normalizeDays(dto.days),
        gracePeriodMinutes: dto.gracePeriodMinutes ?? 10,
        absentAfterMinutes: dto.absentAfterMinutes ?? 20,
        archived: dto.archived ?? false,
      }),
    );
    return this.findOne(companyId, group.id);
  }

  async update(companyId: string, id: string, dto: UpdateGroupDto) {
    const group = await this.getEntity(companyId, id);
    await this.assertRefs(companyId, dto);
    if (dto.name !== undefined) group.name = dto.name.trim();
    if (dto.branchId !== undefined) group.branchId = dto.branchId ?? null;
    if (dto.teacherId !== undefined) group.teacherId = dto.teacherId ?? null;
    if (dto.days !== undefined) group.days = this.normalizeDays(dto.days);
    if (dto.gracePeriodMinutes !== undefined) group.gracePeriodMinutes = dto.gracePeriodMinutes;
    if (dto.absentAfterMinutes !== undefined) group.absentAfterMinutes = dto.absentAfterMinutes;
    if (dto.archived !== undefined) group.archived = dto.archived;
    await this.groupRepository.save(group);
    return this.findOne(companyId, id);
  }

  /** Hard delete: group_students CASCADE, attendance_events.groupId SET NULL bo'ladi */
  async remove(companyId: string, id: string): Promise<{ ok: boolean }> {
    const group = await this.getEntity(companyId, id);
    await this.groupRepository.delete({ id: group.id });
    return { ok: true };
  }

  // ---------- A'zolar ----------

  async addStudents(companyId: string, groupId: string, dto: AddGroupStudentsDto) {
    const group = await this.getEntity(companyId, groupId);
    const students = await this.employeeRepository.find({
      where: {
        id: In(dto.studentIds),
        companyId,
        personType: PersonType.STUDENT,
        deletedAt: IsNull(),
      },
      select: { id: true },
    });
    if (students.length === 0) {
      throw AppException.validation('Ko‘rsatilgan o‘quvchilar topilmadi');
    }
    await this.memberRepository
      .createQueryBuilder()
      .insert()
      .values(students.map((s) => ({ groupId: group.id, studentId: s.id })))
      .orIgnore()
      .execute();
    return this.findOne(companyId, groupId);
  }

  async removeStudent(companyId: string, groupId: string, studentId: string) {
    const group = await this.getEntity(companyId, groupId);
    await this.memberRepository.delete({ groupId: group.id, studentId });
    return this.findOne(companyId, groupId);
  }

  // ---------- Kiosk: joriy darsni aniqlash ----------

  /**
   * O'quvchi hozir qaysi guruh darsiga kelgan? Bugungi kunda jadvali bor,
   * [boshlanishdan 60 daqiqa oldin .. tugashgacha] oynasiga tushgan guruhlar
   * ichidan boshlanishiga eng yaqini tanlanadi. Topilmasa null — event baribir
   * yoziladi, faqat guruhga bog'lanmaydi.
   */
  async resolveCurrentLesson(
    studentId: string,
    at: Date,
    timezone: string,
  ): Promise<ResolvedLesson | null> {
    const memberships = await this.memberRepository.find({
      where: { studentId },
      relations: { group: true },
    });
    const dow = dayOfWeekInTz(at, timezone);
    const nowMin = minutesFromMidnightInTz(at, timezone);

    let best: { group: Group; day: LessonDay; delta: number } | null = null;
    for (const membership of memberships) {
      const group = membership.group;
      if (!group || group.archived) continue;
      for (const day of group.days ?? []) {
        if (day.dayOfWeek !== dow) continue;
        const start = timeStrToMinutes(day.startTime);
        const end = timeStrToMinutes(day.endTime);
        if (nowMin < start - LESSON_EARLY_WINDOW_MINUTES || nowMin > end) continue;
        const delta = Math.abs(nowMin - start);
        if (!best || delta < best.delta) best = { group, day, delta };
      }
    }
    if (!best) return null;
    const start = timeStrToMinutes(best.day.startTime);
    const minutesLate = nowMin > start + best.group.gracePeriodMinutes ? nowMin - start : 0;
    return { group: best.group, day: best.day, minutesLate };
  }

  // ---------- Jurnal ----------

  /**
   * Guruh × oy davomat jurnali: dars kunlari ustunlar, o'quvchilar qatorlar.
   * Belgi: PRESENT/LATE (check-in bor), ABSENT (dars tugagan, kelmagan),
   * null (kelajakdagi yoki hali tugamagan dars).
   */
  async journal(companyId: string, groupId: string, month: string) {
    const group = await this.getEntity(companyId, groupId, true);
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    const timezone = company?.timezone || 'Asia/Tashkent';

    const members = await this.memberRepository.find({
      where: { groupId: group.id },
      relations: { student: true },
      order: { createdAt: 'ASC' },
    });
    const students = members
      .map((m) => m.student)
      .filter((s): s is Employee => !!s && !s.deletedAt);

    const dayByDow = new Map<number, LessonDay>();
    for (const day of group.days ?? []) {
      if (!dayByDow.has(day.dayOfWeek)) dayByDow.set(day.dayOfWeek, day);
    }
    const dates = datesOfMonth(month).filter((date) => dayByDow.has(this.dowOfDateStr(date)));

    // Oy bo'yicha barcha a'zolarning CHECK_IN eventlari bitta so'rovda
    const eventIndex = new Map<string, AttendanceEvent>();
    if (students.length > 0 && dates.length > 0) {
      const rangeStart = zonedTimeToUtc(dates[0], '00:00', timezone);
      const rangeEnd = zonedTimeToUtc(dates[dates.length - 1], '23:59', timezone);
      const events = await this.eventRepository.find({
        where: {
          employeeId: In(students.map((s) => s.id)),
          type: AttendanceEventType.CHECK_IN,
          timestamp: Between(rangeStart, new Date(rangeEnd.getTime() + 60_000)),
        },
        order: { timestamp: 'ASC' },
      });
      for (const event of events) {
        const key = `${event.employeeId}|${dateStrInTz(event.timestamp, timezone)}`;
        const existing = eventIndex.get(key);
        // Shu guruhga bog'langan event ustuvor; bo'lmasa kunning birinchi eventi
        if (!existing || (event.groupId === group.id && existing.groupId !== group.id)) {
          eventIndex.set(key, event);
        }
      }
    }

    const now = new Date();
    const today = dateStrInTz(now, timezone);
    const nowMin = minutesFromMidnightInTz(now, timezone);

    const rows = students.map((student) => {
      const marks: Record<string, JournalMark> = {};
      let present = 0;
      let late = 0;
      let absent = 0;
      for (const date of dates) {
        const day = dayByDow.get(this.dowOfDateStr(date))!;
        const mark = this.markFor(
          eventIndex.get(`${student.id}|${date}`),
          group,
          day,
          date,
          today,
          nowMin,
          timezone,
        );
        marks[date] = mark;
        if (mark === 'PRESENT') present += 1;
        else if (mark === 'LATE') late += 1;
        else if (mark === 'ABSENT') absent += 1;
      }
      return {
        ...this.presentStudent(student),
        marks,
        summary: { present, late, absent },
      };
    });

    return {
      group: this.present(group, students.length),
      month,
      dates,
      lessonDays: [...dayByDow.values()],
      students: rows,
    };
  }

  // ---------- Yordamchilar ----------

  private markFor(
    event: AttendanceEvent | undefined,
    group: Group,
    day: LessonDay,
    date: string,
    today: string,
    nowMin: number,
    timezone: string,
  ): JournalMark {
    return computeLessonMark({
      event: event
        ? {
            minutes: minutesFromMidnightInTz(event.timestamp, timezone),
            sameGroup: event.groupId === group.id,
          }
        : null,
      day,
      gracePeriodMinutes: group.gracePeriodMinutes,
      date,
      today,
      nowMin,
    });
  }

  private dowOfDateStr(date: string): number {
    return dowOfDateStr(date);
  }

  async getEntity(companyId: string, id: string, withRelations = false): Promise<Group> {
    const group = await this.groupRepository.findOne({
      where: { id, companyId },
      ...(withRelations ? { relations: { branch: true, teacher: true } } : {}),
    });
    if (!group) throw AppException.notFound('Guruh topilmadi');
    return group;
  }

  private async assertRefs(
    companyId: string,
    dto: { branchId?: string | null; teacherId?: string | null },
  ): Promise<void> {
    if (dto.branchId) {
      const exists = await this.branchRepository.exists({
        where: { id: dto.branchId, companyId },
      });
      if (!exists) throw AppException.notFound('Filial topilmadi');
    }
    if (dto.teacherId) {
      const exists = await this.employeeRepository.exists({
        where: {
          id: dto.teacherId,
          companyId,
          personType: PersonType.EMPLOYEE,
          deletedAt: IsNull(),
        },
      });
      if (!exists) throw AppException.notFound('O‘qituvchi (xodim) topilmadi');
    }
  }

  private normalizeDays(days: LessonDay[]): LessonDay[] {
    return [...days].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
  }

  private present(group: Group, studentsCount: number) {
    return {
      id: group.id,
      name: group.name,
      branchId: group.branchId,
      branch: group.branch ? { id: group.branch.id, name: group.branch.name } : null,
      teacherId: group.teacherId,
      teacher: group.teacher
        ? { id: group.teacher.id, fullName: group.teacher.fullName }
        : null,
      days: group.days,
      gracePeriodMinutes: group.gracePeriodMinutes,
      absentAfterMinutes: group.absentAfterMinutes,
      archived: group.archived,
      studentsCount,
      createdAt: group.createdAt,
    };
  }

  private presentStudent(student: Employee) {
    return {
      id: student.id,
      fullName: student.fullName,
      firstName: student.firstName,
      lastName: student.lastName,
      tabNumber: student.tabNumber,
      photoUrl: student.photoUrls?.[0] ?? null,
      parentPhones: student.parentPhones ?? [],
      status: student.status,
    };
  }
}
