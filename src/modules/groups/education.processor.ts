import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { Between, In, IsNull, Repository } from 'typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Group } from '../../entities/group.entity';
import { GroupStudent } from '../../entities/group-student.entity';
import {
  AttendanceEventType,
  CompanyIndustry,
  CompanyStatus,
} from '../../common/enums';
import {
  dayOfWeekInTz,
  minutesFromMidnightInTz,
  dateStrInTz,
  timeStrToMinutes,
  zonedTimeToUtc,
} from '../../common/utils/tz.util';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TelegramService } from '../telegram/telegram.service';
import { LESSON_EARLY_WINDOW_MINUTES } from './groups.service';

export const EDUCATION_QUEUE = 'education';
export const JOB_ABSENT_SCAN = 'absent-scan';

/** Trigger o'tkazib yuborilgan bo'lsa (restart va h.k.) shu oynagacha qayta uriniladi */
const CATCH_UP_WINDOW_MINUTES = 30;

/**
 * Har 5 daqiqada: EDUCATION kompaniyalarning bugungi darslari bo'yicha
 * "dars boshlanib absentAfterMinutes o'tdi, lekin o'quvchi kelmadi" holatini
 * aniqlab, ota-onaga Telegram xabar yuboradi. Har guruh har kuni faqat bir
 * marta skanerlanadi (Redis SETNX dedup).
 */
@Processor(EDUCATION_QUEUE)
export class EducationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EducationProcessor.name);

  constructor(
    @InjectQueue(EDUCATION_QUEUE) private readonly queue: Queue,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(Group) private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupStudent)
    private readonly memberRepository: Repository<GroupStudent>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly telegramService: TelegramService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        JOB_ABSENT_SCAN,
        {},
        {
          repeat: { pattern: '*/5 * * * *' },
          jobId: JOB_ABSENT_SCAN,
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      );
      this.logger.log('Education absent-scan repeatable jobi ro‘yxatdan o‘tdi (har 5 daqiqa)');
    } catch (err) {
      this.logger.error(
        `Repeatable jobni ro‘yxatdan o‘tkazishda xato: ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== JOB_ABSENT_SCAN) return null;
    // Bot ulanmagan bo'lsa xabar yuborishning iloji yo'q — skanerlash ham shart emas
    if (!this.telegramService.enabled) return { skipped: 'telegram-disabled' };
    let notified = 0;
    const companies = await this.companyRepository.find({
      where: { industry: CompanyIndustry.EDUCATION, status: CompanyStatus.ACTIVE },
    });
    for (const company of companies) {
      notified += await this.scanCompany(company).catch((err) => {
        this.logger.warn(`absent-scan (${company.slug}): ${(err as Error).message}`);
        return 0;
      });
    }
    if (notified > 0) this.logger.log(`absent-scan: ${notified} ta "kelmadi" xabari yuborildi`);
    return { notified };
  }

  private async scanCompany(company: Company): Promise<number> {
    const timezone = company.timezone || 'Asia/Tashkent';
    const now = new Date();
    const today = dateStrInTz(now, timezone);
    const dow = dayOfWeekInTz(now, timezone);
    const nowMin = minutesFromMidnightInTz(now, timezone);

    const groups = await this.groupRepository.find({
      where: { companyId: company.id, archived: false },
    });
    let notified = 0;

    for (const group of groups) {
      const day = (group.days ?? []).find((d) => {
        if (d.dayOfWeek !== dow) return false;
        const trigger = timeStrToMinutes(d.startTime) + group.absentAfterMinutes;
        return nowMin >= trigger && nowMin <= trigger + CATCH_UP_WINDOW_MINUTES;
      });
      if (!day) continue;

      // Har guruh-kun uchun bitta marta
      const dedupKey = `edu:absent:${group.id}:${today}`;
      const locked = await this.redis.set(dedupKey, '1', 'EX', 172_800, 'NX');
      if (!locked) continue;

      const members = await this.memberRepository.find({ where: { groupId: group.id } });
      if (members.length === 0) continue;
      const studentIds = members.map((m) => m.studentId);

      const windowStart = zonedTimeToUtc(today, day.startTime, timezone);
      const events = await this.eventRepository.find({
        where: {
          employeeId: In(studentIds),
          type: AttendanceEventType.CHECK_IN,
          timestamp: Between(
            new Date(windowStart.getTime() - LESSON_EARLY_WINDOW_MINUTES * 60_000),
            now,
          ),
        },
        select: { employeeId: true },
      });
      const arrived = new Set(events.map((e) => e.employeeId));

      const absentees = await this.employeeRepository.find({
        where: { id: In(studentIds.filter((id) => !arrived.has(id))), deletedAt: IsNull() },
      });
      for (const student of absentees) {
        if ((student.parentPhones ?? []).length === 0) continue;
        await this.telegramService.notifyStudentAbsent({
          student,
          group,
          startTime: day.startTime,
          companyName: company.name,
        });
        notified += 1;
      }
    }
    return notified;
  }
}
