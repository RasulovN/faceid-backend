import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tariff } from '../../entities/tariff.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { CreateTariffDto, UpdateTariffDto } from './dto/tariff.dtos';

@Injectable()
export class TariffsService {
  constructor(
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
  ) {}

  async findPublic(): Promise<Tariff[]> {
    return this.tariffRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  async findAll(): Promise<Tariff[]> {
    return this.tariffRepository.find({ order: { sortOrder: 'ASC' } });
  }

  async findOne(id: string): Promise<Tariff> {
    const tariff = await this.tariffRepository.findOne({ where: { id } });
    if (!tariff) throw AppException.notFound('Tarif topilmadi');
    return tariff;
  }

  async create(dto: CreateTariffDto): Promise<Tariff> {
    return this.tariffRepository.save(this.tariffRepository.create({ ...dto }));
  }

  async update(id: string, dto: UpdateTariffDto): Promise<Tariff> {
    const tariff = await this.findOne(id);
    Object.assign(tariff, dto);
    return this.tariffRepository.save(tariff);
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    const tariff = await this.findOne(id);
    // Tariflar o'chirilmaydi — deaktivatsiya qilinadi (kompaniyalar bog'langan bo'lishi mumkin)
    tariff.isActive = false;
    await this.tariffRepository.save(tariff);
    return { ok: true };
  }
}
