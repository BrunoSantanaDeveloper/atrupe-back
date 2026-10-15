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

const PROFILE_NOT_FOUND = 'Perfil de vendedor não encontrado.';
const EMPLOYEE_NOT_FOUND = 'Colaborador não encontrado.';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProfileDto: CreateProfileDto) {
    console.log(createProfileDto);
    try {
      return await this.prisma.sellerProfile.create({
        data: {
          ...createProfileDto,
        },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException(error.message);
    }
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
        select: {
          id: true,
          name: true,
          isActive: true,
          companyId: true,
          commission: true,
          maxDiscount: true,
          minValue: true,
          canApprovePreRegistration: true,
          canCancelSale: true,
          onlySendToCash: true,
          employees: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              avatarUrl: true,
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

    try {
      const mappedProfiles = profiles.map((profile) => ({
        profile: {
          id: profile.id,
          name: profile.name,
          isActive: profile.isActive,
          companyId: profile.companyId,
          commission: profile.commission,
          maxDiscount: profile.maxDiscount,
          minValue: profile.minValue,
          canApprovePreRegistration: profile.canApprovePreRegistration,
          canCancelSale: profile.canCancelSale,
          onlySendToCash: profile.onlySendToCash,
        },
        employees: profile.employees.map((employee) => ({
          id: employee.id,
          avatar: employee.avatarUrl
            ? employee.avatarUrl
            : employee.user?.avatar || '',
          name: employee.name ? employee.name : employee.user?.name || '',
          role: employee.role?.name || '',
        })),
      }));

      const lastPage = Math.ceil(total / +filter.limit);

      return {
        total,
        lastPage,
        profiles: mappedProfiles,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Toda operação por id confere a empresa da sessão: sem isso, um id de
   * outra empresa era lido, alterado ou removido. O id de outra empresa
   * responde 404, como um id que não existe.
   */
  async findOne(id: string, companyId: string) {
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { id, companyId },
    });

    if (!profile) {
      throw new NotFoundException(PROFILE_NOT_FOUND);
    }

    return profile;
  }

  async update(
    id: string,
    companyId: string,
    updateProfileDto: UpdateProfileDto,
  ) {
    await this.findOne(id, companyId);

    return await this.prisma.sellerProfile.update({
      where: { id },
      data: updateProfileDto,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);

    await this.prisma.employee.updateMany({
      where: { sellerProfileId: id, companyId },
      data: { sellerProfileId: null },
    });
    return await this.prisma.sellerProfile.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listEmployeesWithoutProfile(companyId) {
    const employes = await this.prisma.employee.findMany({
      where: {
        sellerProfileId: null,
        companyId: companyId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
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
      return [];
    }
    const data = employes.map((employee) => {
      return {
        id: employee.id,
        name: employee.name
          ? employee.name
          : employee.user
            ? employee.user.name
            : '',
      };
    });
    return data;
  }

  async removeEmployee(employeeId: string, companyId: string) {
    await this.findEmployee(employeeId, companyId);

    try {
      return await this.prisma.employee.update({
        where: { id: employeeId },
        data: { sellerProfileId: null },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async addEmployee(
    profileId: string,
    companyId: string,
    dto: AddEmployeeOnProfileDto,
  ) {
    const { employeeId } = dto;

    // O perfil precisa estar ativo: o removido não aparece na tela
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { id: profileId, companyId, isActive: true },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException(PROFILE_NOT_FOUND);
    }
    await this.findEmployee(employeeId, companyId);

    try {
      return await this.prisma.employee.update({
        where: { id: employeeId },
        data: { sellerProfileId: profileId },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  private async findEmployee(employeeId: string, companyId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException(EMPLOYEE_NOT_FOUND);
    }

    return employee;
  }
}
