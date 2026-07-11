import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AttendanceEventType, AttendanceSource } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Qo'lda rejim 2-bosqich: tanilgan xodim uchun yo'nalish tasdiqlash */
export class KioskConfirmDto {
  @ApiProperty({ enum: AttendanceEventType })
  @IsIn(Object.values(AttendanceEventType))
  direction: AttendanceEventType;
}

export class EventsQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: AttendanceEventType })
  @IsOptional()
  @IsIn(Object.values(AttendanceEventType))
  type?: AttendanceEventType;

  @ApiPropertyOptional({ enum: AttendanceSource })
  @IsOptional()
  @IsIn(Object.values(AttendanceSource))
  source?: AttendanceSource;
}

export class DailyQueryDto {
  @ApiProperty({ example: '2026-07-06' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class MonthlyQueryDto {
  @ApiProperty({ example: '2026-07' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month YYYY-MM formatida bo‘lishi kerak' })
  month: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

/** Davomat statistikasi — oylik + tanlangan kunlik kesim. */
export class StatsQueryDto {
  @ApiProperty({ example: '2026-07' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month YYYY-MM formatida bo‘lishi kerak' })
  month: string;

  @ApiProperty({ example: '2026-07-06' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date YYYY-MM-DD formatida bo‘lishi kerak' })
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ManualEventDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ enum: AttendanceEventType })
  @IsIn(Object.values(AttendanceEventType))
  type: AttendanceEventType;

  @ApiProperty({ example: '2026-07-06T09:00:00.000Z' })
  @IsDateString()
  timestamp: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;
}

/** Biror kunni "sababli" (uzrli) qilib belgilash / ortga qaytarish. */
export class ExcuseDayDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: '2026-07-06', description: 'Sana (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date YYYY-MM-DD formatida bo‘lishi kerak' })
  date: string;

  @ApiProperty({ description: 'true — sababli, false — sababsizga qaytarish' })
  @IsBoolean()
  isExcused: boolean;

  @ApiPropertyOptional({ description: 'Sababli qilishda izoh (majburiy)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateEventDto {
  @ApiPropertyOptional({ enum: AttendanceEventType })
  @IsOptional()
  @IsIn(Object.values(AttendanceEventType))
  type?: AttendanceEventType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class ExportQueryDto extends MonthlyQueryDto {}
