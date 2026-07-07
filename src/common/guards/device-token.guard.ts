import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../exceptions/app.exception';
import { Device } from '../../entities/device.entity';

/** Kiosk qurilmalar uchun: X-Device-Token headerini tekshiradi */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.headers?.['x-device-token'] as string | undefined;
    if (!token) {
      throw AppException.unauthorized('X-Device-Token header yuborilmagan');
    }
    const device = await this.deviceRepository.findOne({
      where: { deviceToken: token },
      relations: { branch: true },
    });
    if (!device) {
      throw AppException.unauthorized('Qurilma tokeni yaroqsiz');
    }
    if (!device.isActive) {
      throw AppException.forbidden('Qurilma o‘chirilgan (isActive=false)');
    }
    req.device = device;
    return true;
  }
}
