import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Repository } from 'typeorm';
import { Branch } from '../../entities/branch.entity';
import { Employee } from '../../entities/employee.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { EmployeeStatus } from '../../common/enums';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { TariffLimitsService } from '../tariffs/tariff-limits.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dtos';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    private readonly tariffLimitsService: TariffLimitsService,
  ) {}

  async findAll(companyId: string, query: PaginationDto) {
    const [items, total] = await this.branchRepository.findAndCount({
      where: query.search ? { companyId, name: ILike(`%${query.search}%`) } : { companyId },
      order: { isMain: 'DESC', createdAt: 'ASC' },
      skip: query.skip,
      take: query.limit,
    });
    const withCounts = await Promise.all(
      items.map(async (branch) => ({
        ...branch,
        employeeCount: await this.employeeRepository.count({
          where: {
            branchId: branch.id,
            status: Not(EmployeeStatus.FIRED),
            deletedAt: IsNull(),
          },
        }),
      })),
    );
    return Paginated.of(withCounts, total, query);
  }

  async findOne(companyId: string, id: string) {
    const branch = await this.branchRepository.findOne({ where: { id, companyId } });
    if (!branch) throw AppException.notFound('Filial topilmadi');
    const employeeCount = await this.employeeRepository.count({
      where: { branchId: id, status: Not(EmployeeStatus.FIRED), deletedAt: IsNull() },
    });
    return { ...branch, employeeCount };
  }

  async create(companyId: string, dto: CreateBranchDto): Promise<Branch> {
    await this.tariffLimitsService.assertCanCreate(companyId, 'branch');
    return this.branchRepository.save(
      this.branchRepository.create({ ...dto, companyId }),
    );
  }

  async update(companyId: string, id: string, dto: UpdateBranchDto): Promise<Branch> {
    const branch = await this.getEntity(companyId, id);
    Object.assign(branch, dto);
    return this.branchRepository.save(branch);
  }

  async remove(companyId: string, id: string): Promise<{ ok: boolean }> {
    const branch = await this.getEntity(companyId, id);
    const employeeCount = await this.employeeRepository.count({
      where: { branchId: id, deletedAt: IsNull() },
    });
    if (employeeCount > 0) {
      throw AppException.conflict(
        `Filialda ${employeeCount} ta xodim bor. Avval xodimlarni boshqa filialga o‘tkazing.`,
      );
    }
    await this.branchRepository.remove(branch);
    return { ok: true };
  }

  async getEntity(companyId: string, id: string): Promise<Branch> {
    const branch = await this.branchRepository.findOne({ where: { id, companyId } });
    if (!branch) throw AppException.notFound('Filial topilmadi');
    return branch;
  }
}
