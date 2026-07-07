import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { WorkDay } from '../../entities/work-day.entity';
import { ScheduleDay, WorkSchedule } from '../../entities/work-schedule.entity';
import { EmployeeStatus } from '../../common/enums';
import {
  dateStrInTz,
  dayOfWeekInTz,
  minutesFromMidnightInTz,
  zonedTimeToUtc,
} from '../../common/utils/tz.util';
import { calcWorkDay } from './workday-calc';

export interface EffectiveSchedule {
  days: ScheduleDay[];
  gracePeriodMinutes: number;
}

@Injectable()
export class WorkDayService {
  private readonly logger = new Logger(WorkDayService.name);

  constructor(
    @InjectRepository(WorkDay) private readonly workDayRepository: Repository<WorkDay>,
    @InjectRepository(WorkSchedule)
    private readonly scheduleRepository: Repository<WorkSchedule>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
  ) {}

  /**
   * Amaldagi grafik: individual override > filial grafigi > filial workingHoursDefault
   */
  async resolveSchedule(employee: Employee): Promise<EffectiveSchedule | null> {
    const individual = await this.scheduleRepository.findOne({
      where: { employeeId: employee.id, companyId: employee.companyId },
      order: { createdAt: 'DESC' },
    });
    if (individual) {
      return { days: individual.days, gracePeriodMinutes: individual.gracePeriodMinutes };
    }
    const branchSchedule = await this.scheduleRepository.findOne({
      where: { branchId: employee.branchId, companyId: employee.companyId, employeeId: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (branchSchedule) {
      return {
        days: branchSchedule.days,
        gracePeriodMinutes: branchSchedule.gracePeriodMinutes,
      };
    }
    const branch = await this.branchRepository.findOne({ where: { id: employee.branchId } });
    if (branch?.workingHoursDefault?.length) {
      return { days: branch.workingHoursDefault, gracePeriodMinutes: 10 };
    }
    return null;
  }

  /** Bitta xodim + sana uchun WorkDay'ni qayta hisoblab saqlaydi */
  async recalc(employee: Employee, dateStr: string, timezone: string): Promise<WorkDay | null> {
    const schedule = await this.resolveSchedule(employee);
    const dayOfWeek = dayOfWeekInTz(zonedTimeToUtc(dateStr, '12:00', timezone), timezone);
    const scheduleDay = schedule?.days.find((d) => d.dayOfWeek === dayOfWeek) ?? null;

    const dayStart = zonedTimeToUtc(dateStr, '00:00', timezone);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const events = await this.eventRepository.find({
      where: { employeeId: employee.id, timestamp: Between(dayStart, dayEnd) },
      order: { timestamp: 'ASC' },
    });

    // Ishlanmaydigan kun + eventlar yo'q → WorkDay yozilmaydi
    if (!scheduleDay && events.length === 0) {
      await this.workDayRepository.delete({ employeeId: employee.id, date: dateStr });
      return null;
    }

    const now = new Date();
    const isToday = dateStrInTz(now, timezone) === dateStr;
    const result = calcWorkDay({
      scheduleDay,
      gracePeriodMinutes: schedule?.gracePeriodMinutes ?? 10,
      events: events.map((e) => ({
        type: e.type,
        minutes: minutesFromMidnightInTz(e.timestamp, timezone),
      })),
      employeeStatus: employee.status,
      nowMinutes: isToday ? minutesFromMidnightInTz(now, timezone) : undefined,
    });

    const existing = await this.workDayRepository.findOne({
      where: { employeeId: employee.id, date: dateStr },
    });
    const workDay = existing ?? this.workDayRepository.create({ employeeId: employee.id, date: dateStr });
    Object.assign(workDay, result);
    return this.workDayRepository.save(workDay);
  }

  /** Kompaniyaning barcha ACTIVE/VACATION xodimlari uchun sanani hisoblaydi (tungi job) */
  async recalcAllForDate(dateStr?: string): Promise<number> {
    const companies = await this.companyRepository.find();
    let processed = 0;
    for (const company of companies) {
      const timezone = company.timezone || 'Asia/Tashkent';
      const targetDate =
        dateStr ??
        dateStrInTz(new Date(Date.now() - 24 * 60 * 60 * 1000), timezone);
      const employees = await this.employeeRepository.find({
        where: [
          { companyId: company.id, status: EmployeeStatus.ACTIVE, deletedAt: IsNull() },
          { companyId: company.id, status: EmployeeStatus.VACATION, deletedAt: IsNull() },
        ],
      });
      for (const employee of employees) {
        try {
          await this.recalc(employee, targetDate, timezone);
          processed++;
        } catch (err) {
          this.logger.error(
            `WorkDay hisobi xato (employee=${employee.id}, date=${targetDate}): ${(err as Error).message}`,
          );
        }
      }
    }
    return processed;
  }
}
