import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AttendanceService } from './attendance.service';
import { AttendanceExportService } from './attendance-export.service';
import {
  DailyQueryDto,
  EventsQueryDto,
  ExcuseDayDto,
  ExportQueryDto,
  ManualEventDto,
  MonthlyQueryDto,
  StatsQueryDto,
  UpdateEventDto,
} from './dto/attendance.dtos';
import {
  CurrentDevice,
  CurrentUser,
  DeviceAuth,
  Permissions,
  RequestUser,
  Roles,
  SkipAudit,
  SkipEnvelope,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AttendanceEventType, UserRole } from '../../common/enums';
import { Device } from '../../entities/device.entity';
import { DeviceTokenGuard } from '../../common/guards/device-token.guard';
import { AppException } from '../../common/exceptions/app.exception';
import { parseMultipart } from '../../common/utils/multipart.util';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly exportService: AttendanceExportService,
  ) {}

  // ---------- Kiosk ----------

  @Post('kiosk/recognize')
  @DeviceAuth()
  @UseGuards(DeviceTokenGuard)
  @SkipThrottle()
  @SkipAudit()
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'X-Device-Token', required: true })
  @ApiOperation({ summary: 'Kiosk frame → identify → davomat eventi' })
  async kioskRecognize(@CurrentDevice() device: Device, @Req() req: FastifyRequest) {
    const { files } = await parseMultipart(req, { maxFiles: 1, imagesOnly: true });
    if (files.length === 0) throw AppException.validation('`frame` fayli yuborilmagan');
    return this.attendanceService.kioskRecognize(device, files[0].buffer);
  }

  // ---------- Mobile ----------

  @Post('mobile/check')
  @Roles(UserRole.EMPLOYEE)
  @SkipAudit()
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Mobil check-in/out: geofence → mock → burst liveness+verify → event',
    description:
      'Yangi klientlar `frames` nomi bilan 3..8 ta ketma-ket kadr yuboradi ' +
      '(burst: passiv anti-spoof + bosh burilishi challenge). Eski klientlarning ' +
      'bitta `selfie` fayli ham qabul qilinadi (faqat passiv liveness).',
  })
  async mobileCheck(@CurrentUser() user: RequestUser, @Req() req: FastifyRequest) {
    const { files, fields } = await parseMultipart(req, { maxFiles: 8, imagesOnly: true });
    if (files.length === 0) {
      throw AppException.validation('`frames` (yoki `selfie`) fayllari yuborilmagan');
    }
    const latitude = Number(fields.latitude);
    const longitude = Number(fields.longitude);
    const accuracy = Number(fields.accuracy ?? 0);
    const type = fields.type as AttendanceEventType;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw AppException.validation('latitude/longitude noto‘g‘ri');
    }
    if (!Object.values(AttendanceEventType).includes(type)) {
      throw AppException.validation('type CHECK_IN yoki CHECK_OUT bo‘lishi kerak');
    }
    return this.attendanceService.mobileCheck(
      user,
      files.map((f) => f.buffer),
      {
        latitude,
        longitude,
        accuracy,
        isMockLocation: fields.isMockLocation === 'true' || fields.isMockLocation === '1',
        type,
      },
    );
  }

  // ---------- Panel ----------

  @Get('events')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_READ)
  async findEvents(@CurrentUser() user: RequestUser, @Query() query: EventsQueryDto) {
    return this.attendanceService.findEvents(user.companyId!, query);
  }

  @Get('daily')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_READ)
  async daily(@CurrentUser() user: RequestUser, @Query() query: DailyQueryDto) {
    return this.attendanceService.daily(user.companyId!, query);
  }

  @Get('monthly')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_READ)
  async monthly(@CurrentUser() user: RequestUser, @Query() query: MonthlyQueryDto) {
    return this.attendanceService.monthly(user.companyId!, query);
  }

  @Get('stats')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_READ)
  @ApiOperation({ summary: 'Davomat statistikasi (oylik + kunlik: kelgan/kechikkan/kelmagan/sababli)' })
  async stats(@CurrentUser() user: RequestUser, @Query() query: StatsQueryDto) {
    return this.attendanceService.stats(user.companyId!, query);
  }

  @Post('manual')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ApiOperation({ summary: 'Qo‘lda event kiritish (isManual=true, audit bilan)' })
  async createManual(@CurrentUser() user: RequestUser, @Body() dto: ManualEventDto) {
    return this.attendanceService.createManual(user.companyId!, user, dto);
  }

  @Patch('excuse')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ApiOperation({
    summary: 'Kunni sababli (uzrli) qilish yoki ortga qaytarish — jarima/bonusga ta’sir qiladi',
  })
  async setExcused(@CurrentUser() user: RequestUser, @Body() dto: ExcuseDayDto) {
    return this.attendanceService.setExcused(user.companyId!, user, dto);
  }

  @Patch('events/:id')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_MANAGE)
  async updateEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @Req() req: FastifyRequest,
  ) {
    const { oldValue, event } = await this.attendanceService.updateEvent(user.companyId!, id, dto);
    (req as FastifyRequest & { auditOldValue?: unknown }).auditOldValue = oldValue;
    return event;
  }

  @Delete('events/:id')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_MANAGE)
  async deleteEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const { oldValue, ok } = await this.attendanceService.deleteEvent(user.companyId!, id);
    (req as FastifyRequest & { auditOldValue?: unknown }).auditOldValue = oldValue;
    return { ok };
  }

  @Get('export')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.ATTENDANCE_EXPORT)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Oylik davomat hisoboti — xlsx fayl' })
  async exportMonthly(
    @CurrentUser() user: RequestUser,
    @Query() query: ExportQueryDto,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.exportService.exportMonthly(
      user.companyId!,
      query.month,
      query.branchId,
    );
    void reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="attendance-${query.month}.xlsx"`)
      .send(buffer);
  }
}
