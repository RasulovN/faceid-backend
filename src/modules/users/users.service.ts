import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { Company } from '../../entities/company.entity';
import { Role } from '../../entities/role.entity';
import { User } from '../../entities/user.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { UserRole } from '../../common/enums';
import { Paginated } from '../../common/dto/pagination.dto';
import { RequestUser } from '../../common/decorators';
import {
  AdminCreateUserDto,
  CreateStaffUserDto,
  UpdateUserDto,
  UserListQueryDto,
} from './dto/user.dtos';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
  ) {}

  async findAll(query: UserListQueryDto, companyId?: string) {
    const base: FindOptionsWhere<User> = {};
    if (companyId) base.companyId = companyId;
    if (query.role) base.role = query.role;
    // Bir nechta rol filtri (?roles=A,B) — yagona `role` paramdan ustun turadi
    if (query.roles) {
      const valid = query.roles
        .split(',')
        .map((r) => r.trim())
        .filter((r): r is UserRole => (Object.values(UserRole) as string[]).includes(r));
      if (valid.length > 0) base.role = In(valid) as unknown as UserRole;
    }
    const where: FindOptionsWhere<User>[] = query.search
      ? [
          { ...base, username: ILike(`%${query.search}%`) },
          { ...base, email: ILike(`%${query.search}%`) },
        ]
      : [base];
    const [items, total] = await this.userRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    const withRoleNames = await this.attachRoleNames(items);
    // Superadmin ro'yxatida (kompaniya scope'siz) kompaniya nomlari ham ko'rsatiladi
    const enriched = companyId ? withRoleNames : await this.attachCompanyNames(items, withRoleNames);
    return Paginated.of(enriched, total, query);
  }

  /** Har bir userga companyName biriktiradi (bitta IN so'rov bilan) */
  private async attachCompanyNames<T extends { companyId?: string | null }>(
    users: User[],
    sanitized: T[],
  ): Promise<(T & { companyName: string | null })[]> {
    const companyIds = [
      ...new Set(users.map((u) => u.companyId).filter((id): id is string => !!id)),
    ];
    const nameById = new Map<string, string>();
    if (companyIds.length > 0) {
      const companies = await this.companyRepository.find({
        where: { id: In(companyIds) },
        select: ['id', 'name'],
      });
      for (const company of companies) nameById.set(company.id, company.name);
    }
    return sanitized.map((u) => ({
      ...u,
      companyName: u.companyId ? (nameById.get(u.companyId) ?? null) : null,
    }));
  }

  async update(id: string, dto: UpdateUserDto, actor: RequestUser) {
    const where: FindOptionsWhere<User> =
      actor.role === UserRole.SUPERADMIN ? { id } : { id, companyId: actor.companyId! };
    const user = await this.userRepository.findOne({ where });
    if (!user) throw AppException.notFound('Foydalanuvchi topilmadi');
    if (user.role === UserRole.SUPERADMIN && actor.role !== UserRole.SUPERADMIN) {
      throw AppException.forbidden('Superadmin foydalanuvchisini o‘zgartirib bo‘lmaydi');
    }
    if (
      user.role === UserRole.COMPANY_OWNER &&
      (dto.role || dto.roleId) &&
      actor.role !== UserRole.SUPERADMIN
    ) {
      throw AppException.forbidden('Kompaniya egasining rolini o‘zgartirib bo‘lmaydi');
    }
    if (dto.role) user.role = dto.role;
    if (dto.roleId !== undefined) {
      await this.assertRoleInCompany(dto.roleId, user.companyId);
      user.roleId = dto.roleId;
    }
    if (dto.isActive !== undefined) {
      user.isActive = dto.isActive;
      if (!dto.isActive) user.refreshTokenHash = null;
    }
    return this.sanitizeOne(await this.userRepository.save(user));
  }

  /** Company admin staff user yaratadi (enum COMPANY_ADMIN + custom roleId). */
  async createStaff(dto: CreateStaffUserDto, actor: RequestUser) {
    const companyId = actor.companyId!;
    await this.assertRoleInCompany(dto.roleId, companyId);
    for (const [field, value] of [
      ['username', dto.username.toLowerCase()],
      ['email', dto.email.toLowerCase()],
      ['phone', dto.phone],
    ] as const) {
      if (await this.userRepository.exists({ where: { [field]: value } })) {
        throw AppException.conflict(`Bu ${field} allaqachon band`);
      }
    }
    const user = await this.userRepository.save(
      this.userRepository.create({
        username: dto.username.toLowerCase(),
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        passwordHash: await argon2.hash(dto.password),
        role: UserRole.COMPANY_ADMIN,
        companyId,
        roleId: dto.roleId,
        isEmailVerified: true,
      }),
    );
    return this.sanitizeOne(user);
  }

  async adminCreate(dto: AdminCreateUserDto) {
    for (const [field, value] of [
      ['username', dto.username.toLowerCase()],
      ['email', dto.email.toLowerCase()],
      ['phone', dto.phone],
    ] as const) {
      if (await this.userRepository.exists({ where: { [field]: value } })) {
        throw AppException.conflict(`Bu ${field} allaqachon band`);
      }
    }
    if (dto.role !== UserRole.SUPERADMIN && !dto.companyId) {
      throw AppException.validation('SUPERADMIN bo‘lmagan rol uchun companyId majburiy');
    }
    const user = await this.userRepository.save(
      this.userRepository.create({
        username: dto.username.toLowerCase(),
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        passwordHash: await argon2.hash(dto.password),
        role: dto.role,
        companyId: dto.role === UserRole.SUPERADMIN ? null : (dto.companyId ?? null),
        isEmailVerified: true,
      }),
    );
    return this.sanitizeOne(user);
  }

  private async assertRoleInCompany(roleId: string, companyId: string | null): Promise<void> {
    if (!companyId) throw AppException.validation('Foydalanuvchi kompaniyaga bog‘lanmagan');
    const role = await this.roleRepository.findOne({ where: { id: roleId, companyId } });
    if (!role) throw AppException.validation('Tanlangan rol kompaniyaga tegishli emas');
  }

  /** Sanitizatsiya + custom rol nomini (roleName) qo'shadi. */
  private async attachRoleNames(users: User[]) {
    const roleIds = [...new Set(users.map((u) => u.roleId).filter((id): id is string => !!id))];
    const nameById = new Map<string, string>();
    if (roleIds.length > 0) {
      const roles = await this.roleRepository.find({ where: { id: In(roleIds) } });
      for (const role of roles) nameById.set(role.id, role.name);
    }
    return users.map((u) => ({
      ...this.sanitize(u),
      roleName: u.roleId ? (nameById.get(u.roleId) ?? null) : null,
    }));
  }

  private async sanitizeOne(user: User) {
    const roleName = user.roleId
      ? ((await this.roleRepository.findOne({ where: { id: user.roleId } }))?.name ?? null)
      : null;
    return { ...this.sanitize(user), roleName };
  }

  private sanitize(user: User) {
    const {
      passwordHash: _ph,
      refreshTokenHash: _rt,
      emailVerificationToken: _ev,
      passwordResetToken: _pr,
      ...rest
    } = user;
    return rest;
  }
}
