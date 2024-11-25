import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileFilterDTO } from './dto/filter.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProfileDto: CreateProfileDto) {
    return this.prisma.sellerProfile.create({
      data: {
        ...createProfileDto,
      },
    });
  }

  findAll(filter: ProfileFilterDTO) {
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

    return this.prisma.sellerProfile.findMany({
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
    return this.prisma.sellerProfile.findUnique({
      where: {
        id: id,
      },
    });
  }

  async update(id: string, updateProfileDto: UpdateProfileDto) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { id },
    });

    if (!profile) {
      throw new NotFoundException(`Profile with id ${id} not found`);
    }

    return await this.prisma.sellerProfile.update({
      where: { id },
      data: updateProfileDto,
    });
  }

  remove(id: string) {
    return this.prisma.sellerProfile.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listEmployees(companyId) {
    const employes = await this.prisma.employee.findMany({
      where: {
        sellerProfileId: null,
        companyId: companyId,
      },
      select: {
        id: true,
        user: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        user: {
          name: 'asc',
        },
      },
    });

    const data = employes.map((employee) => {
      return { id: employee.id, name: employee.user.name };
    });
    return data;
  }

  async removeEmployee(employeeId: string) {
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { sellerProfileId: null },
    });
  }
  async addEmployee(profileId: string, employeeId: string) {
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { sellerProfileId: profileId },
    });
  }
}
