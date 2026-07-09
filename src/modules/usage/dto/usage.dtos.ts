import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Usage agregatlari uchun davr (kunlarda) */
export class UsagePeriodQueryDto {
  @ApiPropertyOptional({ default: 30, description: 'Davr: 7 | 30 | 90 kun' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}
