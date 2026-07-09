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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Public, Roles, SkipAudit } from '../../common/decorators';
import { UserRole } from '../../common/enums';
import {
  CreateMobileLogDto,
  MobileLogListQueryDto,
  UpdateMobileLogStatusDto,
} from './dto/mobile-logs.dtos';
import { MobileLogsService } from './mobile-logs.service';

@ApiTags('mobile-logs')
@Controller()
export class MobileLogsController {
  constructor(private readonly logsService: MobileLogsService) {}

  // ---------- Mobil ilova (public — crash login'dan oldin ham bo'ladi) ----------

  @Post('public/mobile-logs')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Mobil ilova xatosini qayd etish' })
  async record(@Body() dto: CreateMobileLogDto, @Req() req: FastifyRequest) {
    return this.logsService.record(dto, req.ip);
  }

  // ---------- Superadmin ----------

  @Get('admin/mobile-logs')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: "Mobil xatolar ro'yxati — pagination + filtrlar" })
  async list(@Query() query: MobileLogListQueryDto) {
    return this.logsService.list(query);
  }

  @Get('admin/mobile-logs/stats')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Yuqori kartalar: yangi, bugungi, fatal, hafta' })
  async stats() {
    return this.logsService.stats();
  }

  @Patch('admin/mobile-logs/:id/status')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Log holatini belgilash (NEW | RESOLVED)' })
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMobileLogStatusDto,
  ) {
    return this.logsService.setStatus(id, dto.status);
  }

  @Delete('admin/mobile-logs/resolved')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: "Ko'rib chiqilgan (RESOLVED) loglarni tozalash" })
  async clearResolved() {
    return this.logsService.clearResolved();
  }

  @Delete('admin/mobile-logs/:id')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: "Logni o'chirish" })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.logsService.remove(id);
    return { deleted: true };
  }
}
