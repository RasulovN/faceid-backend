import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { AppException } from '../../common/exceptions/app.exception';
import { UserRole } from '../../common/enums';
import { User } from '../../entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    exists: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let config: { get: jest.Mock; getOrThrow: jest.Mock };

  const envValues: Record<string, string> = {
    JWT_ACCESS_SECRET: 'test_access_secret_test_access_secret',
    JWT_REFRESH_SECRET: 'test_refresh_secret_test_refresh_secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (u: unknown) => u),
      update: jest.fn(),
      exists: jest.fn(async () => false),
    };
    jwtService = {
      signAsync: jest.fn(async () => 'signed-token'),
      verifyAsync: jest.fn(),
    };
    config = {
      get: jest.fn((key: string) => envValues[key]),
      getOrThrow: jest.fn((key: string) => {
        if (!envValues[key]) throw new Error(`missing ${key}`);
        return envValues[key];
      }),
    };
    service = new AuthService(
      userRepository as any,
      {} as any, // companyRepository
      { findOne: jest.fn() } as any, // employeeRepository
      {} as any, // tariffRepository
      { findOne: jest.fn() } as any, // roleRepository
      {} as any, // dataSource
      jwtService as any,
      config as any,
      { sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() } as any, // mailService
      { seedDefaultRoles: jest.fn() } as any, // rolesService
      { seedDefaultRules: jest.fn() } as any, // rulesService
      { track: jest.fn() } as any, // usageTracker
    );
  });

  // ---------- identifier avtodetect ----------

  describe('detectIdentifier', () => {
    it('email ko‘rinishini aniqlaydi va kichik harfga o‘tkazadi', () => {
      expect(service.detectIdentifier('Aziz@Example.COM')).toEqual({
        kind: 'email',
        value: 'aziz@example.com',
      });
    });

    it('+998 telefon raqamini aniqlaydi', () => {
      expect(service.detectIdentifier('+998901234567')).toEqual({
        kind: 'phone',
        value: '+998901234567',
      });
    });

    it('998 bilan boshlangan raqamga + qo‘shadi', () => {
      expect(service.detectIdentifier('998901234567')).toEqual({
        kind: 'phone',
        value: '+998901234567',
      });
    });

    it('bo‘shliq va defisli telefonni normalizatsiya qiladi', () => {
      expect(service.detectIdentifier('+998 90 123-45-67')).toEqual({
        kind: 'phone',
        value: '+998901234567',
      });
    });

    it('boshqa hamma narsani username deb oladi', () => {
      expect(service.detectIdentifier('demo_user')).toEqual({
        kind: 'username',
        value: 'demo_user',
      });
    });
  });

  // ---------- login ----------

  describe('login', () => {
    it('to‘g‘ri parol bilan token juftligini qaytaradi', async () => {
      const user = {
        id: 'u1',
        username: 'demo',
        role: UserRole.COMPANY_OWNER,
        companyId: 'c1',
        isActive: true,
        passwordHash: await argon2.hash('Demo123!'),
      } as unknown as User;
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.login({ identifier: 'demo', password: 'Demo123!' });

      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(result.user.id).toBe('u1');
      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { username: 'demo' } });
      expect(userRepository.save).toHaveBeenCalled();
      expect(user.refreshTokenHash).toBeTruthy();
    });

    it('telefon identifier bilan phone ustunidan qidiradi', async () => {
      userRepository.findOne.mockResolvedValue(null);
      await expect(
        service.login({ identifier: '+998901234567', password: 'x' }),
      ).rejects.toBeInstanceOf(AppException);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { phone: '+998901234567' },
      });
    });

    it('noto‘g‘ri parolda UNAUTHORIZED tashlaydi', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'u1',
        isActive: true,
        passwordHash: await argon2.hash('boshqa-parol'),
      });
      await expect(
        service.login({ identifier: 'demo', password: 'Demo123!' }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('deaktiv foydalanuvchini kiritmaydi', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'u1',
        isActive: false,
        passwordHash: await argon2.hash('Demo123!'),
      });
      await expect(
        service.login({ identifier: 'demo', password: 'Demo123!' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  // ---------- refresh rotation ----------

  describe('refresh (rotation)', () => {
    it('yaroqli refresh token yangi juftlik bilan almashtiriladi', async () => {
      const oldToken = 'old-refresh-token';
      const user = {
        id: 'u1',
        username: 'demo',
        role: UserRole.COMPANY_OWNER,
        companyId: 'c1',
        isActive: true,
        refreshTokenHash: await argon2.hash(oldToken),
      } as unknown as User;
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', type: 'refresh', jti: 'j1' });
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.refresh({ refreshToken: oldToken });

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      // Hash yangi tokenga almashgan — endi eski token mos kelmaydi
      expect(await argon2.verify(user.refreshTokenHash!, oldToken)).toBe(false);
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('eski (allaqachon aylantirilgan) token ishlatilsa sessiya bekor qilinadi', async () => {
      const user = {
        id: 'u1',
        isActive: true,
        refreshTokenHash: await argon2.hash('yangi-token'),
      } as unknown as User;
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', type: 'refresh', jti: 'j1' });
      userRepository.findOne.mockResolvedValue(user);

      await expect(service.refresh({ refreshToken: 'eski-token' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      // Reuse aniqlanganda hash tozalanadi
      expect(user.refreshTokenHash).toBeNull();
      expect(userRepository.save).toHaveBeenCalledWith(user);
    });

    it('sessiyasi tugatilgan foydalanuvchi refresh qila olmaydi', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', type: 'refresh', jti: 'j1' });
      userRepository.findOne.mockResolvedValue({
        id: 'u1',
        isActive: true,
        refreshTokenHash: null,
      });
      await expect(service.refresh({ refreshToken: 'x' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('access tokenni refresh sifatida qabul qilmaydi', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', type: 'access' });
      await expect(service.refresh({ refreshToken: 'x' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });
});
