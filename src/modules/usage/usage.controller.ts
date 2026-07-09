import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators';
import { UserRole } from '../../common/enums';
import { UsagePeriodQueryDto } from './dto/usage.dtos';
import { UsageService } from './usage.service';

@ApiTags('usage')
@ApiBearerAuth()
@Controller()
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('admin/usage/overview')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Foydalanish: umumiy KPI + kunlik seriya (davr kesimida)' })
  async overview(@Query() query: UsagePeriodQueryDto) {
    return this.usageService.overview(query.days);
  }

  @Get('admin/usage/companies')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Foydalanish: kompaniyalar kesimi (faollik bali, churn xavfi)' })
  async companies(@Query() query: UsagePeriodQueryDto) {
    return this.usageService.companies(query.days);
  }

  @Get('admin/usage/companies/:id')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Foydalanish: bitta kompaniya (seriya, top foydalanuvchilar, modullar)' })
  async companyDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: UsagePeriodQueryDto,
  ) {
    return this.usageService.companyDetail(id, query.days);
  }
}
