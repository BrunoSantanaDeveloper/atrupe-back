import { Injectable } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PrismaService } from 'nestjs-prisma';
import * as argon2 from 'argon2';
import { StringHelper } from 'src/helpers/string/random';

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

  async findAll() {
    const employees = await this.prisma.employee.findMany({
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
    });

    const groupedBySector = employees.reduce((acc, employee) => {
      const sectorId = employee.sector.id;
      if (!acc[sectorId]) {
        acc[sectorId] = { sector: employee.sector, employees: [] };
      }
      acc[sectorId].employees.push(employee);

      return acc;
    }, {});

    const result = Object.values(groupedBySector);

    return {
      data: result,
      total: employees.length,
    };
  }

  findOne(id: number) {
    return `This action returns a #${id} employee`;
  }

  update(id: number, updateEmployeeDto: UpdateEmployeeDto) {
    return `This action updates a #${id} employee` + updateEmployeeDto;
  }

  remove(id: number) {
    return `This action removes a #${id} employee`;
  }
}
