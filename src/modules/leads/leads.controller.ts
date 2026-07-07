import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LeadsListQuery, LeadsService } from './leads.service';
import {
  CurrentUser,
  Public,
  RequestUser,
  Roles,
  SkipAudit,
  SkipSubscriptionCheck,
} from '../../common/decorators';
import { LeadStatus, UserRole } from '../../common/enums';
import { PaginationDto } from '../../common/dto/pagination.dto';

class CreateLeadDto {
  @ApiProperty({ example: 'Aziz Karimov' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'aziz@kompaniya.uz' })
  @IsEmail()
  @MaxLength(190)
  email: string;

  @ApiPropertyOptional({ example: '+998 90 123 45 67' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiProperty({ example: "Kompaniyamizda 30 ta xodim bor, qaysi tarif mos keladi?" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;

  /** Honeypot — botlar to'ldiradi; to'ldirilgan bo'lsa so'rov jimgina qabul qilinadi */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

class LeadsQueryDto extends PaginationDto implements LeadsListQuery {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsIn(Object.values(LeadStatus))
  status?: LeadStatus;
}

class UpdateLeadDto {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsIn(Object.values(LeadStatus))
  status?: LeadStatus;

  @ApiPropertyOptional({ description: 'Ichki izoh (mijozga ko‘rinmaydi)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

@ApiTags('leads')
@Controller()
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  // ---------- Landing (public) ----------

  @Post('leads')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({ summary: "Landing aloqa formasi — yangi murojaat (lead)" })
  async create(@Body() dto: CreateLeadDto) {
    // Honeypot to'ldirilgan bo'lsa — bot; jimgina OK qaytaramiz
    if (dto.website) return { ok: true };
    return this.leadsService.createFromLanding(dto);
  }

  // ---------- Superadmin ----------

  @Get('admin/leads')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @SkipSubscriptionCheck()
  @ApiOperation({ summary: "Murojaatlar ro'yxati (?status=NEW|CONTACTED|DEMO|APPROVED|REJECTED&search)" })
  async findAll(@Query() query: LeadsQueryDto) {
    return this.leadsService.findAll(query);
  }

  @Get('admin/leads/board')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Kanban doskasi — barcha murojaatlar (paginatsiyasiz, 500 tagacha)' })
  async board() {
    return this.leadsService.board();
  }

  @Get('admin/leads/stats')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'Statuslar bo‘yicha sonlar (kanban sarlavhalari)' })
  async stats() {
    return this.leadsService.stats();
  }

  @Patch('admin/leads/:id')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Status/izoh o‘zgartirish. APPROVED/REJECTED ga o‘tishda mijozga email boradi',
  })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(id, user.id, dto);
  }

  @Delete('admin/leads/:id')
  @ApiBearerAuth()
  @Roles(UserRole.SUPERADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadsService.remove(id);
  }
}
