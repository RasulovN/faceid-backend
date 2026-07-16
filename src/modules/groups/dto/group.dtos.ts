import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class LessonDayDto {
  @ApiProperty({ description: '1..7 (Dushanba=1)', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ example: '14:00' })
  @Matches(TIME_REGEX, { message: 'startTime HH:mm formatida bo‘lishi kerak' })
  startTime: string;

  @ApiProperty({ example: '16:00' })
  @Matches(TIME_REGEX, { message: 'endTime HH:mm formatida bo‘lishi kerak' })
  endTime: string;
}

export class CreateGroupDto {
  @ApiProperty({ example: 'Ingliz tili B2 — kechki' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ description: 'Guruh o‘tadigan filial' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ description: 'O‘qituvchi (personType=EMPLOYEE xodim)' })
  @IsOptional()
  @IsUUID()
  teacherId?: string | null;

  @ApiProperty({ type: [LessonDayDto], description: 'Dars jadvali' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LessonDayDto)
  days: LessonDayDto[];

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  gracePeriodMinutes?: number;

  @ApiPropertyOptional({ default: 20, description: 'Shu daqiqadan keyin "kelmadi" xabari' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(180)
  absentAfterMinutes?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class UpdateGroupDto extends PartialType(CreateGroupDto) {}

export class GroupListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'true → arxivlanganlar ham chiqadi' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;
}

export class AddGroupStudentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  studentIds: string[];
}

export class JournalQueryDto {
  @ApiProperty({ example: '2026-07' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month YYYY-MM formatida bo‘lishi kerak' })
  month: string;
}
