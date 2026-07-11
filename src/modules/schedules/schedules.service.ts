import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Repository } from 'typeorm';
import { Branch } from '../../entities/branch.entity';
import { Employee } from '../../entities/employee.entity';
import { ScheduleDay, WorkSchedule } from '../../entities/work-schedule.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { ScheduleType } from '../../common/enums';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dtos';

/** dow ro'yxati uchun bir xil kun sozlamalari */
function makeDays(
  dows: number[],
  startTime: string,
  endTime: string,
  lunch: { start: string; end: string } | null = { start: '13:00', end: '14:00' },
): ScheduleDay[] {
  return dows.map((dayOfWeek) => ({
    dayOfWeek,
    startTime,
    endTime,
    breakMinutes: 60,
    lunchStart: lunch?.start ?? null,
    lunchEnd: lunch?.end ?? null,
  }));
}

/** Yangi kompaniyalarga taklif qilinadigan standart grafiklar to'plami */
const DEFAULT_SCHEDULES: Array<
  Pick<WorkSchedule, 'name' | 'type' | 'days' | 'gracePeriodMinutes' | 'flexibleMinutes'>
> = [
  {
    name: 'Standart 5/2 (09:00–18:00)',
    type: ScheduleType.FIXED,
    days: makeDays([1, 2, 3, 4, 5], '09:00', '18:00'),
    gracePeriodMinutes: 10,
    flexibleMinutes: 0,
  },
  {
    name: '6 kunlik (09:00–18:00)',
    type: ScheduleType.FIXED,
    days: makeDays([1, 2, 3, 4, 5, 6], '09:00', '18:00'),
    gracePeriodMinutes: 10,
    flexibleMinutes: 0,
  },
  {
    name: 'Tungi smena (20:00–08:00)',
    type: ScheduleType.SHIFT,
    days: makeDays([1, 2, 3, 4, 5, 6, 7], '20:00', '08:00', null),
    gracePeriodMinutes: 15,
    flexibleMinutes: 0,
  },
];

@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(WorkSchedule)
    private readonly scheduleRepository: Repository<WorkSchedule>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
  ) {}

  async findAll(companyId: string, query: PaginationDto) {
    // Faqat shablonlar — legacy individual (employeeId'li) klonlar ro'yxatda ko'rinmaydi
    const base = { companyId, employeeId: IsNull() };
    const [items, total] = await this.scheduleRepository.findAndCount({
      where: query.search ? { ...base, name: ILike(`%${query.search}%`) } : base,
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return Paginated.of(items, total, query);
  }

  async findOne(companyId: string, id: string): Promise<WorkSchedule> {
    const schedule = await this.scheduleRepository.findOne({ where: { id, companyId } });
    if (!schedule) throw AppException.notFound('Ish grafigi topilmadi');
    return schedule;
  }

  async create(companyId: string, dto: CreateScheduleDto): Promise<WorkSchedule> {
    await this.validateBindings(companyId, dto.branchId, dto.employeeId);
    return this.scheduleRepository.save(
      this.scheduleRepository.create({
        ...dto,
        companyId,
        branchId: dto.branchId ?? null,
        employeeId: dto.employeeId ?? null,
      }),
    );
  }

  async update(companyId: string, id: string, dto: UpdateScheduleDto): Promise<WorkSchedule> {
    const schedule = await this.findOne(companyId, id);
    await this.validateBindings(companyId, dto.branchId, dto.employeeId);
    Object.assign(schedule, dto);
    return this.scheduleRepository.save(schedule);
  }

  /**
   * Standart grafiklar to'plamini qo'shadi (idempotent — nomi mavjudlari
   * o'tkazib yuboriladi). Registratsiyada va paneldagi tugmadan chaqiriladi.
   */
  async seedDefaults(companyId: string): Promise<WorkSchedule[]> {
    const created: WorkSchedule[] = [];
    for (const preset of DEFAULT_SCHEDULES) {
      const exists = await this.scheduleRepository.exists({
        where: { companyId, name: preset.name },
      });
      if (exists) continue;
      created.push(
        await this.scheduleRepository.save(
          this.scheduleRepository.create({
            ...preset,
            companyId,
            branchId: null,
            employeeId: null,
          }),
        ),
      );
    }
    return created;
  }

  async remove(companyId: string, id: string): Promise<{ ok: boolean }> {
    const schedule = await this.findOne(companyId, id);
    await this.scheduleRepository.remove(schedule);
    return { ok: true };
  }

  private async validateBindings(
    companyId: string,
    branchId?: string,
    employeeId?: string,
  ): Promise<void> {
    if (branchId) {
      const branch = await this.branchRepository.exists({ where: { id: branchId, companyId } });
      if (!branch) throw AppException.notFound('Ko‘rsatilgan filial topilmadi');
    }
    if (employeeId) {
      const employee = await this.employeeRepository.exists({
        where: { id: employeeId, companyId },
      });
      if (!employee) throw AppException.notFound('Ko‘rsatilgan xodim topilmadi');
    }
  }
}
