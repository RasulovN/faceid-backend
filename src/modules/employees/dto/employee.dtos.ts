import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EmployeeStatus, Gender, SalaryType } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class EmployeeCredentialsDto {
  @ApiPropertyOptional({ description: 'Bo‘sh qoldirilsa ism-familiyadan avto-generatsiya' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username?: string;

  @ApiPropertyOptional({ description: 'Email yoki telefondan kamida bittasi majburiy' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Matches(/^\+998\d{9}$/, { message: 'Telefon +998XXXXXXXXX formatida bo‘lishi kerak' })
  phone?: string;

  @ApiPropertyOptional({ description: 'null bo‘lsa avtogeneratsiya + emailga yuboriladi' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string | null;
}

export class CreateEmployeeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @ApiPropertyOptional({ example: '1995-04-12' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsIn(Object.values(Gender))
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  position?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  department?: string;

  @ApiPropertyOptional({ example: 'T-001', description: 'Bo‘sh qoldirilsa navbatdagi raqam avto-generatsiya' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  tabNumber?: string;

  @ApiProperty()
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  hiredAt?: string;

  @ApiProperty({ enum: SalaryType })
  @IsIn(Object.values(SalaryType))
  salaryType: SalaryType;

  @ApiProperty({ description: 'tiyin', example: 500000000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  salaryAmount: number;

  @ApiProperty({ type: EmployeeCredentialsDto })
  @ValidateNested()
  @Type(() => EmployeeCredentialsDto)
  credentials: EmployeeCredentialsDto;

  @ApiPropertyOptional({ description: 'Individual grafik biriktirish' })
  @IsOptional()
  @IsUUID()
  scheduleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  passportSeries?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['credentials'] as const),
) {}

export class UpdateEmployeeStatusDto {
  @ApiProperty({ enum: EmployeeStatus })
  @IsIn(Object.values(EmployeeStatus))
  status: EmployeeStatus;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  firedAt?: string;
}

export class EmployeeListQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsIn(Object.values(EmployeeStatus))
  status?: EmployeeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;
}

export class EmployeeAttendanceQueryDto {
  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
