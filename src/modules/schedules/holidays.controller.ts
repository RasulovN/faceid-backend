import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Holiday } from '../../entities/holiday.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { CurrentUser, Permissions, RequestUser } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';

class HolidaysQueryDto {
  @ApiPropertyOptional({ example: '2026', description: 'Yil bo‘yicha filtr' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  year?: string;
}

class CreateHolidayDto {
  @ApiProperty({ example: '2026-09-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ApiProperty({ example: 'Mustaqillik kuni' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;
}

/**
 * Kompaniya bayram kunlari. Bayram kuni kelish talab qilinmaydi;
 * ishlangan vaqt bayram koeffitsiyenti bilan to'lanadi (payroll engine).
 */
@ApiTags('holidays')
@ApiBearerAuth()
@Controller('holidays')
export class HolidaysController {
  constructor(
    @InjectRepository(Holiday) private readonly holidayRepository: Repository<Holiday>,
  ) {}

  @Get()
  @Permissions(PERMISSIONS.SCHEDULES_READ)
  @ApiOperation({ summary: 'Bayram kunlari ro‘yxati (?year=2026)' })
  async findAll(@CurrentUser() user: RequestUser, @Query() query: HolidaysQueryDto) {
    const qb = this.holidayRepository
      .createQueryBuilder('h')
      .where('h."companyId" = :companyId', { companyId: user.companyId })
      .orderBy('h.date', 'ASC');
    if (query.year) {
      qb.andWhere(`to_char(h.date, 'YYYY') = :year`, { year: query.year });
    }
    return qb.getMany();
  }

  @Post()
  @Permissions(PERMISSIONS.SCHEDULES_MANAGE)
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateHolidayDto) {
    const exists = await this.holidayRepository.exists({
      where: { companyId: user.companyId!, date: dto.date },
    });
    if (exists) throw AppException.conflict('Bu sana allaqachon bayram sifatida belgilangan');
    return this.holidayRepository.save(
      this.holidayRepository.create({
        companyId: user.companyId!,
        date: dto.date,
        name: dto.name,
      }),
    );
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.SCHEDULES_MANAGE)
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    const holiday = await this.holidayRepository.findOne({
      where: { id, companyId: user.companyId! },
    });
    if (!holiday) throw AppException.notFound('Bayram kuni topilmadi');
    await this.holidayRepository.remove(holiday);
    return { ok: true };
  }
}
