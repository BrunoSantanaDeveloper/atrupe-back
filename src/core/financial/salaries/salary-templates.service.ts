import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
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
    return this.prisma.salaryTemplate.create({
      data: { name, type, defaultAmount, companyId },
    });
  }

  async getCompanyTemplates(companyId: string) {
    return this.prisma.salaryTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async applyTemplateToAllEmployees(templateId: string) {
    const template = await this.prisma.salaryTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) throw new NotFoundException('Template not found');

    const employees = await this.prisma.employee.findMany({
      where: { companyId: template.companyId },
      // Removido isActive: true - aplica a TODOS os employees
    });

    return Promise.all(
      employees.map((employee) =>
        this.prisma.salaryControl.create({
          data: {
            reference: template.name, // Usando reference por enquanto
            type: template.type,
            amount: template.defaultAmount, // Valor padrão do template
            isSet: template.defaultAmount > 0, // Ativo se tem valor padrão
            employeeId: employee.id,
            companyId: template.companyId,
            templateId: template.id, // Relacionamento com template
            date: new Date(),
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
        const exists = await this.prisma.salaryControl.findFirst({
          where: {
            employeeId,
            reference: template.name,
            type: template.type,
          },
        });

        if (!exists) {
          return this.prisma.salaryControl.create({
            data: {
              reference: template.name, // Usando reference por enquanto
              type: template.type,
              amount: template.defaultAmount, // Valor padrão do template
              isSet: template.defaultAmount > 0, // Ativo se tem valor padrão
              date: new Date(),
              companyId,
              employeeId,
              templateId: template.id, // Relacionamento com template
            },
          });
        }
      }),
    );
  }
}
