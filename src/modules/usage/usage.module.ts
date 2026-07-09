import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageDaily } from '../../entities/usage-daily.entity';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { UsageTrackerService } from './usage-tracker.service';
import { UsageTrackingInterceptor } from './usage-tracking.interceptor';

/**
 * Kompaniyalarning tizimdan foydalanish analitikasi (superadmin):
 * - global interceptor har muvaffaqiyatli so'rovni usage_daily buferiga yozadi
 * - UsageTrackerService 15s da bir additiv upsert qiladi
 * - /admin/usage/* endpointlari agregatlarni qaytaradi
 * @Global — auth.service login hisobini trackerga import zanjirisiz yozishi uchun.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UsageDaily])],
  controllers: [UsageController],
  providers: [
    UsageService,
    UsageTrackerService,
    { provide: APP_INTERCEPTOR, useClass: UsageTrackingInterceptor },
  ],
  exports: [UsageTrackerService],
})
export class UsageModule {}
