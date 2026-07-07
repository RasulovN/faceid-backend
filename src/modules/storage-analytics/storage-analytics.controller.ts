import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Roles, SkipEnvelope } from '../../common/decorators';
import { UserRole } from '../../common/enums';
import {
  CompanyStorageQueryDto,
  GrowthQueryDto,
  ModelListQueryDto,
  StorageExportQueryDto,
  TableListQueryDto,
} from './dto/storage-analytics.dtos';
import { StorageAnalyticsService } from './storage-analytics.service';
import { EXPORT_CONTENT_TYPES, StorageExportService } from './storage-export.service';

/**
 * Super Admin — Storage Analytics & Database Monitoring.
 * Barcha endpointlar faqat SUPERADMIN uchun (global guardlar: JWT → Roles).
 */
@ApiTags('storage-analytics')
@ApiBearerAuth()
@Roles(UserRole.SUPERADMIN)
@Controller('admin/storage')
export class StorageAnalyticsController {
  constructor(
    private readonly analyticsService: StorageAnalyticsService,
    private readonly exportService: StorageExportService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Storage dashboard: kartalar, chartlar, alert' })
  async dashboard() {
    return this.analyticsService.dashboard();
  }

  @Get('database')
  @ApiOperation({ summary: 'Baza darajasidagi statistika (pg_stat_database)' })
  async database() {
    return this.analyticsService.database();
  }

  @Get('tables')
  @ApiOperation({ summary: 'Jadvallar statistikasi (pagination, search, sort)' })
  async tables(@Query() query: TableListQueryDto) {
    return this.analyticsService.tables(query);
  }

  @Get('models')
  @ApiOperation({ summary: 'Entity (model) statistikasi va o‘sish dinamikasi' })
  async models(@Query() query: ModelListQueryDto) {
    return this.analyticsService.models(query);
  }

  @Get('companies')
  @ApiOperation({ summary: 'Kompaniya kesimida saqlash hajmi (taxminiy)' })
  async companies(@Query() query: CompanyStorageQueryDto) {
    return this.analyticsService.companies(query);
  }

  @Get('companies/:id')
  @ApiOperation({ summary: 'Kompaniya storage detali: timeline, jadvallar, top userlar' })
  async companyDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.analyticsService.companyDetail(id);
  }

  @Get('growth')
  @ApiOperation({ summary: 'Growth analytics: bugun/hafta/oy/yil o‘sishi (snapshotlardan)' })
  async growth(@Query() query: GrowthQueryDto) {
    return this.analyticsService.growth(query);
  }

  @Get('images')
  @ApiOperation({ summary: 'Rasm statistikasi (URL ustunlari, fayllar MinIO’da)' })
  async images() {
    return this.analyticsService.images();
  }

  @Get('files')
  @ApiOperation({ summary: 'Fayl kengaytmalari kesimida statistika' })
  async files() {
    return this.analyticsService.files();
  }

  @Get('logs')
  @ApiOperation({ summary: 'Log jadvallari: qatorlar, hajm, o‘sish' })
  async logs() {
    return this.analyticsService.logs();
  }

  @Get('ranking')
  @ApiOperation({ summary: 'Eng katta kompaniyalar va jadvallar reytingi' })
  async ranking() {
    return this.analyticsService.ranking();
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'Tozalash tavsiyalari va taxminiy tejash' })
  async recommendations() {
    return this.analyticsService.recommendations();
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Joriy storage alert darajasi (80/90/95%)' })
  async alerts() {
    return this.analyticsService.alerts();
  }

  @Get('chart/database')
  @ApiOperation({ summary: 'Oylik baza hajmi dinamikasi (line chart)' })
  async chartDatabase() {
    return this.analyticsService.chartDatabase();
  }

  @Get('chart/company')
  @ApiOperation({ summary: 'Kompaniya taqsimoti (pie chart)' })
  async chartCompanies() {
    return this.analyticsService.chartCompanies();
  }

  @Get('chart/growth')
  @ApiOperation({ summary: 'Kunlik o‘sish (area chart)' })
  async chartGrowth() {
    return this.analyticsService.chartGrowth();
  }

  @Get('export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Hisobotni Excel/CSV/PDF ga eksport qilish' })
  async export(@Query() query: StorageExportQueryDto, @Res() reply: FastifyReply) {
    const buffer = await this.exportService.export(query.report, query.format);
    void reply
      .header('Content-Type', EXPORT_CONTENT_TYPES[query.format])
      .header(
        'Content-Disposition',
        `attachment; filename="${this.exportService.buildFileName(query.report, query.format)}"`,
      )
      .send(buffer);
  }
}
