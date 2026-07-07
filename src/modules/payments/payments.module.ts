import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { Payment } from '../../entities/payment.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Tariff } from '../../entities/tariff.entity';
import { BILLING_QUEUE, BillingProcessor } from './billing.processor';
import { PaymentsController } from './payments.controller';
import { PaymeConfig } from './payme.config';
import { PaymeService } from './payme.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Subscription, Tariff, Company]),
    BullModule.registerQueue({ name: BILLING_QUEUE }),
  ],
  controllers: [PaymentsController],
  providers: [PaymeConfig, PaymeService, SubscriptionsService, BillingProcessor],
  exports: [PaymeService, SubscriptionsService],
})
export class PaymentsModule {}
