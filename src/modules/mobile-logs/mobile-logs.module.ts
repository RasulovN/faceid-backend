import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MobileErrorLog } from '../../entities/mobile-error-log.entity';
import { MobileLogsController } from './mobile-logs.controller';
import { MobileLogsService } from './mobile-logs.service';

/**
 * Mobil ilova xatolik loglari:
 * - public ingest endpoint (crash reporter yuboradi, authsiz)
 * - superadmin uchun ro'yxat/statistika/holat boshqaruvi ("Mobil loglar" sahifasi)
 */
@Module({
  imports: [TypeOrmModule.forFeature([MobileErrorLog])],
  controllers: [MobileLogsController],
  providers: [MobileLogsService],
})
export class MobileLogsModule {}
