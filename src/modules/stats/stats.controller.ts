import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { CurrentUser, Permissions, RequestUser, Roles } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { UserRole } from '../../common/enums';

@ApiTags('stats')
@ApiBearerAuth()
@Controller()
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('stats/dashboard')
  @Permissions(PERMISSIONS.STATS_READ)
  @ApiOperation({ summary: 'Kompaniya dashboard statistikasi' })
  async companyDashboard(@CurrentUser() user: RequestUser) {
    return this.statsService.companyDashboard(user.companyId!);
  }

  @Get('admin/stats/dashboard')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Superadmin dashboard: MRR, kompaniyalar, daromad' })
  async adminDashboard() {
    return this.statsService.adminDashboard();
  }
}
