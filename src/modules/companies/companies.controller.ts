import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { TariffLimitsService } from '../tariffs/tariff-limits.service';
import {
  AdminUpdateCompanyDto,
  CompanyListQueryDto,
  UpdateCompanyProfileDto,
  UpdateCompanyStatusDto,
} from './dto/company.dtos';
import { CurrentUser, Permissions, RequestUser, Roles } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { UserRole } from '../../common/enums';

@ApiTags('companies')
@ApiBearerAuth()
@Controller()
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly tariffLimits: TariffLimitsService,
  ) {}

  // ---------- Superadmin ----------

  @Get('admin/companies')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Barcha kompaniyalar (filter: status)' })
  async findAll(@Query() query: CompanyListQueryDto) {
    return this.companiesService.findAll(query);
  }

  @Get('admin/companies/:id')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Kompaniya to‘liq (tarif, obuna, statistika)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.findOneFull(id);
  }

  @Patch('admin/companies/:id')
  @Roles(UserRole.SUPERADMIN)
  async adminUpdate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateCompanyDto) {
    return this.companiesService.adminUpdate(id, dto);
  }

  @Patch('admin/companies/:id/status')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Kompaniya statusini o‘zgartirish (ACTIVE|SUSPENDED)' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyStatusDto) {
    return this.companiesService.updateStatus(id, dto);
  }

  @Get('admin/companies/:id/stats')
  @Roles(UserRole.SUPERADMIN)
  async stats(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.stats(id);
  }

  // ---------- Kompaniya profili ----------

  @Get('company/profile')
  @Permissions(PERMISSIONS.COMPANY_READ)
  async getProfile(@CurrentUser() user: RequestUser) {
    return this.companiesService.getProfile(user.companyId!);
  }

  @Patch('company/profile')
  @Permissions(PERMISSIONS.COMPANY_UPDATE)
  async updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateCompanyProfileDto) {
    return this.companiesService.updateProfile(user.companyId!, dto);
  }

  /** Joriy tarif bo'yicha filial/xodim/qurilma foydalanishi va limitlari (UI uchun). */
  @Get('company/limits')
  @Permissions(PERMISSIONS.COMPANY_READ)
  @ApiOperation({ summary: 'Joriy tarif limitlari va foydalanish' })
  async limits(@CurrentUser() user: RequestUser) {
    return this.tariffLimits.getUsageAndLimits(user.companyId!);
  }
}
