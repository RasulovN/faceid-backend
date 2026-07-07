import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dtos';
import { CurrentUser, Permissions, RequestUser } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Kompaniya rollari' })
  async list(@CurrentUser() user: RequestUser) {
    return this.rolesService.list(user.companyId!);
  }

  @Get('permissions')
  @Permissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Permission katalogi (guruhlangan)' })
  getPermissions() {
    return this.rolesService.getPermissionCatalog();
  }

  @Post()
  @Permissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Yangi rol yaratish' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(user.companyId!, dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Rolni tahrirlash' })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(user.companyId!, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Rolni o‘chirish' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.remove(user.companyId!, id);
  }
}
