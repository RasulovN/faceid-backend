import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { Payment } from '../../entities/payment.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Tariff } from '../../entities/tariff.entity';
import { BILLING_QUEUE, BillingProcessor } from './billing.processor';
import { PaymentReceiptService } from './payment-receipt.service';
import { PaymentsController } from './payments.controller';
import { PaymeConfig } from './payme.config';
import { PaymeSandboxController } from './payme-sandbox.controller';
import { PaymeSandboxService } from './payme-sandbox.service';
import { PaymeSubscribeService } from './payme-subscribe.service';
import { PaymeService } from './payme.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Subscription, Tariff, Company]),
    BullModule.registerQueue({ name: BILLING_QUEUE }),
  ],
  controllers: [PaymentsController, PaymeSandboxController],
  providers: [
    PaymeConfig,
    PaymeService,
    PaymeSandboxService,
    PaymeSubscribeService,
    SubscriptionsService,
    PaymentReceiptService,
    BillingProcessor,
  ],
  exports: [PaymeService, SubscriptionsService],
})
export class PaymentsModule {}
