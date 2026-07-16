import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Device } from '../../entities/device.entity';
import { Employee } from '../../entities/employee.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/constants/error-codes';
import { EmployeeStatus, PersonType } from '../../common/enums';

export type LimitKind = 'branch' | 'employee' | 'device';

const KIND_LABEL: Record<LimitKind, string> = {
  branch: 'filial',
  employee: 'xodim',
  device: 'qurilma',
};

/** Filial/xodim/qurilma yaratishda tarif limitini tekshiradi */
@Injectable()
export class TariffLimitsService {
  constructor(
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
  ) {}

  /** Joriy foydalanish (faol filial/xodim/qurilma soni) */
  async getUsage(
    companyId: string,
  ): Promise<{ branches: number; employees: number; devices: number }> {
    const [branches, employees, devices] = await Promise.all([
      this.branchRepository.count({ where: { companyId } }),
      this.employeeRepository.count({
        // O'quvchilar (STUDENT) tarif limitiga kirmaydi
        where: {
          companyId,
          status: Not(EmployeeStatus.FIRED),
          personType: PersonType.EMPLOYEE,
          deletedAt: IsNull(),
        },
      }),
      this.deviceRepository.count({ where: { companyId } }),
    ]);
    return { branches, employees, devices };
  }

  /**
   * Kompaniya uchun tarif bo'yicha effektiv MAKS limit.
   * Custom tarif + customLimits bo'lsa — o'sha konfiguratsiya, aks holda tarif.max*.
   */
  effectiveMax(company: Company, kind: LimitKind): number {
    const tariff = company.tariff!;
    const custom = tariff.isCustom ? company.customLimits : null;
    switch (kind) {
      case 'branch':
        return custom ? custom.branches : tariff.maxBranches;
      case 'employee':
        return custom ? custom.employees : tariff.maxEmployees;
      case 'device':
        return custom ? custom.devices : tariff.maxDevices;
    }
  }

  /** Har bir tur uchun joriy foydalanish + effektiv limit (UI ko'rsatishi uchun). */
  async getUsageAndLimits(companyId: string): Promise<{
    branches: { used: number; limit: number };
    employees: { used: number; limit: number };
    devices: { used: number; limit: number };
    tariffName: string | null;
    isCustom: boolean;
  }> {
    const [company, usage] = await Promise.all([
      this.companyRepository.findOne({ where: { id: companyId }, relations: { tariff: true } }),
      this.getUsage(companyId),
    ]);
    if (!company?.tariff) {
      return {
        branches: { used: usage.branches, limit: 0 },
        employees: { used: usage.employees, limit: 0 },
        devices: { used: usage.devices, limit: 0 },
        tariffName: null,
        isCustom: false,
      };
    }
    return {
      branches: { used: usage.branches, limit: this.effectiveMax(company, 'branch') },
      employees: { used: usage.employees, limit: this.effectiveMax(company, 'employee') },
      devices: { used: usage.devices, limit: this.effectiveMax(company, 'device') },
      tariffName: company.tariff.name,
      isCustom: company.tariff.isCustom,
    };
  }

  async assertCanCreate(companyId: string, kind: LimitKind): Promise<void> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: { tariff: true },
    });
    if (!company) throw AppException.notFound('Kompaniya topilmadi');
    if (!company.tariff) {
      throw new AppException(
        ErrorCodes.TARIFF_LIMIT_EXCEEDED,
        'Kompaniyada faol tarif yo‘q. Avval tarifga obuna bo‘ling.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const [current, max] = await this.countAndLimit(companyId, kind, company);
    if (current >= max) {
      throw new AppException(
        ErrorCodes.TARIFF_LIMIT_EXCEEDED,
        `"${company.tariff.name}" tarifida maksimal ${max} ta ${KIND_LABEL[kind]} mumkin. ` +
          `Hozir ${current} ta mavjud — limitni oshirish uchun tarifni yangilang.`,
        HttpStatus.PAYMENT_REQUIRED,
        { kind, current, max },
      );
    }
  }

  private async countAndLimit(
    companyId: string,
    kind: LimitKind,
    company: Company,
  ): Promise<[number, number]> {
    const max = this.effectiveMax(company, kind);
    switch (kind) {
      case 'branch':
        return [await this.branchRepository.count({ where: { companyId } }), max];
      case 'employee':
        return [
          await this.employeeRepository.count({
            where: {
              companyId,
              status: Not(EmployeeStatus.FIRED),
              personType: PersonType.EMPLOYEE,
              deletedAt: IsNull(),
            },
          }),
          max,
        ];
      case 'device':
        return [await this.deviceRepository.count({ where: { companyId } }), max];
    }
  }
}
