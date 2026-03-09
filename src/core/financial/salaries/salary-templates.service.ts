import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ItemType } from '@prisma/client';

@Injectable()
export class SalaryTemplatesService {
  constructor(private prisma: PrismaService) {}

  async createTemplate(
    companyId: string,
    name: string,
    type: ItemType,
    defaultAmount: number = 0,
  ) {
    return this.prisma.payrollTemplate.create({
      data: { name, type, defaultAmount, companyId },
    });
  }

  async getCompanyTemplates(companyId: string) {
    return this.prisma.payrollTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async applyTemplateToAllEmployees(templateId: string) {
    const template = await this.prisma.payrollTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) throw new NotFoundException('Template not found');

    const employees = await this.prisma.employee.findMany({
      where: { companyId: template.companyId },
      // Removido isActive: true - aplica a TODOS os employees
    });

    return Promise.all(
      employees.map((employee) =>
        this.prisma.payrollSetup.create({
          data: {
            name: template.name,
            type: template.type,
            amount: template.defaultAmount || 0,
            isSet: true,
            employeeId: employee.id,
            companyId: template.companyId,
            templateId: template.id,
          },
        }),
      ),
    );
  }

  async applyTemplateToEmployee(employeeId: string, companyId: string) {
    const templates = await this.getCompanyTemplates(companyId);

    return Promise.all(
      templates.map(async (template) => {
        // Verificar se já existe para evitar duplicatas
        const exists = await this.prisma.payrollSetup.findFirst({
          where: {
            employeeId,
            name: template.name,
            type: template.type,
          },
        });

        if (!exists) {
          return this.prisma.payrollSetup.create({
            data: {
              name: template.name,
              type: template.type,
              amount: template.defaultAmount || 0,
              isSet: true,
              companyId,
              employeeId,
              templateId: template.id,
            },
          });
        }
      }),
    );
  }
}
