import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CompanyStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class UpdateCompanyProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Matches(/^\+998\d{9}$/, { message: 'Telefon +998XXXXXXXXX formatida bo‘lishi kerak' })
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  address?: string;

  @ApiPropertyOptional({ example: 'Asia/Tashkent' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class AdminUpdateCompanyDto extends UpdateCompanyProfileDto {}

export class UpdateCompanyStatusDto {
  @ApiProperty({ enum: [CompanyStatus.ACTIVE, CompanyStatus.SUSPENDED] })
  @IsIn([CompanyStatus.ACTIVE, CompanyStatus.SUSPENDED])
  status: CompanyStatus.ACTIVE | CompanyStatus.SUSPENDED;
}

export class CompanyListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CompanyStatus })
  @IsOptional()
  @IsIn(Object.values(CompanyStatus))
  status?: CompanyStatus;
}
