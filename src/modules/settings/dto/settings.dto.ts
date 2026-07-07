import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Barcha maydonlar ixtiyoriy — faqat yuborilganlari yangilanadi. */
export class UpdateSiteSettingsDto {
  @ApiPropertyOptional({ example: 'info@faceid.uz' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+998 71 200 00 00' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contactPhone?: string;

  @ApiPropertyOptional({ example: "Toshkent sh., Amir Temur ko'chasi 108" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  contactAddress?: string;

  @ApiPropertyOptional({ example: 'Du–Ju: 09:00–18:00' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  workingHours?: string;

  @ApiPropertyOptional({ example: 'https://t.me/faceid' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  telegram?: string;

  @ApiPropertyOptional({ example: 'https://instagram.com/faceid' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  instagram?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  facebook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  youtube?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  linkedin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  twitter?: string;
}
