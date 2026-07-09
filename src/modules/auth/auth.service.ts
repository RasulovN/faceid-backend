import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Role } from '../../entities/role.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Tariff } from '../../entities/tariff.entity';
import { User } from '../../entities/user.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { CompanyStatus, SubscriptionStatus, UserRole } from '../../common/enums';
import { ROLE_PERMISSIONS } from '../../common/constants/permissions';
import { generateUrlToken } from '../../common/utils/crypto.util';
import { slugify, slugWithSuffix } from '../../common/utils/slug.util';
import { MailService } from '../mail/mail.service';
import { RolesService } from '../roles/roles.service';
import { RulesService } from '../rules/rules.service';
import { UsageTrackerService } from '../usage/usage-tracker.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dtos';

export type IdentifierKind = 'username' | 'email' | 'phone';

interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Tariff) private readonly tariffRepository: Repository<Tariff>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    private readonly rolesService: RolesService,
    private readonly rulesService: RulesService,
    private readonly usageTracker: UsageTrackerService,
  ) {}

  // ---------- Identifier aniqlash ----------

  /** identifier = username | email | +998 telefon (avtodetect) */
  detectIdentifier(identifier: string): { kind: IdentifierKind; value: string } {
    const trimmed = identifier.trim();
    if (trimmed.includes('@')) {
      return { kind: 'email', value: trimmed.toLowerCase() };
    }
    const digits = trimmed.replace(/[\s()-]/g, '');
    if (/^\+998\d{9}$/.test(digits)) {
      return { kind: 'phone', value: digits };
    }
    if (/^998\d{9}$/.test(digits)) {
      return { kind: 'phone', value: `+${digits}` };
    }
    return { kind: 'username', value: trimmed };
  }

  // ---------- Register ----------

  async register(dto: RegisterDto) {
    await this.assertUserUnique(dto.username, dto.email, dto.phone);

    const autoApprove = this.config.get<string>('AUTO_APPROVE_COMPANIES') !== 'false';
    const trialDays = Number(this.config.get('TRIAL_DAYS') ?? 14);
    const passwordHash = await argon2.hash(dto.password);
    const verificationToken = generateUrlToken();

    const result = await this.dataSource.transaction(async (manager) => {
      const slug = await this.generateUniqueSlug(dto.companyName, manager.getRepository(Company));

      // Trial uchun eng arzon faol tarif
      const trialTariff = autoApprove
        ? await manager.getRepository(Tariff).findOne({
            where: { isActive: true },
            order: { sortOrder: 'ASC' },
          })
        : null;

      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

      const company = await manager.getRepository(Company).save(
        manager.getRepository(Company).create({
          name: dto.companyName,
          slug,
          status: autoApprove ? CompanyStatus.ACTIVE : CompanyStatus.PENDING,
          tariffId: trialTariff?.id ?? null,
          subscriptionStartsAt: autoApprove && trialTariff ? now : null,
          subscriptionEndsAt: autoApprove && trialTariff ? trialEndsAt : null,
          contactEmail: dto.email,
          contactPhone: dto.phone,
          settings: {},
        }),
      );

      const user = await manager.getRepository(User).save(
        manager.getRepository(User).create({
          username: dto.username.toLowerCase(),
          email: dto.email.toLowerCase(),
          phone: dto.phone,
          passwordHash,
          role: UserRole.COMPANY_OWNER,
          companyId: company.id,
          emailVerificationToken: verificationToken,
        }),
      );

      company.ownerId = user.id;
      await manager.getRepository(Company).save(company);

      if (autoApprove && trialTariff) {
        await manager.getRepository(Subscription).save(
          manager.getRepository(Subscription).create({
            companyId: company.id,
            tariffId: trialTariff.id,
            startsAt: now,
            endsAt: trialEndsAt,
            status: SubscriptionStatus.ACTIVE,
            isTrial: true,
          }),
        );
      }

      return { user, company };
    });

    // Yangi kompaniyaga default (isSystem) rollarni seed qilamiz.
    await this.rolesService.seedDefaultRoles(result.company.id);
    await this.rulesService.seedDefaultRules(result.company.id);

    await this.mailService.sendVerificationEmail(
      result.user.email,
      `${dto.firstName} ${dto.lastName}`,
      verificationToken,
    );

    return {
      user: await this.toPublicUser(result.user),
      company: result.company,
    };
  }

  // ---------- Login ----------

  async login(dto: LoginDto) {
    const { kind, value } = this.detectIdentifier(dto.identifier);
    const user = await this.userRepository.findOne({
      where: { [kind === 'phone' ? 'phone' : kind]: kind === 'username' ? value.toLowerCase() : value },
    });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password).catch(() => false))) {
      throw AppException.unauthorized('Login yoki parol noto‘g‘ri');
    }
    if (!user.isActive) {
      throw AppException.forbidden('Hisobingiz faol emas. Administrator bilan bog‘laning');
    }

    user.lastLoginAt = new Date();
    const tokens = await this.issueTokens(user);
    await this.userRepository.save(user);
    // Login public endpoint (interceptor'da user yo'q) — usage shu yerda qayd etiladi
    if (user.companyId && user.role !== UserRole.SUPERADMIN) {
      this.usageTracker.track(user.companyId, user.id, { logins: 1, requests: 1 });
    }
    return { ...tokens, user: await this.toPublicUser(user) };
  }

  // ---------- Refresh (rotation) ----------

  async refresh(dto: RefreshDto) {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw AppException.unauthorized('Refresh token yaroqsiz yoki muddati tugagan');
    }
    if (payload.type !== 'refresh') {
      throw AppException.unauthorized('Noto‘g‘ri token turi');
    }
    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw AppException.unauthorized('Foydalanuvchi topilmadi yoki faol emas');
    }
    if (!user.refreshTokenHash) {
      throw AppException.unauthorized('Sessiya tugatilgan — qaytadan kiring');
    }
    const matches = await argon2.verify(user.refreshTokenHash, dto.refreshToken).catch(() => false);
    if (!matches) {
      // Eski (allaqachon aylantirilgan) token ishlatildi — reuse hujumi ehtimoli.
      // Sessiyani butunlay bekor qilamiz.
      user.refreshTokenHash = null;
      await this.userRepository.save(user);
      this.logger.warn(`Refresh token reuse aniqlandi: user=${user.id}`);
      throw AppException.unauthorized('Refresh token allaqachon ishlatilgan — qaytadan kiring');
    }
    const tokens = await this.issueTokens(user);
    await this.userRepository.save(user);
    return tokens;
  }

  async logout(userId: string) {
    await this.userRepository.update({ id: userId }, { refreshTokenHash: null });
    return { ok: true };
  }

  // ---------- Me ----------

  async me(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw AppException.unauthorized('Foydalanuvchi topilmadi');
    const employee = await this.employeeRepository.findOne({
      where: { userId },
      relations: { branch: true },
    });
    const company = user.companyId
      ? await this.companyRepository.findOne({
          where: { id: user.companyId },
          relations: { tariff: true },
        })
      : null;
    return {
      user: await this.toPublicUser(user),
      employee: employee ?? undefined,
      company: company ?? undefined,
    };
  }

  // ---------- Email verification / parol tiklash ----------

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: dto.token },
    });
    if (!user) throw AppException.validation('Tasdiqlash havolasi yaroqsiz yoki eskirgan');
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    await this.userRepository.save(user);
    return { ok: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase(), deletedAt: IsNull() },
    });
    if (user && user.isActive) {
      user.passwordResetToken = generateUrlToken();
      user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await this.userRepository.save(user);
      await this.mailService.sendPasswordResetEmail(user.email, user.username, user.passwordResetToken);
    }
    // Email mavjudligini oshkor qilmaymiz
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { passwordResetToken: dto.token, passwordResetExpiresAt: MoreThan(new Date()) },
    });
    if (!user) throw AppException.validation('Parol tiklash havolasi yaroqsiz yoki eskirgan');
    user.passwordHash = await argon2.hash(dto.password);
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    user.refreshTokenHash = null; // barcha sessiyalarni tugatamiz
    await this.userRepository.save(user);
    return { ok: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw AppException.unauthorized('Foydalanuvchi topilmadi');
    const ok = await argon2.verify(user.passwordHash, dto.currentPassword).catch(() => false);
    if (!ok) throw AppException.validation('Joriy parol noto‘g‘ri');
    user.passwordHash = await argon2.hash(dto.newPassword);
    user.refreshTokenHash = null;
    await this.userRepository.save(user);
    return { ok: true };
  }

  // ---------- Yordamchilar ----------

  /**
   * Foydalanuvchining effektiv permissionlarini hisoblaydi:
   * - SUPERADMIN / COMPANY_OWNER → ['*'] (cheksiz)
   * - custom roleId bor → shu Role.permissions
   * - aks holda → enum rol fallback (roleId'siz eski userlar)
   */
  private async computePermissions(user: User): Promise<string[]> {
    if (user.role === UserRole.SUPERADMIN || user.role === UserRole.COMPANY_OWNER) {
      return ['*'];
    }
    if (user.roleId) {
      const role = await this.roleRepository.findOne({ where: { id: user.roleId } });
      if (role) return role.permissions;
    }
    return ROLE_PERMISSIONS[user.role].map((p) => p as string);
  }

  /** Token juftligini yaratadi va user.refreshTokenHash'ni yangilaydi (saqlash chaqiruvchida) */
  async issueTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const permissions = await this.computePermissions(user);
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        companyId: user.companyId,
        permissions,
        type: 'access',
      },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
      },
    );
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, type: 'refresh', jti: generateUrlToken(16) },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
      },
    );
    user.refreshTokenHash = await argon2.hash(refreshToken);
    return { accessToken, refreshToken };
  }

  async toPublicUser(user: User) {
    let roleName: string | null = null;
    if (user.roleId) {
      const role = await this.roleRepository.findOne({ where: { id: user.roleId } });
      roleName = role?.name ?? null;
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      companyId: user.companyId,
      roleId: user.roleId ?? null,
      roleName,
      avatarUrl: user.avatarUrl,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt: user.lastLoginAt,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }

  private async assertUserUnique(username: string, email: string, phone: string): Promise<void> {
    const conflicts: string[] = [];
    if (await this.userRepository.exists({ where: { username: username.toLowerCase() } })) {
      conflicts.push('username');
    }
    if (await this.userRepository.exists({ where: { email: email.toLowerCase() } })) {
      conflicts.push('email');
    }
    if (await this.userRepository.exists({ where: { phone } })) {
      conflicts.push('phone');
    }
    if (conflicts.length > 0) {
      throw AppException.conflict(`Quyidagi maydonlar allaqachon band: ${conflicts.join(', ')}`, {
        fields: conflicts,
      });
    }
  }

  private async generateUniqueSlug(name: string, repo: Repository<Company>): Promise<string> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = slugWithSuffix(base, attempt);
      if (!(await repo.exists({ where: { slug: candidate } }))) {
        return candidate;
      }
    }
    return `${base}-${Date.now()}`;
  }
}
