import { Injectable } from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaService } from 'nestjs-prisma';
import { RoleFilterDTO } from './dto/filter.dto';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  create(createRoleDto: CreateRoleDto) {
    return this.prisma.role.create({
      data: {
        ...createRoleDto,
      },
    });
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

  remove(id: number) {
    return `This action removes a #${id} role`;
  }
}
