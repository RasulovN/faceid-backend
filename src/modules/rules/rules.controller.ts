import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { RulesService } from './rules.service';
import { CurrentUser, Permissions, RequestUser } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { BonusType, PenaltyType } from '../../common/enums';

class CreatePenaltyRuleDto {
  @ApiProperty({ enum: PenaltyType })
  @IsIn(Object.values(PenaltyType))
  type: PenaltyType;

  @ApiProperty({ description: 'tiyin', example: 5000000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ default: 0, description: 'Kechikish chegarasi (daqiqa)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  thresholdMinutes?: number;

  @ApiPropertyOptional({
    default: 1,
    description: 'LATE_SALARY / EARLY_LEAVE_SALARY uchun ko\'paytuvchi (1 = 1 daqiqalik ish haqi)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  multiplier?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdatePenaltyRuleDto {
  @ApiPropertyOptional({ enum: PenaltyType })
  @IsOptional()
  @IsIn(Object.values(PenaltyType))
  type?: PenaltyType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  thresholdMinutes?: number;

  @ApiPropertyOptional({ description: 'LATE_SALARY / EARLY_LEAVE_SALARY ko\'paytuvchisi' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  multiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class CreateBonusRuleDto {
  @ApiProperty({ enum: BonusType })
  @IsIn(Object.values(BonusType))
  type: BonusType;

  @ApiProperty({ description: 'tiyin' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateBonusRuleDto {
  @ApiPropertyOptional({ enum: BonusType })
  @IsOptional()
  @IsIn(Object.values(BonusType))
  type?: BonusType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateOvertimeRuleDto {
  @ApiPropertyOptional({ default: 1.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  multiplier?: number;

  @ApiPropertyOptional({ default: 2, description: 'Dam olish kuni ishlaganlik koeffitsiyenti' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  weekendMultiplier?: number;

  @ApiPropertyOptional({ default: 2, description: 'Bayram kuni ishlaganlik koeffitsiyenti' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  holidayMultiplier?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Overtime haqi to‘lanadimi' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@ApiTags('rules')
@ApiBearerAuth()
@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  // ---------- Jarimalar ----------

  @Get('penalties')
  @Permissions(PERMISSIONS.RULES_READ)
  async findPenalties(@CurrentUser() user: RequestUser) {
    return this.rulesService.findPenalties(user.companyId!);
  }

  @Post('penalties')
  @Permissions(PERMISSIONS.RULES_MANAGE)
  async createPenalty(@CurrentUser() user: RequestUser, @Body() dto: CreatePenaltyRuleDto) {
    return this.rulesService.createPenalty(user.companyId!, dto);
  }

  @Patch('penalties/:id')
  @Permissions(PERMISSIONS.RULES_MANAGE)
  async updatePenalty(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePenaltyRuleDto,
  ) {
    return this.rulesService.updatePenalty(user.companyId!, id, dto);
  }

  @Delete('penalties/:id')
  @Permissions(PERMISSIONS.RULES_MANAGE)
  async removePenalty(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rulesService.removePenalty(user.companyId!, id);
  }

  // ---------- Bonuslar ----------

  @Get('bonuses')
  @Permissions(PERMISSIONS.RULES_READ)
  async findBonuses(@CurrentUser() user: RequestUser) {
    return this.rulesService.findBonuses(user.companyId!);
  }

  @Post('bonuses')
  @Permissions(PERMISSIONS.RULES_MANAGE)
  async createBonus(@CurrentUser() user: RequestUser, @Body() dto: CreateBonusRuleDto) {
    return this.rulesService.createBonus(user.companyId!, dto);
  }

  @Patch('bonuses/:id')
  @Permissions(PERMISSIONS.RULES_MANAGE)
  async updateBonus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBonusRuleDto,
  ) {
    return this.rulesService.updateBonus(user.companyId!, id, dto);
  }

  @Delete('bonuses/:id')
  @Permissions(PERMISSIONS.RULES_MANAGE)
  async removeBonus(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rulesService.removeBonus(user.companyId!, id);
  }

  // ---------- Overtime ----------

  @Get('overtime')
  @Permissions(PERMISSIONS.RULES_READ)
  @ApiOperation({ summary: 'Kompaniya overtime qoidasi (bo‘lmasa default yaratadi)' })
  async getOvertime(@CurrentUser() user: RequestUser) {
    return this.rulesService.getOvertime(user.companyId!);
  }

  @Patch('overtime')
  @Permissions(PERMISSIONS.RULES_MANAGE)
  async updateOvertime(@CurrentUser() user: RequestUser, @Body() dto: UpdateOvertimeRuleDto) {
    return this.rulesService.updateOvertime(user.companyId!, dto);
  }
}
