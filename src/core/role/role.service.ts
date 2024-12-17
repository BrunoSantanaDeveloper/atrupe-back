import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePolicyDto, CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaService } from 'nestjs-prisma';
import { RoleFilterDTO } from './dto/filter.dto';

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

  async createPolicyAndLinkToRole(
    createPolicyDto: CreatePolicyDto,
    roleId: string,
  ) {
    const role = await this.prisma.role.findUnique({
      where: {
        id: roleId,
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const { resource, actions } = createPolicyDto;

    // Criação da Policy
    const policy = await this.prisma.policy.create({
      data: {
        name: resource, // Nome da Policy será o nome do resource
        definition: {
          resource: resource,
          actions: actions,
        },
      },
    });

    // Vincula a policy à role
    await this.prisma.rolePolicy.create({
      data: {
        roleId: roleId,
        policyId: policy.id,
      },
    });

    return policy;
  }

  async findAll(filter: RoleFilterDTO) {
    let where = {};
    if (filter.companyId) {
      where = {
        companyId: filter.companyId,
      };
    }

    if (filter.sectorId) {
      where = {
        ...where,
        sectorId: filter.sectorId,
      };
    }

    // Primeiro, vamos buscar o total de registros para calcular a paginação
    const total = await this.prisma.role.count({ where });
    const lastPage = Math.ceil(total / +filter.limit);

    // Buscar as roles com os setores relacionados
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
      const sectorId = role.sector.id;

      if (!acc[sectorId]) {
        acc[sectorId] = {
          sector: {
            id: role.sector.id,
            name: role.sector.name,
          },
          roles: [],
        };
      }

      // Remove o campo sector antes de adicionar ao array de roles
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
  }

  findOne(id: string) {
    return this.prisma.role.findUnique({
      where: {
        id: id,
      },
      include: {
        rolePolicy: true,
      },
    });
  }

  update(id: number, updateRoleDto: UpdateRoleDto) {
    return `This action updates a #${id} role with ${updateRoleDto}`;
  }

  remove(id: string) {
    return this.prisma.role.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
