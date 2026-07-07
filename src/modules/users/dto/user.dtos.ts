import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const COMPANY_ROLES = [
  UserRole.COMPANY_OWNER,
  UserRole.COMPANY_ADMIN,
  UserRole.BRANCH_MANAGER,
  UserRole.HR,
  UserRole.EMPLOYEE,
];

export class UserListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsIn(Object.values(UserRole))
  role?: UserRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: COMPANY_ROLES })
  @IsOptional()
  @IsIn(COMPANY_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Kompaniya custom roli (roleId)' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateStaffUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+998\d{9}$/)
  phone: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ description: 'Kompaniya custom roli (roleId)' })
  @IsUUID()
  roleId: string;
}

export class AdminCreateUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+998\d{9}$/)
  phone: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ enum: UserRole })
  @IsIn(Object.values(UserRole))
  role: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
