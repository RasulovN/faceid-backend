import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Role } from '../../entities/role.entity';
import { User } from '../../entities/user.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { DEFAULT_ROLES } from '../../common/constants/default-roles';
import { PERMISSION_CATALOG, PermissionGroup } from './permission-catalog';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dtos';

export interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
}

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  /** UI uchun guruhlangan permission katalogi. */
  getPermissionCatalog(): readonly PermissionGroup[] {
    return PERMISSION_CATALOG;
  }

  async list(companyId: string): Promise<RoleDto[]> {
    const roles = await this.roleRepository.find({
      where: { companyId },
      order: { isSystem: 'DESC', name: 'ASC' },
    });
    return Promise.all(roles.map((role) => this.toDto(role)));
  }

  async create(companyId: string, dto: CreateRoleDto): Promise<RoleDto> {
    const exists = await this.roleRepository.exists({ where: { companyId, name: dto.name } });
    if (exists) throw AppException.conflict('Bu nomli rol allaqachon mavjud');
    const role = await this.roleRepository.save(
      this.roleRepository.create({
        companyId,
        name: dto.name,
        description: dto.description ?? null,
        permissions: [...new Set(dto.permissions)],
        isSystem: false,
      }),
    );
    return this.toDto(role);
  }

  async update(companyId: string, id: string, dto: UpdateRoleDto): Promise<RoleDto> {
    const role = await this.getEntity(companyId, id);
    if (dto.name !== undefined && dto.name !== role.name) {
      if (role.isSystem) {
        throw AppException.forbidden('Tizim rolining nomini o‘zgartirib bo‘lmaydi');
      }
      const dup = await this.roleRepository.exists({
        where: { companyId, name: dto.name, id: Not(id) },
      });
      if (dup) throw AppException.conflict('Bu nomli rol allaqachon mavjud');
      role.name = dto.name;
    }
    if (dto.description !== undefined) role.description = dto.description ?? null;
    if (dto.permissions !== undefined) role.permissions = [...new Set(dto.permissions)];
    return this.toDto(await this.roleRepository.save(role));
  }

  async remove(companyId: string, id: string): Promise<{ ok: boolean }> {
    const role = await this.getEntity(companyId, id);
    if (role.isSystem) throw AppException.forbidden('Tizim rolini o‘chirib bo‘lmaydi');
    const userCount = await this.userRepository.count({ where: { roleId: id } });
    if (userCount > 0) {
      throw AppException.conflict(
        `Bu rolga ${userCount} ta foydalanuvchi biriktirilgan. Avval ularni boshqa rolga o‘tkazing.`,
      );
    }
    await this.roleRepository.remove(role);
    return { ok: true };
  }

  /** Rol shu kompaniyaga tegishli ekanini tekshiradi (users servisidan ishlatiladi). */
  async assertBelongsToCompany(companyId: string, roleId: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id: roleId, companyId } });
    if (!role) throw AppException.validation('Tanlangan rol kompaniyaga tegishli emas');
    return role;
  }

  /** Company yaratilganda default (isSystem) rollarni idempotent seed qiladi. */
  async seedDefaultRoles(companyId: string): Promise<void> {
    for (const def of DEFAULT_ROLES) {
      const exists = await this.roleRepository.exists({
        where: { companyId, name: def.name },
      });
      if (exists) continue;
      await this.roleRepository.save(
        this.roleRepository.create({
          companyId,
          name: def.name,
          description: def.description,
          permissions: [...def.permissions],
          isSystem: true,
        }),
      );
    }
  }

  private async getEntity(companyId: string, id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id, companyId } });
    if (!role) throw AppException.notFound('Rol topilmadi');
    return role;
  }

  private async toDto(role: Role): Promise<RoleDto> {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isSystem: role.isSystem,
      userCount: await this.userRepository.count({ where: { roleId: role.id } }),
    };
  }
}
