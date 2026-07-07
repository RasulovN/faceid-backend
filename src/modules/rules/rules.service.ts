import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BonusRule, OvertimeRule, PenaltyRule } from '../../entities/rules.entities';
import { AppException } from '../../common/exceptions/app.exception';
import { BonusType, PenaltyType } from '../../common/enums';

@Injectable()
export class RulesService {
  constructor(
    @InjectRepository(PenaltyRule)
    private readonly penaltyRepository: Repository<PenaltyRule>,
    @InjectRepository(BonusRule) private readonly bonusRepository: Repository<BonusRule>,
    @InjectRepository(OvertimeRule)
    private readonly overtimeRepository: Repository<OvertimeRule>,
  ) {}

  /**
   * Yangi kompaniya uchun standart jarima/bonus qoidalarini yaratadi (idempotent).
   * Barchasi FAOL holatda — panelda o'chirib/yoqib turish mumkin:
   *  - ABSENT_SALARY: sababsiz kelmagan kun uchun 1 kunlik ish haqi ushlanadi
   *  - LATE_SALARY: kechikkan har daqiqa uchun daqiqalik ish haqi ushlanadi
   *  - Overtime (1.5×): qo'shimcha ishlagan vaqt uchun proporsional qo'shiladi
   */
  async seedDefaultRules(companyId: string): Promise<void> {
    const hasPenalties = await this.penaltyRepository.count({ where: { companyId } });
    if (hasPenalties === 0) {
      await this.penaltyRepository.save([
        this.penaltyRepository.create({
          companyId,
          type: PenaltyType.ABSENT_SALARY,
          amount: 0,
          thresholdMinutes: 0,
          multiplier: 1,
          isActive: true,
        }),
        this.penaltyRepository.create({
          companyId,
          type: PenaltyType.LATE_SALARY,
          amount: 0,
          thresholdMinutes: 0,
          multiplier: 1,
          isActive: true,
        }),
      ]);
    }
    const hasOvertime = await this.overtimeRepository.count({ where: { companyId } });
    if (hasOvertime === 0) {
      await this.overtimeRepository.save(
        this.overtimeRepository.create({
          companyId,
          multiplier: 1.5,
          requiresApproval: false,
          isActive: true,
        }),
      );
    }
  }

  // ---------- Jarimalar ----------

  async findPenalties(companyId: string): Promise<PenaltyRule[]> {
    return this.penaltyRepository.find({ where: { companyId }, order: { createdAt: 'ASC' } });
  }

  async createPenalty(
    companyId: string,
    dto: { type: PenaltyType; amount: number; thresholdMinutes?: number; isActive?: boolean },
  ): Promise<PenaltyRule> {
    return this.penaltyRepository.save(this.penaltyRepository.create({ ...dto, companyId }));
  }

  async updatePenalty(
    companyId: string,
    id: string,
    dto: Partial<Pick<PenaltyRule, 'type' | 'amount' | 'thresholdMinutes' | 'isActive'>>,
  ): Promise<PenaltyRule> {
    const rule = await this.penaltyRepository.findOne({ where: { id, companyId } });
    if (!rule) throw AppException.notFound('Jarima qoidasi topilmadi');
    Object.assign(rule, dto);
    return this.penaltyRepository.save(rule);
  }

  async removePenalty(companyId: string, id: string): Promise<{ ok: boolean }> {
    const rule = await this.penaltyRepository.findOne({ where: { id, companyId } });
    if (!rule) throw AppException.notFound('Jarima qoidasi topilmadi');
    await this.penaltyRepository.remove(rule);
    return { ok: true };
  }

  // ---------- Bonuslar ----------

  async findBonuses(companyId: string): Promise<BonusRule[]> {
    return this.bonusRepository.find({ where: { companyId }, order: { createdAt: 'ASC' } });
  }

  async createBonus(
    companyId: string,
    dto: { type: BonusType; amount: number; isActive?: boolean },
  ): Promise<BonusRule> {
    return this.bonusRepository.save(this.bonusRepository.create({ ...dto, companyId }));
  }

  async updateBonus(
    companyId: string,
    id: string,
    dto: Partial<Pick<BonusRule, 'type' | 'amount' | 'isActive'>>,
  ): Promise<BonusRule> {
    const rule = await this.bonusRepository.findOne({ where: { id, companyId } });
    if (!rule) throw AppException.notFound('Bonus qoidasi topilmadi');
    Object.assign(rule, dto);
    return this.bonusRepository.save(rule);
  }

  async removeBonus(companyId: string, id: string): Promise<{ ok: boolean }> {
    const rule = await this.bonusRepository.findOne({ where: { id, companyId } });
    if (!rule) throw AppException.notFound('Bonus qoidasi topilmadi');
    await this.bonusRepository.remove(rule);
    return { ok: true };
  }

  // ---------- Overtime ----------

  async getOvertime(companyId: string): Promise<OvertimeRule> {
    const existing = await this.overtimeRepository.findOne({ where: { companyId } });
    if (existing) return existing;
    return this.overtimeRepository.save(
      this.overtimeRepository.create({ companyId, multiplier: 1.5, requiresApproval: false }),
    );
  }

  async updateOvertime(
    companyId: string,
    dto: { multiplier?: number; requiresApproval?: boolean; isActive?: boolean },
  ): Promise<OvertimeRule> {
    const rule = await this.getOvertime(companyId);
    Object.assign(rule, dto);
    return this.overtimeRepository.save(rule);
  }
}
