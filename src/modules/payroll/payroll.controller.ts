import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { FastifyReply } from 'fastify';
import { PayrollListQuery, PayrollService } from './payroll.service';
import { PayrollExportService } from './payroll-export.service';
import { CurrentUser, Permissions, RequestUser, SkipEnvelope } from '../../common/decorators';
import { PERMISSIONS, userHasPermission } from '../../common/constants/permissions';
import { PayrollAdjustmentType, PayrollStatus, UserRole } from '../../common/enums';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

class PayrollQueryDto extends PaginationDto implements PayrollListQuery {
  @ApiPropertyOptional({ example: '2026-06' })
  @IsOptional()
  @Matches(MONTH_REGEX)
  month?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: PayrollStatus })
  @IsOptional()
  @IsIn(Object.values(PayrollStatus))
  status?: PayrollStatus;
}

class GenerateDto {
  @ApiProperty({ example: '2026-06' })
  @Matches(MONTH_REGEX, { message: 'month YYYY-MM formatida bo‘lishi kerak' })
  month: string;
}

class SummaryQueryDto {
  @ApiProperty({ example: '2026-06' })
  @Matches(MONTH_REGEX)
  month: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

class AdjustmentsQueryDto {
  @ApiProperty({ example: '2026-06' })
  @Matches(MONTH_REGEX)
  month: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

class CreateAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: '2026-06' })
  @Matches(MONTH_REGEX)
  periodMonth: string;

  @ApiProperty({ enum: PayrollAdjustmentType })
  @IsIn(Object.values(PayrollAdjustmentType))
  type: PayrollAdjustmentType;

  @ApiProperty({ description: 'Summa, tiyin (musbat)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class ExportQueryDto {
  @ApiProperty({ example: '2026-06' })
  @Matches(MONTH_REGEX)
  month: string;

  /** Vergul bilan ajratilgan yozuv id'lari. Berilса faqat shular eksport qilinadi. */
  @ApiPropertyOptional({ example: 'uuid1,uuid2' })
  @IsOptional()
  @IsString()
  ids?: string;

  /** Berilса faqat shu filial xodimlari eksport qilinadi. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;
}

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payrollService: PayrollService,
    private readonly exportService: PayrollExportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Oylik yozuvlari; EMPLOYEE roli faqat o‘z recordlarini oladi' })
  async findAll(@CurrentUser() user: RequestUser, @Query() query: PayrollQueryDto) {
    if (user.role === UserRole.EMPLOYEE) {
      return this.payrollService.findAll(user.companyId!, query, user.id);
    }
    if (!userHasPermission(user, PERMISSIONS.PAYROLL_READ)) {
      throw AppException.forbidden('Sizda payroll.read ruxsati yo‘q');
    }
    return this.payrollService.findAll(user.companyId!, query);
  }

  @Post('generate')
  @Permissions(PERMISSIONS.PAYROLL_GENERATE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Oy uchun qo‘lda qayta generatsiya (DRAFT)' })
  async generate(@CurrentUser() user: RequestUser, @Body() dto: GenerateDto) {
    const generated = await this.payrollService.generateForCompany(
      user.companyId!,
      dto.month,
      user.id,
    );
    return { month: dto.month, generated };
  }

  @Post('preview')
  @Permissions(PERMISSIONS.PAYROLL_GENERATE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Oy hisobini saqlamasdan ko‘rish (yopishdan oldingi preview)' })
  async preview(@CurrentUser() user: RequestUser, @Body() dto: GenerateDto) {
    return this.payrollService.previewForCompany(user.companyId!, dto.month);
  }

  @Get('summary')
  @Permissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Oy bo‘yicha dashboard statistikasi (kartalar + trendlar)' })
  async summary(@CurrentUser() user: RequestUser, @Query() query: SummaryQueryDto) {
    return this.payrollService.summary(user.companyId!, query.month, query.branchId);
  }

  // ---------- Tuzatishlar (avans / qarz / ushlanma / mukofot) ----------

  @Get('adjustments')
  @Permissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Oy bo‘yicha tuzatishlar ro‘yxati' })
  async listAdjustments(@CurrentUser() user: RequestUser, @Query() query: AdjustmentsQueryDto) {
    return this.payrollService.listAdjustments(user.companyId!, query.month, query.employeeId);
  }

  @Post('adjustments')
  @Permissions(PERMISSIONS.PAYROLL_GENERATE)
  @ApiOperation({ summary: 'Tuzatish qo‘shish (keyin oyni qayta generatsiya qiling)' })
  async createAdjustment(@CurrentUser() user: RequestUser, @Body() dto: CreateAdjustmentDto) {
    return this.payrollService.createAdjustment(user.companyId!, user.id, dto);
  }

  @Delete('adjustments/:id')
  @Permissions(PERMISSIONS.PAYROLL_GENERATE)
  async removeAdjustment(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payrollService.removeAdjustment(user.companyId!, id);
  }

  @Get('export')
  @Permissions(PERMISSIONS.PAYROLL_EXPORT)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Oylik hisob-kitob — xlsx' })
  async exportMonthly(
    @CurrentUser() user: RequestUser,
    @Query() query: ExportQueryDto,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.exportService.exportMonthly(
      user.companyId!,
      query.month,
      query.ids,
      query.branchId,
    );
    void reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="payroll-${query.month}.xlsx"`)
      .send(buffer);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Bitta yozuv — to‘liq breakdown bilan' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payrollService.findOne(user.companyId!, id);
  }

  @Post(':id/approve')
  @Permissions(PERMISSIONS.PAYROLL_APPROVE)
  @HttpCode(200)
  async approve(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payrollService.approve(user.companyId!, id, user.id);
  }

  @Post(':id/mark-paid')
  @Permissions(PERMISSIONS.PAYROLL_APPROVE)
  @HttpCode(200)
  async markPaid(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payrollService.markPaid(user.companyId!, id);
  }
}
