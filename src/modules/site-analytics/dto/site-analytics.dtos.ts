import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Landing'dan keladigan tashrif ma'lumoti (faqat cookie-rozilikdan keyin) */
export class CreateVisitDto {
  @ApiProperty({ description: 'Anonim mehmon ID (365 kunlik cookie)' })
  @IsString()
  @Length(8, 64)
  visitorId: string;

  @ApiProperty({ description: 'Brauzer sessiyasi ID (sessionStorage)' })
  @IsString()
  @Length(8, 64)
  sessionId: string;

  @ApiProperty({ example: '/' })
  @IsString()
  @MaxLength(255)
  path: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  referrer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmMedium?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmCampaign?: string;

  @ApiPropertyOptional({ example: 'uz' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  screenWidth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  screenHeight?: number;

  @ApiPropertyOptional({ description: 'visitorId shu tashrif uchun yangi yaratildimi' })
  @IsOptional()
  @IsBoolean()
  firstVisit?: boolean;
}

export class HeartbeatDto {
  @ApiProperty()
  @IsString()
  @Length(8, 64)
  sessionId: string;
}

/** Admin agregatlari uchun davr (kunlarda) */
export class PeriodQueryDto {
  @ApiPropertyOptional({ default: 30, description: 'Davr: 7 | 30 | 90 kun' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}

export class VisitListQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ enum: ['DESKTOP', 'MOBILE', 'TABLET'] })
  @IsOptional()
  @IsIn(['DESKTOP', 'MOBILE', 'TABLET'])
  deviceType?: string;
}
