import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  AdminCreateUserDto,
  CreateStaffUserDto,
  UpdateUserDto,
  UserListQueryDto,
} from './dto/user.dtos';
import { CurrentUser, Permissions, RequestUser, Roles } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { UserRole } from '../../common/enums';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  @Permissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Kompaniya foydalanuvchilari' })
  async findAll(@CurrentUser() user: RequestUser, @Query() query: UserListQueryDto) {
    return this.usersService.findAll(query, user.companyId!);
  }

  @Post('users')
  @Permissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Yangi panel foydalanuvchisi (custom rol bilan)' })
  async createStaff(@CurrentUser() user: RequestUser, @Body() dto: CreateStaffUserDto) {
    return this.usersService.createStaff(dto, user);
  }

  @Patch('users/:id')
  @Permissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Foydalanuvchi roli / faolligini o‘zgartirish' })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto, user);
  }

  @Get('admin/users')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Barcha foydalanuvchilar (?role=SUPERADMIN)' })
  async adminFindAll(@Query() query: UserListQueryDto) {
    return this.usersService.findAll(query);
  }

  @Post('admin/users')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Foydalanuvchi yaratish (superadmin)' })
  async adminCreate(@Body() dto: AdminCreateUserDto) {
    return this.usersService.adminCreate(dto);
  }
}
