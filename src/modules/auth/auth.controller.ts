import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/auth.dtos';
import { CurrentUser, Public, RequestUser, SkipAudit } from '../../common/decorators';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Kompaniya + owner ro‘yxatdan o‘tkazish' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Kirish (identifier: username | email | +998 telefon)' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Token yangilash (rotation)' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @SkipAudit()
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Chiqish — refresh sessiyani bekor qilish' })
  async logout(@CurrentUser() user: RequestUser) {
    return this.authService.logout(user.id);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Joriy foydalanuvchi (+ employee, company)' })
  async me(@CurrentUser() user: RequestUser) {
    return this.authService.me(user.id);
  }

  @Post('verify-email')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Email tasdiqlash' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Email tasdiqlash havolasini qayta yuborish' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Post('forgot-password')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Parol tiklash havolasini yuborish' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Yangi parol o‘rnatish (token bilan)' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'O‘z profilini yangilash (username/email/telefon)' })
  async updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Patch('change-password')
  @SkipAudit()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Parolni o‘zgartirish' })
  async changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }
}
