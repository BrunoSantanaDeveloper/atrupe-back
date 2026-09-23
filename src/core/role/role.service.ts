import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaService } from 'nestjs-prisma';
import { RoleFilterDTO } from './dto/filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createRoleDto: CreateRoleDto) {
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

  findOne(id: string) {
    return this.prisma.role.findUnique({
      where: {
        id: id,
      },
    });
  }

  async update(id: string, updateRoleDto: UpdateRoleDto) {
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
  async remove(id: string) {
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
}
