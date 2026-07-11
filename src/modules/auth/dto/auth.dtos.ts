import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PHONE_REGEX = /^\+998\d{9}$/;
const PHONE_MESSAGE = 'Telefon raqam +998XXXXXXXXX formatida bo‘lishi kerak';

export class RegisterDto {
  @ApiProperty({ example: 'Olma Market MChJ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  companyName: string;

  @ApiProperty({ example: 'Aziz' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Azizov' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'aziz' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Username faqat lotin harflari, raqam va . _ - belgilaridan iborat bo‘lishi mumkin',
  })
  username: string;

  @ApiProperty({ example: 'aziz@example.com' })
  @IsEmail({}, { message: 'Email manzil noto‘g‘ri' })
  email: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  phone: string;

  @ApiProperty({ example: 'Parol123!' })
  @IsString()
  @MinLength(8, { message: 'Parol kamida 8 belgidan iborat bo‘lishi kerak' })
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @ApiProperty({ description: 'username YOKI email YOKI +998 telefon', example: 'demo' })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({ example: 'Demo123!' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class ResendVerificationDto {
  @ApiProperty({ description: 'username YOKI email YOKI +998 telefon', example: 'aziz@example.com' })
  @IsString()
  @IsNotEmpty()
  identifier: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'aziz' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Username faqat lotin harflari, raqam va . _ - belgilaridan iborat bo‘lishi mumkin',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'aziz@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Email manzil noto‘g‘ri' })
  email?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  phone?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
