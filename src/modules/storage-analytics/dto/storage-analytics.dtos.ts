import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Jadval statistikasi ro'yxati: search = jadval nomi bo'yicha */
export class TableListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Aniq jadval nomi bo‘yicha filtr' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tableName?: string;
}

/** Model (entity) statistikasi ro'yxati */
export class ModelListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Entity nomi bo‘yicha filtr (masalan: Employee)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  entityName?: string;
}

/** Kompaniya foydalanishi ro'yxati */
export class CompanyStorageQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Bitta kompaniya bo‘yicha filtr' })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

/** Growth analytics davri */
export class GrowthQueryDto {
  @ApiPropertyOptional({ description: 'Boshlanish sanasi (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Tugash sanasi (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

export const EXPORT_REPORTS = ['tables', 'companies', 'models', 'logs', 'recommendations'] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];

export const EXPORT_FORMATS = ['xlsx', 'csv', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Export so'rovi: qaysi hisobot va qaysi formatda */
export class StorageExportQueryDto {
  @ApiPropertyOptional({ enum: EXPORT_REPORTS, default: 'tables' })
  @IsOptional()
  @IsIn(EXPORT_REPORTS)
  report: ExportReport = 'tables';

  @ApiPropertyOptional({ enum: EXPORT_FORMATS, default: 'xlsx' })
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format: ExportFormat = 'xlsx';
}
