import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymeRequest, PaymeService } from './payme.service';
import { PaymeSubscribeService } from './payme-subscribe.service';
import { PaymentReceiptService } from './payment-receipt.service';
import {
  AdminPaymentStateFilter,
  AdminSubscriptionAction,
  AdminSubscriptionFilter,
  SubscriptionsService,
} from './subscriptions.service';
import {
  CurrentUser,
  Permissions,
  Public,
  RequestUser,
  Roles,
  SkipAudit,
  SkipEnvelope,
  SkipSubscriptionCheck,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { UserRole } from '../../common/enums';
import { PaginationDto } from '../../common/dto/pagination.dto';

class CustomLimitsDto {
  @ApiProperty({ minimum: 1, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  branches: number;

  @ApiProperty({ minimum: 1, example: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employees: number;

  @ApiProperty({ minimum: 1, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  devices: number;
}

class CheckoutDto {
  @ApiProperty()
  @IsUUID()
  tariffId: string;

  @ApiProperty({ minimum: 1, maximum: 12, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  months: number;

  @ApiPropertyOptional({
    type: CustomLimitsDto,
    description: 'Custom tarif uchun tanlangan miqdorlar (custom tarifda majburiy)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomLimitsDto)
  customLimits?: CustomLimitsDto;
}

class CardChargeDto {
  @ApiProperty({ example: '8600 4954 7331 6478' })
  @IsString()
  @MaxLength(32)
  card: string;

  @ApiProperty({ example: '03/99' })
  @IsString()
  @MaxLength(8)
  expire: string;
}

class CardConfirmDto {
  @ApiProperty({ description: 'cards.create qaytargan karta tokeni' })
  @IsString()
  @MaxLength(512)
  token: string;

  @ApiProperty({ example: '666666' })
  @IsString()
  @MaxLength(8)
  code: string;
}

class AdminPaymentsQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ enum: ['CREATED', 'PAID', 'CANCELED'] })
  @IsOptional()
  @IsIn(['CREATED', 'PAID', 'CANCELED'])
  state?: Exclude<AdminPaymentStateFilter, undefined>;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD dan' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD gacha (shu kun ham kiradi)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

class AdminSubscriptionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['active', 'expiring', 'expired'] })
  @IsOptional()
  @IsIn(['active', 'expiring', 'expired'])
  status?: Exclude<AdminSubscriptionFilter, undefined>;
}

class AdminSubscriptionActionDto {
  @ApiProperty({ enum: ['extend', 'cancel', 'change_tariff', 'approve_request'] })
  @IsIn(['extend', 'cancel', 'change_tariff', 'approve_request'])
  action: AdminSubscriptionAction;

  @ApiPropertyOptional({ description: 'extend/change_tariff/approve_request: necha oy (kalendar oy)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;

  @ApiPropertyOptional({ description: 'extend/change_tariff/approve_request: necha kun (months bilan qoʼshilishi mumkin)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1096)
  days?: number;

  @ApiPropertyOptional({ description: "change_tariff: yangi tarif ID (to'lovsiz almashtirish)" })
  @IsOptional()
  @IsUUID()
  tariffId?: string;

  @ApiPropertyOptional({ description: "approve_request: kutilayotgan to'lov (so'rov) ID" })
  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @ApiPropertyOptional({
    description: "true — joriy foydalanish yangi tarif limitidan oshsa ham almashtirilsin",
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly paymeService: PaymeService,
    private readonly paymeSubscribeService: PaymeSubscribeService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly receiptService: PaymentReceiptService,
  ) {}

  // ---------- Payme Merchant API (JSON-RPC) ----------

  @Post('payments/payme')
  @Public()
  @SkipEnvelope()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Payme Merchant API (JSON-RPC, Basic auth: Paycom:MERCHANT_KEY)' })
  async payme(
    @Body() body: PaymeRequest,
    @Req() req: FastifyRequest,
    @Headers('authorization') authorization?: string,
  ) {
    // req.ip — trustProxy yoqilgani uchun nginx orqasida ham haqiqiy mijoz IP'si
    return this.paymeService.handle(body, authorization, req.ip);
  }

  // ---------- Kompaniya to'lovlari ----------

  @Get('payments')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.PAYMENTS_READ)
  async companyPayments(@CurrentUser() user: RequestUser, @Query() query: PaginationDto) {
    return this.subscriptionsService.companyPayments(user.companyId!, query);
  }

  @Get('payments/:id')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.PAYMENTS_READ)
  @SkipSubscriptionCheck()
  @ApiOperation({ summary: "Bitta to'lov holati (Payme'dan qaytgach poll qilinadi)" })
  async paymentStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.subscriptionsService.paymentStatus(user.companyId!, id);
  }

  @Post('payments/:id/card')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.SUBSCRIPTIONS_CHECKOUT)
  @SkipSubscriptionCheck()
  @SkipAudit() // karta ma'lumotlari audit-logga tushmasin
  @HttpCode(200)
  @ApiOperation({
    summary: "Subscribe API: kartani tokenlash + SMS yuborish (modal ichidagi to'lov)",
  })
  async chargeCard(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardChargeDto,
  ) {
    return this.paymeSubscribeService.chargeCard(user.companyId!, id, dto.card, dto.expire);
  }

  @Post('payments/:id/card/confirm')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.SUBSCRIPTIONS_CHECKOUT)
  @SkipSubscriptionCheck()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: "Subscribe API: SMS tasdiqlash → receipts.create + receipts.pay" })
  async confirmCard(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardConfirmDto,
  ) {
    return this.paymeSubscribeService.confirmAndPay(user.companyId!, id, dto.token, dto.code);
  }

  @Post('payments/:id/cancel')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.SUBSCRIPTIONS_CHECKOUT)
  @SkipSubscriptionCheck()
  @HttpCode(200)
  @ApiOperation({ summary: "Kutilayotgan (Payme'ga ulanmagan) to'lovni bekor qilish" })
  async cancelPayment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.subscriptionsService.cancelPendingPayment(user.companyId!, id);
  }

  @Post('payments/:id/checkout')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.SUBSCRIPTIONS_CHECKOUT)
  @SkipSubscriptionCheck()
  @HttpCode(200)
  @ApiOperation({ summary: "Qayta to'lash — kutilayotgan to'lov uchun yangi checkout havolasi" })
  async retryCheckout(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.subscriptionsService.retryCheckout(user.companyId!, id);
  }

  @Get('payments/:id/receipt')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.PAYMENTS_READ)
  @SkipSubscriptionCheck()
  @ApiOperation({ summary: "To'lov cheki + fiskal (soliq) chek ma'lumoti" })
  async companyReceipt(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.receiptService.getReceipt(id, user.companyId!);
  }

  @Get('payments/:id/receipt/html')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.PAYMENTS_READ)
  @SkipSubscriptionCheck()
  @SkipEnvelope()
  @ApiOperation({ summary: "Chop etiladigan chek (HTML) — chek + fiskal chek" })
  async companyReceiptHtml(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.receiptService.renderReceiptHtml(id, user.companyId!);
    void reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  }

  @Get('admin/payments')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: "Barcha to'lovlar (?companyId&state=CREATED|PAID|CANCELED&from&to)" })
  async allPayments(@Query() query: AdminPaymentsQueryDto) {
    return this.subscriptionsService.allPayments(query);
  }

  @Get('admin/payments/:id/receipt')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: "To'lov cheki + fiskal chek (superadmin)" })
  async adminReceipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.receiptService.getReceipt(id);
  }

  @Get('admin/payments/:id/receipt/html')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @SkipEnvelope()
  @ApiOperation({ summary: "Chop etiladigan chek (HTML) — superadmin" })
  async adminReceiptHtml(@Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const html = await this.receiptService.renderReceiptHtml(id);
    void reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  }

  // ---------- Obuna ----------

  @Get('subscriptions/current')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.SUBSCRIPTIONS_READ)
  async current(@CurrentUser() user: RequestUser) {
    return this.subscriptionsService.current(user.companyId!);
  }

  @Post('subscriptions/checkout')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.SUBSCRIPTIONS_CHECKOUT)
  @SkipSubscriptionCheck() // obuna tugagan bo'lsa ham to'lash mumkin
  @HttpCode(200)
  @ApiOperation({ summary: 'Payme checkout havolasi yaratish' })
  async checkout(@CurrentUser() user: RequestUser, @Body() dto: CheckoutDto) {
    return this.subscriptionsService.checkout(
      user.companyId!,
      dto.tariffId,
      dto.months,
      dto.customLimits,
    );
  }

  @Get('admin/subscriptions')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Barcha obunalar (?status=active|expiring|expired)' })
  async adminSubscriptions(@Query() query: AdminSubscriptionsQueryDto) {
    return this.subscriptionsService.adminSubscriptions(query, query.status);
  }

  @Patch('admin/subscriptions/:id')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({
    summary:
      "Obuna amali: extend (muddat qo'shish), change_tariff (tarifni to'lovsiz almashtirish), approve_request (to'lanmagan so'rovni vaqtincha tasdiqlash) yoki cancel (darhol bekor qilish)",
  })
  async adminManageSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminSubscriptionActionDto,
  ) {
    return this.subscriptionsService.adminManage(id, dto.action, {
      months: dto.months,
      days: dto.days,
      tariffId: dto.tariffId,
      paymentId: dto.paymentId,
      force: dto.force,
    });
  }
}
