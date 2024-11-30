import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PrismaService } from 'nestjs-prisma';
import * as argon2 from 'argon2';
import { StringHelper } from 'src/helpers/string/random';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createEmployeeDto: CreateEmployeeDto) {
    try {
      const hashedPassword = await argon2.hash(
        StringHelper.generateRandomString(8),
      );
      return await this.prisma.employee.create({
        data: {
          sallary: parseFloat(createEmployeeDto.sallary),
          user: {
            create: {
              name: createEmployeeDto.name,
              email: createEmployeeDto.email,
              password: hashedPassword,
            },
          },
          role: {
            connect: {
              id: createEmployeeDto.roleId,
            },
          },
          sector: {
            connect: {
              id: createEmployeeDto.sectorId,
            },
          },
          company: {
            connect: {
              id: createEmployeeDto.companyId,
            },
          },
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  async findAll(filter: BaseFilterDTO) {
    console.log(filter);
    try {
      const totalEmployees = await this.prisma.employee.count({
        where: {
          companyId: filter.companyId,
        },
      });

      const employees = await this.prisma.employee.findMany({
        where: {
          companyId: filter.companyId,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          role: true,
          sector: true,
        },
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
        orderBy: {
          user: {
            name: 'asc',
          },
        },
      });
      const groupedBySector = employees.reduce(
        (acc, employee) => {
          const sectorId = employee.sector?.id || 'no-sector'; // Agrupar os sem setor na chave 'no-sector'

          if (!acc[sectorId]) {
            acc[sectorId] = {
              sector: employee.sector
                ? employee.sector
                : { id: 'no-sector', name: 'Sem Setor' },
              employees: [],
            };
          }
          acc[sectorId].employees.push(employee);

          return acc;
        },
        {} as {
          [key: string]: {
            sector: { id: string; name: string };
            employees: any[];
          };
        },
      );

      // Organizar a resposta para garantir que "Sem Setor" apareça por último
      const result = Object.values(groupedBySector).sort((a, b) => {
        // Garantir que 'a' e 'b' tenham a propriedade 'sector' corretamente tipada
        if (a.sector.name === 'Sem Setor') return 1;
        if (b.sector.name === 'Sem Setor') return -1;
        return 0;
      });
      const lastPage = Math.ceil(totalEmployees / +filter.limit);

      return {
        total: totalEmployees,
        lastPage,
        data: result,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  findOne(id: number) {
    return `This action returns a #${id} employee`;
  }

  update(id: number, updateEmployeeDto: UpdateEmployeeDto) {
    return `This action updates a #${id} employee` + updateEmployeeDto;
  }

  async remove(id: string) {
    return await this.prisma.employee.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }
}
