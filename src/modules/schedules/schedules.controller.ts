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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dtos';
import { CurrentUser, Permissions, RequestUser } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('schedules')
@ApiBearerAuth()
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Get()
  @Permissions(PERMISSIONS.SCHEDULES_READ)
  async findAll(@CurrentUser() user: RequestUser, @Query() query: PaginationDto) {
    return this.schedulesService.findAll(user.companyId!, query);
  }

  @Post()
  @Permissions(PERMISSIONS.SCHEDULES_MANAGE)
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateScheduleDto) {
    return this.schedulesService.create(user.companyId!, dto);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.SCHEDULES_READ)
  async findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedulesService.findOne(user.companyId!, id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.SCHEDULES_MANAGE)
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedulesService.update(user.companyId!, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.SCHEDULES_MANAGE)
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedulesService.remove(user.companyId!, id);
  }
}
