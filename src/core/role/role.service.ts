import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaService } from 'nestjs-prisma';
import { RoleFilterDTO } from './dto/filter.dto';
import { Prisma, Role } from '@prisma/client';

/** Quem grava o cargo: o usuário da sessão (`req.user`). */
export type RoleActor = {
  companyId: string;
  role?: string;
  isAdmin?: boolean;
  isSystemAdmin?: boolean;
};

const ROLE_NOT_FOUND = 'Cargo não encontrado.';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createRoleDto: CreateRoleDto, actor: RoleActor) {
    await this.assertWildcardAllowed(createRoleDto.permissions, actor);
    await this.assertSectorOfCompany(
      createRoleDto.sectorId,
      createRoleDto.companyId,
    );

    return this.prisma.role.create({
      data: {
        ...createRoleDto,
      },
    });
  }

  async findAll(filter: RoleFilterDTO) {
    let where: Prisma.RoleWhereInput = {
      isActive: true,
    };
    if (filter.companyId) {
      where = {
        ...where,
        companyId: filter.companyId,
      };
    }

    if (filter.sectorId) {
      where = {
        ...where,
        sectorId: filter.sectorId,
      };
    }

    if (filter.search) {
      where = {
        ...where,
        name: {
          contains: filter.search,
          mode: 'insensitive',
        },
      };
    }

    // Primeiro, vamos buscar o total de registros para calcular a paginação
    const total = await this.prisma.role.count({ where });
    const lastPage = Math.ceil(total / +filter.limit);

    // Buscar as roles com os setores relacionados
    try {
      const roles = await this.prisma.role.findMany({
        where,
        include: {
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
          employees: {
            select: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
      });

      // Agrupar as roles por setor
      const rolesBySector = roles.reduce((acc, role) => {
        // Handle roles without sector (sectorId is nullable)
        const sectorId = role.sector?.id || 'no-sector';

        if (!acc[sectorId]) {
          acc[sectorId] = {
            sector: role.sector
              ? {
                  id: role.sector.id,
                  name: role.sector.name,
                }
              : {
                  id: 'no-sector',
                  name: 'Sem Setor',
                },
            roles: [],
          };
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sector, ...roleWithoutSector } = role;
        acc[sectorId].roles.push(roleWithoutSector);

        return acc;
      }, {});

      return {
        total,
        lastPage,
        data: Object.values(rolesBySector),
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error fetching roles');
    }
  }

  /**
   * Toda operação por id confere a empresa da sessão: sem isso, um id de
   * outra empresa era lido, alterado ou desativado. O id de outra empresa
   * responde 404, como um id que não existe.
   */
  async findOne(id: string, companyId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId },
    });

    if (!role) {
      throw new NotFoundException(ROLE_NOT_FOUND);
    }

    return role;
  }

  async update(id: string, updateRoleDto: UpdateRoleDto, actor: RoleActor) {
    const role = await this.findOne(id, actor.companyId);
    this.assertNotAdminRole(role);
    await this.assertWildcardAllowed(updateRoleDto.permissions, actor);
    await this.assertSectorOfCompany(updateRoleDto.sectorId, actor.companyId);

    try {
      return await this.prisma.role.update({
        where: { id },
        data: {
          ...updateRoleDto,
        },
      });
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error updating role');
    }
  }

  async remove(id: string, companyId: string) {
    const role = await this.findOne(id, companyId);
    this.assertNotAdminRole(role);

    return this.prisma.$transaction(async (tx) => {
      // O titular da conta é sempre administrador: o cargo dele não sai
      // debaixo dele.
      const members = await tx.employee.findMany({
        where: { roleId: id, userId: { not: null } },
        select: { userId: true, company: { select: { ownerUserId: true } } },
      });
      if (members.some((m) => m.userId === m.company?.ownerUserId)) {
        throw new UnprocessableEntityException({
          code: 'OWNER_ROLE',
          message:
            'Este é o cargo do titular da conta, que é sempre administrador, e não pode ser excluído.',
        });
      }

      // Atualiza os employees
      await tx.employee.updateMany({
        where: {
          roleId: id,
          companyId,
        },
        data: {
          roleId: null,
        },
      });

      // Desativa o cargo
      const role = await tx.role.update({
        where: { id },
        data: { isActive: false },
      });

      return role;
    });
  }

  /**
   * O cargo de administrador passa em toda permissão sem olhar a lista; a
   * tela de cargos não deixa editar nem excluir. A API segue a tela.
   */
  private assertNotAdminRole(role: Pick<Role, 'isAdmin'>) {
    if (role.isAdmin) {
      throw new UnprocessableEntityException({
        code: 'ADMIN_ROLE',
        message: 'O cargo de administrador não pode ser alterado nem excluído.',
      });
    }
  }

  /**
   * `'*'` vale todas as permissões, como o cargo de administrador. Só quem já
   * tem esse acesso pode concedê-lo: sem a regra, quem edita cargos
   * transformava qualquer cargo, o próprio inclusive, em administrador. A
   * tela de cargos não grava `'*'`.
   */
  private async assertWildcardAllowed(
    permissions: string[] | undefined,
    actor: RoleActor,
  ) {
    if (!permissions?.includes('*')) return;
    if (actor.isSystemAdmin || actor.isAdmin) return;

    const own = actor.role
      ? await this.prisma.role.findUnique({
          where: { id: actor.role },
          select: { isAdmin: true, permissions: true },
        })
      : null;
    if (own?.isAdmin || own?.permissions?.includes('*')) return;

    throw new ForbiddenException({
      code: 'ROLE_WILDCARD_ADMIN_ONLY',
      message: 'Só um administrador pode dar acesso total a um cargo.',
    });
  }

  /** O setor do cargo é da mesma empresa. */
  private async assertSectorOfCompany(
    sectorId: string | null | undefined,
    companyId: string,
  ) {
    if (!sectorId) return;

    const sector = await this.prisma.companySector.findFirst({
      where: { id: sectorId, companyId },
      select: { id: true },
    });
    if (!sector) {
      throw new NotFoundException('Setor não encontrado.');
    }
  }
}
