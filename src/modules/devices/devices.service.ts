import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Device } from '../../entities/device.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { DeviceDirection } from '../../common/enums';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { generateDeviceToken, generatePairingCode } from '../../common/utils/crypto.util';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TariffLimitsService } from '../tariffs/tariff-limits.service';
import { WsService } from '../ws/ws.service';

const PAIRING_TTL_SECONDS = 600; // 10 daqiqa

interface PairingPayload {
  companyId: string;
  branchId: string;
  name: string;
  direction: DeviceDirection;
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tariffLimitsService: TariffLimitsService,
    private readonly wsService: WsService,
    private readonly config: ConfigService,
  ) {}

  async findAll(companyId: string, query: PaginationDto) {
    const [items, total] = await this.deviceRepository.findAndCount({
      where: { companyId },
      relations: { branch: true },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    const now = Date.now();
    const presented = items.map((device) => ({
      ...this.sanitize(device),
      isOnline: !!device.lastSeenAt && now - device.lastSeenAt.getTime() < 120_000,
    }));
    return Paginated.of(presented, total, query);
  }

  async update(
    companyId: string,
    id: string,
    dto: { name?: string; direction?: DeviceDirection; isActive?: boolean; branchId?: string },
  ) {
    const device = await this.getEntity(companyId, id);
    if (dto.branchId && dto.branchId !== device.branchId) {
      const branch = await this.branchRepository.exists({
        where: { id: dto.branchId, companyId },
      });
      if (!branch) throw AppException.notFound('Filial topilmadi');
      device.branchId = dto.branchId;
    }
    if (dto.name !== undefined) device.name = dto.name;
    if (dto.direction !== undefined) device.direction = dto.direction;
    if (dto.isActive !== undefined && dto.isActive !== device.isActive) {
      device.isActive = dto.isActive;
      this.wsService.emitDeviceStatus(companyId, {
        deviceId: device.id,
        isActive: device.isActive,
        lastSeenAt: device.lastSeenAt,
      });
    }
    await this.deviceRepository.save(device);
    return this.sanitize(device);
  }

  async remove(companyId: string, id: string): Promise<{ ok: boolean }> {
    const device = await this.getEntity(companyId, id);
    await this.deviceRepository.remove(device);
    return { ok: true };
  }

  // ---------- Pairing ----------

  async createPairingCode(
    companyId: string,
    dto: { branchId: string; name: string; direction: DeviceDirection },
  ) {
    const branch = await this.branchRepository.exists({
      where: { id: dto.branchId, companyId },
    });
    if (!branch) throw AppException.notFound('Filial topilmadi');
    // Limitni kod yaratishda ham tekshiramiz — foydalanuvchiga erta xabar
    await this.tariffLimitsService.assertCanCreate(companyId, 'device');

    let code = generatePairingCode();
    // Kolliziya ehtimoli juda past, lekin baribir tekshiramiz
    for (let i = 0; i < 5 && (await this.redis.exists(this.pairKey(code))); i++) {
      code = generatePairingCode();
    }
    const payload: PairingPayload = {
      companyId,
      branchId: dto.branchId,
      name: dto.name,
      direction: dto.direction,
    };
    await this.redis.set(this.pairKey(code), JSON.stringify(payload), 'EX', PAIRING_TTL_SECONDS);
    return {
      code,
      expiresAt: new Date(Date.now() + PAIRING_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Kiosk kod bilan ulanadi (public) */
  async pair(code: string) {
    const raw = await this.redis.get(this.pairKey(code));
    if (!raw) {
      throw AppException.notFound('Pairing kodi yaroqsiz yoki muddati tugagan');
    }
    const payload = JSON.parse(raw) as PairingPayload;
    await this.tariffLimitsService.assertCanCreate(payload.companyId, 'device');

    // Atomik "claim": bir vaqtda kelgan bir nechta so'rovdan (masalan StrictMode
    // qo'sh-chaqiruv yoki qayta urinish) faqat BITTASI kodni oladi. `del` o'chirilgan
    // kalitlar sonini qaytaradi — 0 bo'lsa boshqasi allaqachon olgan, qurilma yaratilmaydi.
    const claimed = await this.redis.del(this.pairKey(code));
    if (claimed === 0) {
      throw AppException.notFound('Pairing kodi yaroqsiz yoki muddati tugagan');
    }

    const device = await this.deviceRepository.save(
      this.deviceRepository.create({
        companyId: payload.companyId,
        branchId: payload.branchId,
        name: payload.name,
        direction: payload.direction,
        deviceToken: generateDeviceToken(),
        lastSeenAt: new Date(),
      }),
    );
    const branch = await this.branchRepository.findOne({ where: { id: payload.branchId } });
    const company = await this.companyRepository.findOne({ where: { id: payload.companyId } });
    this.wsService.emitDeviceStatus(payload.companyId, {
      deviceId: device.id,
      isActive: true,
      lastSeenAt: device.lastSeenAt,
      code,
      paired: true,
      name: device.name,
      branchId: device.branchId,
    });
    return {
      deviceToken: device.deviceToken,
      device: {
        id: device.id,
        name: device.name,
        direction: device.direction,
        branch: branch ? { id: branch.id, name: branch.name } : null,
        company: company ? { id: company.id, name: company.name } : null,
      },
    };
  }

  /** Kiosk 60 soniyada bir yuboradi */
  async heartbeat(device: Device) {
    device.lastSeenAt = new Date();
    await this.deviceRepository.update({ id: device.id }, { lastSeenAt: device.lastSeenAt });
    this.wsService.emitDeviceStatus(device.companyId, {
      deviceId: device.id,
      isActive: device.isActive,
      lastSeenAt: device.lastSeenAt,
    });
    return { ok: true, direction: device.direction, isActive: device.isActive };
  }

  private async getEntity(companyId: string, id: string): Promise<Device> {
    const device = await this.deviceRepository.findOne({ where: { id, companyId } });
    if (!device) throw AppException.notFound('Qurilma topilmadi');
    return device;
  }

  private sanitize(device: Device) {
    const { deviceToken: _t, ...rest } = device;
    return rest;
  }

  private pairKey(code: string): string {
    return `device:pair:${code}`;
  }
}
