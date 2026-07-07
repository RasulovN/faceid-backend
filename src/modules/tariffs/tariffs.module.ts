import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Device } from '../../entities/device.entity';
import { Employee } from '../../entities/employee.entity';
import { Tariff } from '../../entities/tariff.entity';
import { TariffLimitsService } from './tariff-limits.service';
import { TariffsController } from './tariffs.controller';
import { TariffsService } from './tariffs.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tariff, Company, Branch, Employee, Device])],
  controllers: [TariffsController],
  providers: [TariffsService, TariffLimitsService],
  exports: [TariffsService, TariffLimitsService],
})
export class TariffsModule {}
