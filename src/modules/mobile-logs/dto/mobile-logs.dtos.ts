import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Mobil ilovadan keladigan xatolik yozuvi (public, authsiz — crash login'dan oldin ham bo'ladi) */
export class CreateMobileLogDto {
  @ApiProperty({ description: 'Xato matni (Error.message)' })
  @IsString()
  @MaxLength(4000)
  message: string;

  @ApiPropertyOptional({ description: 'Stack trace' })
  @IsOptional()
  @IsString()
  @MaxLength(16000)
  stack?: string;

  @ApiPropertyOptional({ description: 'Ilovani qulatgan xatomi (default true)' })
  @IsOptional()
  @IsBoolean()
  isFatal?: boolean;

  @ApiProperty({ enum: ['android', 'ios'] })
  @IsIn(['android', 'ios'])
  platform: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  osVersion?: string;

  @ApiPropertyOptional({ example: 'POCO X6 Pro 5G' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @ApiPropertyOptional({ description: 'Xato yuz bergan ekran (router yo\'li)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  route?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Qo\'shimcha kontekst (componentStack va h.k.)' })
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Xato qurilmada yuz bergan vaqt (offline navbat uchun)' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

export class MobileLogListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['android', 'ios'] })
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;

  @ApiPropertyOptional({ enum: ['NEW', 'RESOLVED'] })
  @IsOptional()
  @IsIn(['NEW', 'RESOLVED'])
  status?: string;

  @ApiPropertyOptional({ description: 'true — faqat fatal, false — faqat ushlangan' })
  @IsOptional()
  // DIQQAT: Type(() => Boolean) "false" satrini true qiladi — qo'lda aylantiramiz
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined))
  @IsBoolean()
  isFatal?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

export class UpdateMobileLogStatusDto {
  @ApiProperty({ enum: ['NEW', 'RESOLVED'] })
  @IsIn(['NEW', 'RESOLVED'])
  status: string;
}
