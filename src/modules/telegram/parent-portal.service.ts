import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { GroupStudent } from '../../entities/group-student.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { AttendanceEventType } from '../../common/enums';
import {
  dateStrInTz,
  datesOfMonth,
  minutesFromMidnightInTz,
  zonedTimeToUtc,
} from '../../common/utils/tz.util';
import {
  computeLessonMark,
  dowOfDateStr,
  JournalMark,
} from '../groups/lesson-marks.util';
import { TelegramService } from './telegram.service';
import { verifyTelegramInitData } from './telegram-webapp.util';

export interface PortalDayRow {
  date: string;
  dayOfWeek: number;
  groupId: string;
  groupName: string;
  startTime: string;
  endTime: string;
  mark: JournalMark;
  /** Kelgan bo'lsa check-in vaqti HH:mm */
  time: string | null;
  minutesLate: number;
}

/**
 * Telegram Mini App — ota-ona kabineti. Autentifikatsiya: initData HMAC
 * (bot token bilan) → chatId → telegram_contacts'dagi ulangan telefon(lar)
 * → parentPhones'ida shu raqam bo'lgan o'quvchilar. Sessiya/parol yo'q.
 */
@Injectable()
export class ParentPortalService {
  constructor(
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(GroupStudent)
    private readonly memberRepository: Repository<GroupStudent>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    private readonly telegramService: TelegramService,
    private readonly config: ConfigService,
  ) {}

  async overview(initData: string, month?: string) {
    if (!this.telegramService.enabled) {
      throw AppException.validation('Telegram bot hali sozlanmagan');
    }
    const verified = verifyTelegramInitData(initData, this.telegramService.botToken);
    if (!verified.ok || !verified.user) {
      throw AppException.unauthorized('Telegram maʼlumotlari tasdiqlanmadi — botni qayta oching');
    }

    const contacts = await this.telegramService.findContactsByChatId(String(verified.user.id));
    if (contacts.length === 0) {
      return { linked: false as const, students: [] };
    }
    const phones = contacts.map((c) => c.phone);

    // Telefon(lar)ga biriktirilgan o'quvchilar (kompaniyalararo)
    const byId = new Map<string, Employee>();
    for (const phone of phones) {
      for (const student of await this.telegramService.findStudentsByPhone(phone)) {
        byId.set(student.id, student);
      }
    }
    const students = [...byId.values()];
    if (students.length === 0) {
      return { linked: true as const, phones, students: [] };
    }

    const companies = await this.companyRepository.find({
      where: { id: In([...new Set(students.map((s) => s.companyId))]) },
    });
    const companyById = new Map(companies.map((c) => [c.id, c]));

    const targetMonth =
      month ?? dateStrInTz(new Date(), companies[0]?.timezone || 'Asia/Tashkent').slice(0, 7);

    const rows = await Promise.all(
      students.map(async (student) => {
        const company = companyById.get(student.companyId);
        const timezone = company?.timezone || 'Asia/Tashkent';
        const attendance = await this.studentMonth(student, targetMonth, timezone);
        return {
          id: student.id,
          fullName: student.fullName,
          firstName: student.firstName,
          photoUrl: student.photoUrls?.[0] ?? null,
          companyName: company?.name ?? '',
          ...attendance,
        };
      }),
    );

    return { linked: true as const, phones, month: targetMonth, students: rows };
  }

  /** Bitta o'quvchining oylik davomati — barcha guruhlari kesimida */
  private async studentMonth(student: Employee, month: string, timezone: string) {
    const memberships = await this.memberRepository.find({
      where: { studentId: student.id },
      relations: { group: true },
    });
    const groups = memberships
      .map((m) => m.group)
      .filter((g): g is NonNullable<typeof g> => !!g && !g.archived);

    // Oy kunlari × guruh jadvali → dars qatorlari
    const lessonRows: Array<Omit<PortalDayRow, 'mark' | 'time' | 'minutesLate'>> = [];
    for (const date of datesOfMonth(month)) {
      const dow = dowOfDateStr(date);
      for (const group of groups) {
        const day = (group.days ?? []).find((d) => d.dayOfWeek === dow);
        if (!day) continue;
        lessonRows.push({
          date,
          dayOfWeek: dow,
          groupId: group.id,
          groupName: group.name,
          startTime: day.startTime,
          endTime: day.endTime,
        });
      }
    }
    lessonRows.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

    // Oy bo'yicha CHECK_IN eventlari bitta so'rovda, kun bo'yicha indeks
    const eventsByDate = new Map<string, AttendanceEvent[]>();
    if (lessonRows.length > 0) {
      const first = lessonRows[0].date;
      const last = lessonRows[lessonRows.length - 1].date;
      const events = await this.eventRepository.find({
        where: {
          employeeId: student.id,
          type: AttendanceEventType.CHECK_IN,
          timestamp: Between(
            zonedTimeToUtc(first, '00:00', timezone),
            new Date(zonedTimeToUtc(last, '23:59', timezone).getTime() + 60_000),
          ),
        },
        order: { timestamp: 'ASC' },
      });
      for (const event of events) {
        const date = dateStrInTz(event.timestamp, timezone);
        const list = eventsByDate.get(date) ?? [];
        list.push(event);
        eventsByDate.set(date, list);
      }
    }

    const now = new Date();
    const today = dateStrInTz(now, timezone);
    const nowMin = minutesFromMidnightInTz(now, timezone);
    const groupById = new Map(groups.map((g) => [g.id, g]));

    const days: PortalDayRow[] = lessonRows.map((row) => {
      const group = groupById.get(row.groupId)!;
      const dayEvents = eventsByDate.get(row.date) ?? [];
      // Shu guruhga bog'langan event ustuvor, bo'lmasa kunning birinchi eventi
      const event =
        dayEvents.find((e) => e.groupId === row.groupId) ?? dayEvents[0] ?? null;
      const evMin = event ? minutesFromMidnightInTz(event.timestamp, timezone) : null;
      const mark = computeLessonMark({
        event: event ? { minutes: evMin!, sameGroup: event.groupId === row.groupId } : null,
        day: { dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime },
        gracePeriodMinutes: group.gracePeriodMinutes,
        date: row.date,
        today,
        nowMin,
      });
      const startMin = Number(row.startTime.slice(0, 2)) * 60 + Number(row.startTime.slice(3));
      return {
        ...row,
        mark,
        time:
          mark === 'PRESENT' || mark === 'LATE'
            ? this.timeInTz(event!.timestamp, timezone)
            : null,
        minutesLate: mark === 'LATE' && evMin != null ? Math.max(0, evMin - startMin) : 0,
      };
    });

    const summary = {
      present: days.filter((d) => d.mark === 'PRESENT').length,
      late: days.filter((d) => d.mark === 'LATE').length,
      absent: days.filter((d) => d.mark === 'ABSENT').length,
      total: days.filter((d) => d.mark !== null).length,
    };

    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name })),
      summary,
      days,
    };
  }

  private timeInTz(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }
}
