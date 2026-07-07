import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageSnapshot } from '../../entities/storage-snapshot.entity';
import { User } from '../../entities/user.entity';
import { StorageAnalyticsController } from './storage-analytics.controller';
import { StorageAnalyticsService } from './storage-analytics.service';
import { StorageExportService } from './storage-export.service';
import { STORAGE_QUEUE, StorageSnapshotProcessor } from './storage-snapshot.processor';
import { StorageStatsRepository } from './storage-stats.repository';

/**
 * Super Admin — Storage Analytics & Database Monitoring.
 * PostgreSQL system cataloglari + soatlik snapshotlar asosida
 * saqlash hajmi monitoringi, growth analytics va tozalash tavsiyalari.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StorageSnapshot, User]),
    BullModule.registerQueue({ name: STORAGE_QUEUE }),
  ],
  controllers: [StorageAnalyticsController],
  providers: [
    StorageStatsRepository,
    StorageAnalyticsService,
    StorageExportService,
    StorageSnapshotProcessor,
  ],
  exports: [StorageAnalyticsService],
})
export class StorageAnalyticsModule {}
