import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTariffDto {
  @ApiProperty({ example: 'Business' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Oylik narx, tiyin', example: 49900000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceMonthly: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Custom (moslashtiriladigan) tarif — narx miqdorga qarab dinamik',
  })
  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;

  @ApiPropertyOptional({ description: 'Custom: bazaviy narx, tiyin', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional({ description: 'Custom: har filial narxi, tiyin', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerBranch?: number;

  @ApiPropertyOptional({ description: 'Custom: har xodim narxi, tiyin', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerEmployee?: number;

  @ApiPropertyOptional({ description: 'Custom: har qurilma narxi, tiyin', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerDevice?: number;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxBranches: number;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxEmployees: number;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDevices: number;

  @ApiPropertyOptional({ default: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  historyRetentionDays?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateTariffDto extends PartialType(CreateTariffDto) {}
