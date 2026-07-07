import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Public, Roles, SkipAudit } from '../../common/decorators';
import { UserRole } from '../../common/enums';
import {
  CreateVisitDto,
  HeartbeatDto,
  PeriodQueryDto,
  VisitListQueryDto,
} from './dto/site-analytics.dtos';
import { SiteAnalyticsService } from './site-analytics.service';

@ApiTags('site-analytics')
@Controller()
export class SiteAnalyticsController {
  constructor(private readonly analyticsService: SiteAnalyticsService) {}

  // ---------- Landing (public, cookie-rozilikdan keyin) ----------

  @Post('public/site-analytics/visit')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Landing tashrifini qayd etish (faqat rozilik bilan)' })
  async visit(@Body() dto: CreateVisitDto, @Req() req: FastifyRequest) {
    return this.analyticsService.recordVisit(dto, req.ip, req.headers['user-agent']);
  }

  @Post('public/site-analytics/heartbeat')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Sessiya davomiyligini yangilash (har 20s)' })
  async heartbeat(@Body() dto: HeartbeatDto) {
    return this.analyticsService.recordHeartbeat(dto.sessionId);
  }

  // ---------- Superadmin ----------

  @Get('admin/site-analytics/overview')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Yuqori kartalar: tashriflar, unikal mehmonlar, davomiylik' })
  async overview(@Query() query: PeriodQueryDto) {
    return this.analyticsService.overview(query.days);
  }

  @Get('admin/site-analytics/timeseries')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Kunlik tashriflar seriyasi (chart)' })
  async timeseries(@Query() query: PeriodQueryDto) {
    return this.analyticsService.timeseries(query.days);
  }

  @Get('admin/site-analytics/hours')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Soat kesimida taqsimot (0-23)' })
  async hours(@Query() query: PeriodQueryDto) {
    return this.analyticsService.hours(query.days);
  }

  @Get('admin/site-analytics/geo')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Hududlar: davlat/viloyat/shahar kesimida' })
  async geo(@Query() query: PeriodQueryDto) {
    return this.analyticsService.geo(query.days);
  }

  @Get('admin/site-analytics/sources')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Trafik manbalari: referrer va UTM' })
  async sources(@Query() query: PeriodQueryDto) {
    return this.analyticsService.sources(query.days);
  }

  @Get('admin/site-analytics/devices')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Qurilma / brauzer / OT / til taqsimoti' })
  async devices(@Query() query: PeriodQueryDto) {
    return this.analyticsService.devices(query.days);
  }

  @Get('admin/site-analytics/visits')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: "So'nggi tashriflar (IP, hudud, qurilma) — pagination + filtr" })
  async visits(@Query() query: VisitListQueryDto) {
    return this.analyticsService.visits(query);
  }
}
