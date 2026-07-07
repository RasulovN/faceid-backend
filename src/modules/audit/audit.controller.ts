import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { CurrentUser, Permissions, RequestUser, Roles } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { UserRole } from '../../common/enums';

@ApiTags('audit')
@ApiBearerAuth()
@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('audit-logs')
  @Permissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Kompaniya audit loglari' })
  async findCompanyLogs(@Query() query: AuditQueryDto, @CurrentUser() user: RequestUser) {
    return this.auditService.findAll(query, user.companyId ?? undefined);
  }

  @Get('admin/audit-logs')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Barcha audit loglar (superadmin)' })
  async findAllLogs(@Query() query: AuditQueryDto) {
    return this.auditService.findAll(query);
  }
}
