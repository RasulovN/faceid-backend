import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Branch } from '../../entities/branch.entity';
import { Employee } from '../../entities/employee.entity';
import { WorkSchedule } from '../../entities/work-schedule.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dtos';

@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(WorkSchedule)
    private readonly scheduleRepository: Repository<WorkSchedule>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
  ) {}

  async findAll(companyId: string, query: PaginationDto) {
    const [items, total] = await this.scheduleRepository.findAndCount({
      where: query.search ? { companyId, name: ILike(`%${query.search}%`) } : { companyId },
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
