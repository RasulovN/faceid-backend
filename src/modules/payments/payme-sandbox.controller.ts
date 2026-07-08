import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';
import { Public, SkipAudit, SkipSubscriptionCheck } from '../../common/decorators';
import { PaymeSandboxService } from './payme-sandbox.service';

class SandboxSessionDto {
  @ApiProperty({ description: 'Checkout havolasidagi base64 parametrlar qismi' })
  @IsString()
  @MaxLength(4096)
  params: string;
}

class SandboxCardDto {
  @ApiProperty()
  @IsString()
  @Length(32, 32)
  token: string;

  @ApiProperty({ example: '8600 4954 7331 6478' })
  @IsString()
  @MaxLength(32)
  card: string;

  @ApiProperty({ example: '03/99' })
  @IsString()
  @MaxLength(8)
  expire: string;
}

class SandboxConfirmDto {
  @ApiProperty()
  @IsString()
  @Length(32, 32)
  token: string;

  @ApiProperty({ example: '666666' })
  @IsString()
  @MaxLength(8)
  code: string;
}

class SandboxCancelDto {
  @ApiProperty()
  @IsString()
  @Length(32, 32)
  token: string;
}

/**
 * Payme checkout SANDBOX endpointlari — client'dagi /payme sahifasi ishlatadi.
 * Barchasi @Public (Payme checkout ham auth talab qilmaydi) va faqat
 * PAYME_TEST_MODE=1 + PAYME_LOCAL_CHECKOUT=1 bo'lganda ochiq (aks holda 404).
 * Karta ma'lumotlari audit-logga yozilmaydi (@SkipAudit).
 */
@ApiTags('payme-sandbox')
@Controller('payme-sandbox')
export class PaymeSandboxController {
  constructor(private readonly sandboxService: PaymeSandboxService) {}

  @Post('session')
  @Public()
  @SkipAudit()
  @SkipSubscriptionCheck()
  @HttpCode(200)
  @ApiOperation({ summary: "Checkout sessiyasini ochish (to'lov ma'lumotlari + token)" })
  async session(@Body() dto: SandboxSessionDto) {
    return this.sandboxService.createSession(dto.params);
  }

  @Post('card')
  @Public()
  @SkipAudit()
  @SkipSubscriptionCheck()
  @HttpCode(200)
  @ApiOperation({ summary: 'Karta raqami + muddat (SMS kod "yuboriladi")' })
  async card(@Body() dto: SandboxCardDto) {
    return this.sandboxService.submitCard(dto.token, dto.card, dto.expire);
  }

  @Post('confirm')
  @Public()
  @SkipAudit()
  @SkipSubscriptionCheck()
  @HttpCode(200)
  @ApiOperation({ summary: "SMS kodni tasdiqlash — to'lov bajariladi" })
  async confirm(@Body() dto: SandboxConfirmDto) {
    return this.sandboxService.confirm(dto.token, dto.code);
  }

  @Post('cancel')
  @Public()
  @SkipAudit()
  @SkipSubscriptionCheck()
  @HttpCode(200)
  @ApiOperation({ summary: "To'lovni bekor qilish (sessiya tozalanadi)" })
  async cancel(@Body() dto: SandboxCancelDto) {
    return this.sandboxService.cancel(dto.token);
  }
}
