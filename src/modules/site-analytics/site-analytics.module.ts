import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SiteVisit } from '../../entities/site-visit.entity';
import { GeoService } from './geo.service';
import { SiteAnalyticsController } from './site-analytics.controller';
import { SITE_ANALYTICS_QUEUE, SiteAnalyticsProcessor } from './site-analytics.processor';
import { SiteAnalyticsService } from './site-analytics.service';

/**
 * Landing sahifa tashriflari analitikasi:
 * - public visit/heartbeat endpointlar (cookie-rozilikdan keyin)
 * - IP → hudud (ip-api.com + Redis kesh)
 * - superadmin uchun agregatlar (hudud, vaqt, qurilma, manba)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SiteVisit]),
    BullModule.registerQueue({ name: SITE_ANALYTICS_QUEUE }),
  ],
  controllers: [SiteAnalyticsController],
  providers: [GeoService, SiteAnalyticsService, SiteAnalyticsProcessor],
  exports: [SiteAnalyticsService],
})
export class SiteAnalyticsModule {}
