import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ItemType } from '@prisma/client';
import { UpdatePayrollTemplateDto } from './dto/update-payroll-template.dto';
import {
  RATE_KEYS,
  coherent,
  fromLegacy,
  legacyOf,
  setupFromTemplate,
  valuesOf,
} from './payroll-math';
import { PayrollStructureService } from './payroll-structure.service';

const FIXED_BY_LAW =
  'Férias e 13º são calculados por lei e não podem ser editados';

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
  constructor(
    private prisma: PrismaService,
    private structure: PayrollStructureService,
  ) {}

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
      const isBase =
        template.isBase || isBaseSalary(template.name, template.type);
      // Os itens que o sistema gera (encargos da CLT) não se excluem
      const system = !!template.systemKey && !template.isBase;
      const values = template.behavior
        ? {
            behavior: template.behavior,
            defaultIncrease: template.defaultIncrease ?? 0,
            defaultDiscount: template.defaultDiscount ?? 0,
          }
        : (({ behavior, increase, discount }) => ({
            behavior,
            defaultIncrease: increase,
            defaultDiscount: discount,
          }))(
            valuesOf({
              isSet: true,
              behavior: null,
              increase: null,
              discount: null,
              type: template.type,
              amount: template.defaultAmount,
            }),
          );

      return {
        id: template.id,
        name: template.name,
        type: template.type,
        defaultAmount: template.defaultAmount,
        createdAt: template.createdAt,
        ...values,
        derivedFromSalary: template.derivedFromSalary,
        fixedByLaw: template.fixedByLaw,
        rate: template.rate,
        isBase,
        // O item do sistema: BASE_SALARY, INSS, FGTS, THIRTEENTH, VACATION
        systemKey: template.systemKey,
        linkedEmployees,
        canDelete: !isBase && !system && linkedEmployees === 0,
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

    // A tela de hoje troca o tipo: o comportamento acompanha (ALT-18)
    const typeBehavior =
      !dto.behavior && dto.type && dto.type !== template.type
        ? fromLegacy(dto.type, 0).behavior
        : undefined;
    const newBehavior = dto.behavior ?? typeBehavior;

    // O salário base e os encargos da CLT têm o comportamento do sistema
    if (
      template.systemKey &&
      newBehavior &&
      newBehavior !== (template.behavior ?? newBehavior)
    ) {
      throw new BadRequestException('Este item faz parte da folha CLT');
    }

    // 13º e férias são da lei (F-14); só INSS e FGTS têm alíquota
    if (
      template.fixedByLaw &&
      ((dto.behavior !== undefined && dto.behavior !== template.behavior) ||
        dto.rate !== undefined ||
        dto.defaultIncrease !== undefined ||
        dto.defaultDiscount !== undefined)
    ) {
      throw new BadRequestException(FIXED_BY_LAW);
    }
    if (
      dto.rate !== undefined &&
      !RATE_KEYS.includes(template.systemKey ?? '')
    ) {
      throw new BadRequestException(
        'Só os encargos de INSS e FGTS têm alíquota',
      );
    }

    const name = dto.name?.trim() || template.name;
    const behavior = newBehavior ?? template.behavior;
    const behaviorChanged = !!newBehavior && newBehavior !== template.behavior;
    // Com o comportamento, o type sai dele (ADVANCE continua para o adiantamento)
    const type = dto.behavior
      ? legacyOf(dto.behavior, 0, 0).type
      : dto.type || template.type;
    // O valor padrão da tela de hoje vai para o acréscimo ou o desconto
    const legacyDefaults =
      dto.defaultAmount !== undefined &&
      dto.defaultIncrease === undefined &&
      dto.defaultDiscount === undefined &&
      behavior !== 'PROVISION' &&
      behavior !== 'INCREASE_AND_DISCOUNT'
        ? (({ increase, discount }) => ({
            defaultIncrease: increase,
            defaultDiscount: discount,
          }))(fromLegacy(type, dto.defaultAmount))
        : {};

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

    return this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.payrollTemplate.update({
          where: { id: templateId },
          data: {
            name,
            type,
            defaultAmount: dto.defaultAmount ?? undefined,
            ...(behavior && { behavior }),
            ...legacyDefaults,
            ...(dto.defaultIncrease !== undefined && {
              defaultIncrease: dto.defaultIncrease,
            }),
            ...(dto.defaultDiscount !== undefined && {
              defaultDiscount: dto.defaultDiscount,
            }),
            ...(dto.rate !== undefined && { rate: dto.rate }),
          },
        });

        if (behaviorChanged) {
          // O comportamento novo vale para as linhas de todos: os valores
          // seguem coerentes com ele e o type/amount acompanha. Na troca de
          // tipo da tela de hoje, o valor da linha muda de lado, como antes
          const lines = await tx.payrollSetup.findMany({
            where: { templateId, companyId },
          });
          for (const line of lines) {
            const current = valuesOf(line);
            const next = typeBehavior
              ? fromLegacy(type, line.amount)
              : coherent(behavior!, current.increase, current.discount);
            const legacy = legacyOf(
              next.behavior,
              next.increase,
              next.discount,
            );
            await tx.payrollSetup.update({
              where: { id: line.id },
              data: { name, ...next, ...legacy },
            });
          }
        } else {
          // Só o nome: o tipo de cada linha segue o comportamento dela (a
          // de acréscimo e desconto pode estar do lado do desconto)
          await tx.payrollSetup.updateMany({
            where: { templateId, companyId },
            data: { name },
          });
        }

        return updated;
      })
      .then(async (updated) => {
        // A alíquota nova refaz os encargos de quem não tem valor à mão
        if (dto.rate !== undefined) {
          await this.structure.recomputeCompany(companyId);
        }
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

    if (template.isBase || isBaseSalary(template.name, template.type)) {
      throw new ConflictException(
        `O item "${template.name}" é a base da folha de pagamento e não pode ser excluído.`,
      );
    }
    // Os encargos da CLT (INSS, FGTS, 13º e férias) são do sistema
    if (template.systemKey) {
      throw new ConflictException('Este item faz parte da folha CLT');
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
            ...setupFromTemplate(template),
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
              ...setupFromTemplate(template),
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
