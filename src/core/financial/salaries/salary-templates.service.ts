import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ItemType } from '@prisma/client';
import { UpdatePayrollTemplateDto } from './dto/update-payroll-template.dto';

// Referências criadas pelo seed da empresa como salário base da folha
const BASE_SALARY_REFERENCES = [
  'salário base',
  'salario base',
  'salário',
  'salario',
];

const isBaseSalary = (name: string, type: ItemType) =>
  type === ItemType.INCREASE &&
  BASE_SALARY_REFERENCES.includes(name.trim().toLowerCase());

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

  /**
   * Lista os itens de custo (templates) da empresa com a quantidade de
   * colaboradores ativos que ainda usam cada um deles.
   */
  async getCompanyTemplatesWithUsage(companyId: string) {
    const templates = await this.prisma.payrollTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });

    if (templates.length === 0) return [];

    const usage = await this.prisma.payrollSetup.groupBy({
      by: ['templateId', 'isSet'],
      where: {
        companyId,
        templateId: { in: templates.map((template) => template.id) },
        employee: { isActive: true },
      },
      _count: { _all: true },
    });

    const linkedByTemplate = new Map<string, number>();

    usage.forEach((group) => {
      if (!group.isSet) return;
      linkedByTemplate.set(group.templateId, group._count._all);
    });

    return templates.map((template) => {
      const linkedEmployees = linkedByTemplate.get(template.id) || 0;
      const isBase = isBaseSalary(template.name, template.type);

      return {
        id: template.id,
        name: template.name,
        type: template.type,
        defaultAmount: template.defaultAmount,
        createdAt: template.createdAt,
        isBase,
        linkedEmployees,
        canDelete: !isBase && linkedEmployees === 0,
      };
    });
  }

  /**
   * Renomeia (ou troca a operação de) um item de custo, propagando a mudança
   * para as linhas de todos os colaboradores.
   */
  async updateTemplate(
    companyId: string,
    templateId: string,
    dto: UpdatePayrollTemplateDto,
  ) {
    const template = await this.prisma.payrollTemplate.findFirst({
      where: { id: templateId, companyId },
    });

    if (!template) throw new NotFoundException('Item de custo não encontrado.');

    const name = dto.name?.trim() || template.name;
    const type = dto.type || template.type;

    if (!name) {
      throw new BadRequestException('Informe a referência do item de custo.');
    }

    if (name !== template.name || type !== template.type) {
      const duplicated = await this.prisma.payrollTemplate.findFirst({
        where: { companyId, name, type, id: { not: templateId } },
      });

      if (duplicated) {
        throw new ConflictException(
          `Já existe um item de custo "${name}" com essa operação em folha.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollTemplate.update({
        where: { id: templateId },
        data: {
          name,
          type,
          defaultAmount: dto.defaultAmount ?? undefined,
        },
      });

      await tx.payrollSetup.updateMany({
        where: { templateId, companyId },
        data: { name, type },
      });

      return updated;
    });
  }

  /**
   * Exclui um item de custo. Só é permitido quando nenhum colaborador ativo
   * ainda tem o item lançado (isSet).
   */
  async removeTemplate(companyId: string, templateId: string) {
    const template = await this.prisma.payrollTemplate.findFirst({
      where: { id: templateId, companyId },
    });

    if (!template) throw new NotFoundException('Item de custo não encontrado.');

    if (isBaseSalary(template.name, template.type)) {
      throw new ConflictException(
        `O item "${template.name}" é a base da folha de pagamento e não pode ser excluído.`,
      );
    }

    const linkedEmployees = await this.prisma.payrollSetup.count({
      where: {
        templateId,
        companyId,
        isSet: true,
        employee: { isActive: true },
      },
    });

    if (linkedEmployees > 0) {
      throw new ConflictException(
        `Este item de custo está lançado em ${linkedEmployees} colaborador(es). ` +
          'Remova o item de todos eles antes de excluir.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payrollSetup.deleteMany({
        where: { templateId, companyId },
      });

      await tx.payrollTemplate.delete({ where: { id: templateId } });

      return {
        message: 'Item de custo excluído com sucesso.',
        id: templateId,
        removedSetups: count,
      };
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
