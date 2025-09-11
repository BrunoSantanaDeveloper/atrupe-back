import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateSalaryControlDto } from './dto/create-salary-control.dto';
import { FilterSalaryControlDto } from './dto/filter-salary-control.dto';
import { UpdateSalaryControlDto } from './dto/update-salary-control.dto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class SalariesService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: FilterSalaryControlDto) {
    try {
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 10;
      const skip = (page - 1) * limit;

      const whereConditions: Prisma.EmployeeWhereInput[] = [
        { companyId: filters.companyId },
        { isActive: true },
      ];

      // Add name filter if search or employeeName is provided
      if (filters.search) {
        whereConditions.push({
          name: {
            contains: filters.search,
            mode: 'insensitive',
          },
        });
      }

      if (filters.employeeId) {
        whereConditions.push({
          id: filters.employeeId,
        });
      }

      // Add sector filter if sectorId is provided
      if (filters.sectorId) {
        whereConditions.push({
          sector: {
            id: filters.sectorId,
          },
        });
      }

      if (filters.costType) {
        whereConditions.push({
          SalaryControl: {
            some: {
              type: filters.costType,
            },
          },
        });
      }
      const whereSalaryControl: Prisma.SalaryControlWhereInput = {};
      if (filters.costType) {
        whereSalaryControl.type = filters.costType;
      }

      const where: Prisma.EmployeeWhereInput = {
        AND: whereConditions,
      };

      const [employees, total] = await Promise.all([
        this.prisma.employee.findMany({
          where,
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
            role: {
              select: {
                id: true,
                name: true,
              },
            },
            SalaryControl: {
              select: {
                id: true,
                reference: true,
                amount: true,
                date: true,
                type: true,
                isSet: true,
                createdAt: true,
                updatedAt: true,
              },
              where: whereSalaryControl,
              orderBy: {
                date: 'desc',
              },
            },
          },
          skip,
          take: limit,
          orderBy: {
            name: 'asc',
          },
        }),
        this.prisma.employee.count({ where }),
      ]);
      const data = employees.map((employee) => {
        // Sort salary control items
        const sortedItems = [...employee.SalaryControl].sort((a, b) => {
          const baseSalaryReferences = [
            'Salário base',
            'Salario base',
            'Salário',
            'Salario',
          ];
          const aIsBase = baseSalaryReferences.includes(a.reference);
          const bIsBase = baseSalaryReferences.includes(b.reference);

          if (aIsBase && !bIsBase) return -1;
          if (!aIsBase && bIsBase) return 1;
          return 0;
        });

        return {
          id: employee.id,
          name: employee.name,
          avatarUrl: employee.avatarUrl,
          sectorId: employee.sector.id,
          roleId: employee.role.id,
          sectorName: employee.sector.name,
          roleName: employee.role.name,
          items: sortedItems,
        };
      });
      return {
        total,
        totalPages: Math.ceil(total / limit),
        data,
      };
    } catch (error) {
      console.error('Error in findAll:', error);
      throw new BadRequestException(
        'Error fetching employees with salary controls: ' + error.message,
      );
    }
  }

  async create(createSalaryControlDto: CreateSalaryControlDto) {
    try {
      // Buscar todos os funcionários ativos da empresa
      const employees = await this.prisma.employee.findMany({
        where: {
          companyId: createSalaryControlDto.companyId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (employees.length === 0) {
        throw new BadRequestException(
          'No active employees found in the company',
        );
      }

      // Determinar se isSet deve ser true ou false baseado no valor
      const isSet = createSalaryControlDto.amount > 0;

      // Criar salary controls para todos os funcionários
      const createdSalaryControls = await Promise.all(
        employees.map(async (employee) => {
          return await this.prisma.salaryControl.create({
            data: {
              reference: createSalaryControlDto.reference,
              amount: createSalaryControlDto.amount,
              date: new Date(),
              companyId: createSalaryControlDto.companyId,
              type: createSalaryControlDto.type,
              employeeId: employee.id,
              isSet: isSet,
            },
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  sector: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          });
        }),
      );

      return {
        message: `Successfully created salary control for ${employees.length} employees`,
        createdCount: employees.length,
        employees: employees.map((emp) => ({ id: emp.id, name: emp.name })),
        salaryControls: createdSalaryControls,
      };
    } catch (error) {
      console.error(error);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(
            'A salary control with this reference already exists for some employees',
          );
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid company reference');
        }
      }
      throw new BadRequestException(
        'Error creating salary control: ' + error.message,
      );
    }
  }

  async update(id: string, updateSalaryControlDto: UpdateSalaryControlDto) {
    try {
      const salaryControl = await this.prisma.salaryControl.findUnique({
        where: { id },
      });

      if (!salaryControl) {
        throw new NotFoundException(`Salary control with ID ${id} not found`);
      }

      const updateData: Prisma.SalaryControlUpdateInput = {};

      // Only update fields that are provided
      if (updateSalaryControlDto.reference !== undefined) {
        updateData.reference = updateSalaryControlDto.reference;
      }

      if (updateSalaryControlDto.amount !== undefined) {
        updateData.amount = updateSalaryControlDto.amount;
        // Se amount foi fornecido, calcular isSet automaticamente
        updateData.isSet = updateSalaryControlDto.amount > 0;
      } else if (updateSalaryControlDto.isSet !== undefined) {
        // Se amount não foi fornecido mas isSet foi, usar o valor fornecido
        updateData.isSet = updateSalaryControlDto.isSet;
      }

      if (updateSalaryControlDto.date !== undefined) {
        updateData.date = new Date(updateSalaryControlDto.date);
      }
      if (updateSalaryControlDto.type !== undefined) {
        updateData.type = updateSalaryControlDto.type;
      }
      if (updateSalaryControlDto.employeeId !== undefined) {
        updateData.employee = {
          connect: {
            id: updateSalaryControlDto.employeeId,
          },
        };
      }

      // Always update the updatedAt timestamp
      updateData.updatedAt = new Date();

      return await this.prisma.salaryControl.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            include: {
              sector: true,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(
            'A salary control with this reference already exists',
          );
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid employee reference');
        }
      }
      throw new BadRequestException(
        'Error updating salary control: ' + error.message,
      );
    }
  }

  async getSalaryDetails(id: string) {
    try {
      const salaryControl = await this.prisma.salaryControl.findUnique({
        where: { id },
        include: {
          employee: {
            include: {
              sector: true,
            },
          },
        },
      });

      if (!salaryControl) {
        throw new NotFoundException(`Salary control with ID ${id} not found`);
      }

      return salaryControl;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        'Error fetching salary details: ' + error.message,
      );
    }
  }

  async delete(id: string) {
    try {
      const salaryControl = await this.prisma.salaryControl.findUnique({
        where: { id },
      });

      if (!salaryControl) {
        throw new NotFoundException(`Salary control with ID ${id} not found`);
      }

      await this.prisma.salaryControl.delete({
        where: { id },
      });

      return {
        message: 'Salary control deleted successfully',
        id,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        'Error deleting salary control: ' + error.message,
      );
    }
  }
}
