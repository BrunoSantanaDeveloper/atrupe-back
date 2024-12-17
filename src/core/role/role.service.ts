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

  findAll(filter: RoleFilterDTO) {
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

    return this.prisma.role.findMany({
      where: where,
      include: {
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
