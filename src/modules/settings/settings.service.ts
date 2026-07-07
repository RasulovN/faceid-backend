import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiteSetting } from '../../entities/site-setting.entity';
import { UpdateSiteSettingsDto } from './dto/settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SiteSetting)
    private readonly repo: Repository<SiteSetting>,
  ) {}

  /** Yagona (singleton) sozlamalar qatorini oladi; bo'lmasa yaratadi. */
  async get(): Promise<SiteSetting> {
    const existing = await this.repo.find({ order: { updatedAt: 'ASC' }, take: 1 });
    if (existing[0]) return existing[0];
    return this.repo.save(this.repo.create({}));
  }

  async update(dto: UpdateSiteSettingsDto): Promise<SiteSetting> {
    const current = await this.get();
    Object.assign(current, dto);
    return this.repo.save(current);
  }
}
