import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterEmployeeDto } from './dto/filter-employee.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createEmployeeDto: CreateEmployeeDto) {
    try {
      return await this.prisma.employee.create({
        data: {
          name: createEmployeeDto.name,
          avatarUrl: createEmployeeDto.avatarUrl ?? null,
          signatureUrl: createEmployeeDto.signatureUrl ?? null,
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
      throw new BadRequestException(error.message);
    }
  }

  async findAllQuantity(companyId: string) {
    const result = await this.prisma.employee.groupBy({
      by: ['isActive'],
      where: { companyId },
      _count: true,
    });

    // Inicializa os contadores com zero
    const statusCount = {
      actives: 0,
      inactives: 0,
    };

    // Mapeia os resultados para os contadores
    result.forEach((cur) => {
      if (cur.isActive) {
        statusCount.actives = cur._count;
      } else {
        statusCount.inactives = cur._count;
      }
    });

    // Calcula o total
    const total = statusCount.actives + statusCount.inactives;

    return {
      ACTIVES: statusCount.actives,
      INACTIVES: statusCount.inactives,
      TOTAL: total,
    };
  }

  async findAll(filter: FilterEmployeeDto) {
    try {
      const where: Prisma.EmployeeWhereInput = {
        companyId: filter.companyId,
      };

      if (filter.search) {
        where.name = {
          contains: filter.search,
          mode: 'insensitive',
        };
      }

      if (filter.sectorId) {
        where.sectorId = filter.sectorId;
      }

      if (filter.isActive !== undefined) {
        where.isActive = filter.isActive;
      }

      const [total, employees] = await Promise.all([
        this.prisma.employee.count({ where }),
        this.prisma.employee.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
              },
            },
            address: true,
            role: true,
            sector: true,
          },
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: {
            name: 'asc',
          },
        }),
      ]);

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
      const lastPage = Math.ceil(total / +filter.limit);

      return {
        total,
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

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto) {
    const { isActive, address, ...rest } = updateEmployeeDto;

    return this.prisma.$transaction(async (tx) => {
      // Atualiza os dados do Employee
      const employeeUpdate = await tx.employee.update({
        where: { id },
        data: {
          ...rest,
          isActive,
        },
      });

      // Verifica se o campo isActive foi enviado
      if (isActive !== undefined) {
        const employee = await tx.employee.findUnique({
          where: { id },
          select: { userId: true },
        });

        // Desativa o usuário associado se isActive for false
        if (!isActive && employee?.userId) {
          await tx.user.update({
            where: { id: employee.userId },
            data: { isActive: false },
          });
        }
      }

      // Gerenciamento de endereços
      if (address) {
        // Verifica se o Employee já possui endereços associados
        const existingAddresses = await tx.address.findMany({
          where: { employeeId: id },
        });

        // Exclui os endereços existentes, se houver
        if (existingAddresses.length > 0) {
          await tx.address.deleteMany({
            where: { employeeId: id },
          });
        }

        // Cria os novos endereços fornecidos no DTO
        const newAddresses = Array.isArray(address) ? address : [address];
        for (const address of newAddresses) {
          await tx.address.create({
            data: {
              ...address,
              ownerType: 'EMPLOYEE',
              employeeId: id,
            },
          });
        }
      }

      return employeeUpdate;
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (employee?.userId) {
        await tx.user.update({
          where: { id: employee.userId },
          data: { isActive: false },
        });
      }

      return await tx.employee.update({
        where: { id },
        data: {
          isActive: false,
        },
      });
    });
  }
}
