import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ParentPortalOverviewDto {
  @ApiProperty({ description: 'Telegram Mini App initData (xom querystring)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  initData: string;

  @ApiPropertyOptional({ example: '2026-07' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month YYYY-MM formatida bo‘lishi kerak' })
  month?: string;
}
