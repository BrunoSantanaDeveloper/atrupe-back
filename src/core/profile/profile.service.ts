import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AddEmployeeOnProfileDto,
  CreateProfileDto,
} from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

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

  async findAll(filter: BaseFilterDTO) {
    const where = {
      isActive: true,
      ...(filter.companyId && { companyId: filter.companyId }),
    };

    const [total, profiles] = await Promise.all([
      this.prisma.sellerProfile.count({
        where: where,
      }),
      this.prisma.sellerProfile.findMany({
        where: where,
        include: {
          employees: {
            select: {
              user: {
                select: {
                  name: true,
                  avatar: true,
                },
              },
              role: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
        orderBy: {
          name: 'asc',
        },
      }),
    ]);

    const mappedProfiles = profiles.map((profile) => ({
      profile,
      employees: profile.employees.map((employee) => ({
        id: employee.role.id,
        avatar: employee.user.avatar,
        name: employee.user.name,
        role: employee.role.name,
      })),
    }));

    const lastPage = Math.ceil(total / +filter.limit);

    return {
      total,
      lastPage,
      profiles: mappedProfiles,
    };
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
    if (employes.length === 0) {
      throw new NotFoundException('No employees found');
    }
    const data = employes.map((employee) => {
      return { id: employee.id, name: employee.user.name };
    });
    return data;
  }

  async removeEmployee(employeeId: string) {
    try {
      return await this.prisma.employee.update({
        where: { id: employeeId },
        data: { sellerProfileId: null },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
  async addEmployee(profileId: string, dto: AddEmployeeOnProfileDto) {
    const { employeeId } = dto;
    try {
      return await this.prisma.employee.update({
        where: { id: employeeId },
        data: { sellerProfileId: profileId },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
