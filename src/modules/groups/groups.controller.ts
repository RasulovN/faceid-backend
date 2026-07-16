import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import {
  AddGroupStudentsDto,
  CreateGroupDto,
  GroupListQueryDto,
  JournalQueryDto,
  UpdateGroupDto,
} from './dto/group.dtos';
import { CurrentUser, Permissions, RequestUser } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';

/**
 * EDUCATION vertikali: o'quv guruhlari. Ruxsatlar xodimlar bilan bir xil
 * (employees.*) — guruh/o'quvchi boshqaruvi bitta mas'uliyat sohasi.
 */
@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @Permissions(PERMISSIONS.EMPLOYEES_READ)
  async findAll(@CurrentUser() user: RequestUser, @Query() query: GroupListQueryDto) {
    return this.groupsService.findAll(user.companyId!, query);
  }

  @Post()
  @Permissions(PERMISSIONS.EMPLOYEES_CREATE)
  @ApiOperation({ summary: 'Guruh yaratish (nom, filial, o‘qituvchi, dars jadvali)' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user.companyId!, dto);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.EMPLOYEES_READ)
  async findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.findOne(user.companyId!, id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.EMPLOYEES_UPDATE)
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(user.companyId!, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.EMPLOYEES_DELETE)
  @ApiOperation({ summary: 'Guruhni o‘chirish — eventlardagi groupId NULL bo‘ladi' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.remove(user.companyId!, id);
  }

  @Post(':id/students')
  @Permissions(PERMISSIONS.EMPLOYEES_UPDATE)
  @ApiOperation({ summary: 'Guruhga o‘quvchilar qo‘shish (mavjudlari e‘tiborsiz qoldiriladi)' })
  async addStudents(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddGroupStudentsDto,
  ) {
    return this.groupsService.addStudents(user.companyId!, id, dto);
  }

  @Delete(':id/students/:studentId')
  @Permissions(PERMISSIONS.EMPLOYEES_UPDATE)
  async removeStudent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.groupsService.removeStudent(user.companyId!, id, studentId);
  }

  @Get(':id/journal')
  @Permissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({
    summary:
      'Oylik davomat jurnali: dars kunlari × o‘quvchilar, PRESENT/LATE/ABSENT belgilar',
  })
  async journal(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: JournalQueryDto,
  ) {
    return this.groupsService.journal(user.companyId!, id, query.month);
  }
}
