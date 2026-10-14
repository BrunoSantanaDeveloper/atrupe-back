import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PayrollBehavior, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { CostAuditService } from '../../cost-base/cost-audit.service';
import { PlanControlService } from '../../plan/plan-control.service';
import {
  CHARGE_KEYS,
  CHARGE_TEMPLATES,
  ChargeKey,
  PayrollLine,
  chargesOf,
  coherent,
  employerInssRateOf,
  employeeTotalsOf,
  finalCostOf,
  fromLegacy,
  legacyOf,
  valuesOf,
} from './payroll-math';

/** A carga horária de referência do mês (F-11); a da base de custos é outra. */
export const MONTHLY_HOURS = 220;

const LINE_NOT_FOUND = 'Item não encontrado';
const FIXED_BY_LAW =
  'Férias e 13º são calculados por lei e não podem ser editados';
const CLT_ITEM = 'Este item faz parte da folha CLT';
const BASE_ONLY_INCREASE = 'O salário base é sempre acréscimo';

export const LINE_SELECT = {
  id: true,
  name: true,
  amount: true,
  type: true,
  isSet: true,
  behavior: true,
  increase: true,
  discount: true,
  manualOverride: true,
  templateId: true,
  employeeId: true,
  createdAt: true,
  updatedAt: true,
  payrollTemplate: {
    select: {
      derivedFromSalary: true,
      fixedByLaw: true,
      isBase: true,
      systemKey: true,
    },
  },
} satisfies Prisma.PayrollSetupSelect;

type LineRow = Prisma.PayrollSetupGetPayload<{ select: typeof LINE_SELECT }>;

export type PayrollLineDto = {
  behavior?: PayrollBehavior;
  increase?: number;
  discount?: number;
  isSet?: boolean;
  manualOverride?: boolean;
  // O formato de antes, das telas de hoje
  amount?: number;
  type?: 'INCREASE' | 'DISCOUNT' | 'ADVANCE';
  name?: string;
};

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

/**
 * A estrutura da folha com comportamento (ALT-18, ALT-19, F-14): cada linha
 * do colaborador com acréscimo, desconto e o custo; o custo do colaborador e
 * a folha a pagar; os encargos da CLT gerados do salário base (só com a base
 * de custos no plano). O type/amount de antes fica em sincronia: a folha
 * mensal e as telas de hoje seguem iguais.
 */
@Injectable()
export class PayrollStructureService {
  private readonly logger = new Logger(PayrollStructureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanControlService,
    private readonly audit: CostAuditService,
  ) {}

  /** A linha como a tela nova lê, com os campos de antes junto. */
  lineView(row: LineRow) {
    const values = valuesOf(row as PayrollLine);
    return {
      id: row.id,
      templateId: row.templateId,
      name: row.name,
      // Os de antes
      amount: row.amount,
      type: row.type,
      isSet: row.isSet,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // Os novos
      behavior: values.behavior,
      increase: values.increase,
      discount: values.discount,
      finalCost: finalCostOf(row as PayrollLine),
      derivedFromSalary: !!row.payrollTemplate?.derivedFromSalary,
      fixedByLaw: !!row.payrollTemplate?.fixedByLaw,
      isBase: !!row.payrollTemplate?.isBase,
      manualOverride: row.manualOverride,
    };
  }

  /** Os totais do colaborador a partir das linhas. */
  totalsOf(rows: LineRow[]) {
    return employeeTotalsOf(rows as PayrollLine[]);
  }

  /**
   * Edita a linha do colaborador (PATCH /financial/payroll-setup/:id): o
   * formato novo (comportamento, acréscimo, desconto, acrescentar e tirar)
   * e o de antes (amount, type), sempre gravando os dois em sincronia.
   */
  async updateLine(
    companyId: string,
    userId: string | null,
    id: string,
    dto: PayrollLineDto,
  ) {
    const row = await this.prisma.payrollSetup.findFirst({
      where: { id, companyId },
      select: {
        ...LINE_SELECT,
        employee: { select: { contract: true } },
      },
    });
    if (!row) throw new NotFoundException(LINE_NOT_FOUND);
    const template = row.payrollTemplate;
    const isClt = row.employee.contract === 'CLT';

    // INSS ou FGTS com valor à mão voltam a acompanhar o salário (F-4)
    if (dto.manualOverride === false) {
      if (!template?.derivedFromSalary || template.fixedByLaw) {
        bad('Só os encargos de INSS e FGTS têm valor à mão');
      }
      return this.resetOverride(companyId, userId, row);
    }
    const editsValues =
      dto.behavior !== undefined ||
      dto.increase !== undefined ||
      dto.discount !== undefined ||
      dto.amount !== undefined ||
      dto.type !== undefined;

    // 13º e férias são calculados por lei (F-14)
    if (template?.fixedByLaw && editsValues) bad(FIXED_BY_LAW);
    // O salário base e os encargos não saem da folha CLT: o recálculo os
    // poria de volta (decisão do PO, 14/10)
    if (
      dto.isSet === false &&
      isClt &&
      (template?.fixedByLaw || template?.isBase || template?.derivedFromSalary)
    ) {
      bad(CLT_ITEM);
    }

    const current = valuesOf(row as PayrollLine);
    let next = current;
    if (
      dto.behavior ||
      dto.increase !== undefined ||
      dto.discount !== undefined
    ) {
      next = coherent(
        dto.behavior ?? current.behavior,
        dto.increase ?? current.increase,
        dto.discount ?? current.discount,
      );
    } else if (dto.amount !== undefined || dto.type !== undefined) {
      // O formato de antes: o valor vai para o lado do tipo
      next = fromLegacy(dto.type ?? row.type, dto.amount ?? row.amount);
      if (
        current.behavior === 'PROVISION' ||
        current.behavior === 'INCREASE_AND_DISCOUNT'
      ) {
        next = coherent(
          current.behavior,
          next.increase || current.increase,
          next.discount,
        );
      }
    }
    // O salário base é sempre acréscimo (é de onde saem os encargos)
    if (template?.isBase && next.behavior !== 'ONLY_INCREASE') {
      bad(BASE_ONLY_INCREASE);
    }
    // Tirar zera os valores e mantém o item na empresa
    const isSet = dto.isSet ?? row.isSet;
    if (dto.isSet === false) next = { ...next, increase: 0, discount: 0 };
    const legacy = legacyOf(next.behavior, next.increase, next.discount);
    // INSS e FGTS com valor à mão deixam de seguir o salário (F-4)
    const manualOverride =
      row.manualOverride ||
      (!!template?.derivedFromSalary && !template.fixedByLaw && editsValues);

    const updated = await this.prisma.payrollSetup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        isSet,
        behavior: next.behavior,
        increase: next.increase,
        discount: next.discount,
        type: legacy.type,
        amount: legacy.amount,
        manualOverride,
      },
      select: LINE_SELECT,
    });
    // O salário base da folha é o salário do colaborador (D33): mudar aqui
    // muda o cadastro e refaz os encargos (F-7)
    if (template?.isBase && editsValues && isSet) {
      await this.prisma.employee.update({
        where: { id: row.employeeId },
        data: { baseSalary: next.increase, sallary: next.increase },
      });
      await this.syncEmployee(companyId, row.employeeId);
    }
    const siblings = await this.prisma.payrollSetup.findMany({
      where: { employeeId: row.employeeId },
      select: LINE_SELECT,
    });
    const totals = this.totalsOf(siblings);
    await this.audit.record({
      companyId,
      userId,
      entity: 'PAYROLL_SETUP',
      entityId: id,
      action: 'UPDATE',
      before: this.lineView(row),
      after: this.lineView(updated),
    });
    return {
      ...this.lineView(updated),
      employeeCost: totals.employeeCost,
      employeePayroll: totals.employeePayroll,
    };
  }

  private async resetOverride(
    companyId: string,
    userId: string | null,
    row: LineRow,
  ) {
    await this.prisma.payrollSetup.update({
      where: { id: row.id },
      data: { manualOverride: false },
    });
    await this.syncEmployee(companyId, row.employeeId);
    const lines = await this.prisma.payrollSetup.findMany({
      where: { employeeId: row.employeeId },
      select: LINE_SELECT,
    });
    const updated = lines.find((line) => line.id === row.id)!;
    const totals = this.totalsOf(lines);
    await this.audit.record({
      companyId,
      userId,
      entity: 'PAYROLL_SETUP',
      entityId: row.id,
      action: 'UPDATE',
      before: this.lineView(row),
      after: this.lineView(updated),
    });
    return {
      ...this.lineView(updated),
      employeeCost: totals.employeeCost,
      employeePayroll: totals.employeePayroll,
    };
  }

  /**
   * O colaborador mudou o salário base ou a forma de contratação (F-7, F-8):
   * a linha do salário base passa a ser o salário do cadastro; com a base de
   * custos no plano, os encargos da CLT nascem e acompanham o salário.
   */
  async syncEmployee(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, contract: true, baseSalary: true },
    });
    if (!employee || employee.baseSalary === null) return;

    const baseLine = await this.prisma.payrollSetup.findFirst({
      where: { employeeId, payrollTemplate: { isBase: true } },
      select: { id: true },
    });
    if (baseLine) {
      await this.prisma.payrollSetup.update({
        where: { id: baseLine.id },
        data: {
          isSet: true,
          behavior: 'ONLY_INCREASE',
          increase: employee.baseSalary,
          discount: 0,
          type: 'INCREASE',
          amount: employee.baseSalary,
        },
      });
    }

    if (!(await this.plans.hasFeature(companyId, 'cost_base'))) return;
    const templates = await this.ensureChargeTemplates(companyId);
    await this.applyCharges(companyId, employee, templates);
  }

  /**
   * A alíquota do INSS ou do FGTS mudou: os encargos de todos os
   * colaboradores CLT sem valor à mão são refeitos.
   */
  async recomputeCompany(companyId: string) {
    if (!(await this.plans.hasFeature(companyId, 'cost_base'))) return;
    const templates = await this.ensureChargeTemplates(companyId);
    const employees = await this.prisma.employee.findMany({
      where: { companyId, contract: 'CLT', baseSalary: { not: null } },
      select: { id: true, contract: true, baseSalary: true },
    });
    for (const employee of employees) {
      await this.applyCharges(companyId, employee, templates);
    }
  }

  /** O regime (CRT) do emissor padrão da empresa; sem emissor, nulo. */
  async regimeOf(companyId: string) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { emitCrt: true },
    });
    return config?.emitCrt ?? null;
  }

  /**
   * O regime tributário mudou: a alíquota do INSS da empresa volta à do
   * regime novo (um ajuste à mão vale até a próxima mudança de regime) e os
   * encargos dos CLT são refeitos.
   */
  async regimeChanged(companyId: string) {
    const template = await this.prisma.payrollTemplate.findFirst({
      where: { companyId, systemKey: 'INSS_EMPLOYER' },
      select: { id: true, rate: true },
    });
    if (!template) return;
    const rate = employerInssRateOf(await this.regimeOf(companyId));
    if (template.rate === rate) return;
    await this.prisma.payrollTemplate.update({
      where: { id: template.id },
      data: { rate },
    });
    await this.audit.record({
      companyId,
      userId: null,
      entity: 'PAYROLL_TEMPLATE',
      entityId: template.id,
      action: 'UPDATE',
      before: { rate: template.rate, motivo: 'regime tributário' },
      after: { rate },
    });
    await this.recomputeCompany(companyId);
  }

  /** Os itens de encargo da empresa, criados uma vez (com a base de custos). */
  private async ensureChargeTemplates(companyId: string) {
    const existing = await this.prisma.payrollTemplate.findMany({
      where: { companyId, systemKey: { in: [...CHARGE_KEYS] } },
      select: { id: true, systemKey: true, rate: true },
    });
    const byKey = new Map(existing.map((row) => [row.systemKey, row]));
    for (const key of CHARGE_KEYS) {
      if (byKey.has(key)) continue;
      const spec = {
        ...CHARGE_TEMPLATES[key],
        // O INSS da empresa nasce pela alíquota do regime tributário
        ...(key === 'INSS_EMPLOYER' && {
          rate: employerInssRateOf(await this.regimeOf(companyId)),
        }),
      };
      const legacy = legacyOf(spec.behavior, 0, 0);
      // O item que a empresa já cadastrou com o mesmo nome é adotado
      const own = await this.prisma.payrollTemplate.findFirst({
        where: {
          companyId,
          systemKey: null,
          name: { equals: spec.name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (own) {
        const adopted = await this.prisma.payrollTemplate.update({
          where: { id: own.id },
          data: {
            behavior: spec.behavior,
            rate: spec.rate,
            derivedFromSalary: true,
            fixedByLaw: spec.fixedByLaw,
            systemKey: key,
          },
          select: { id: true, systemKey: true, rate: true },
        });
        byKey.set(key, adopted);
        continue;
      }
      const created = await this.prisma.payrollTemplate.create({
        data: {
          companyId,
          name: spec.name,
          type: legacy.type,
          defaultAmount: 0,
          behavior: spec.behavior,
          defaultIncrease: 0,
          defaultDiscount: 0,
          rate: spec.rate,
          derivedFromSalary: true,
          fixedByLaw: spec.fixedByLaw,
          systemKey: key,
        },
        select: { id: true, systemKey: true, rate: true },
      });
      byKey.set(key, created);
    }
    return byKey as Map<
      string,
      { id: string; systemKey: string | null; rate: number | null }
    >;
  }

  private async applyCharges(
    companyId: string,
    employee: {
      id: string;
      contract: 'CLT' | 'PRO_LABORE' | 'MEI_PJ' | null;
      baseSalary: number | null;
    },
    templates: Map<
      string,
      { id: string; systemKey: string | null; rate: number | null }
    >,
  ) {
    const rates = {
      inss: templates.get('INSS')?.rate ?? CHARGE_TEMPLATES.INSS.rate!,
      inssEmployer:
        templates.get('INSS_EMPLOYER')?.rate ??
        CHARGE_TEMPLATES.INSS_EMPLOYER.rate!,
      fgts: templates.get('FGTS')?.rate ?? CHARGE_TEMPLATES.FGTS.rate!,
    };
    const charges = chargesOf(
      employee.contract,
      employee.baseSalary ?? 0,
      rates,
    );
    for (const key of CHARGE_KEYS) {
      const template = templates.get(key)!;
      const spec = CHARGE_TEMPLATES[key as ChargeKey];
      const value = charges?.[key as ChargeKey] ?? null;
      const line = await this.prisma.payrollSetup.findFirst({
        where: { employeeId: employee.id, templateId: template.id },
        select: { id: true, manualOverride: true },
      });
      // Valor à mão (INSS e FGTS) fica como está, enquanto for CLT
      if (line?.manualOverride && value && !spec.fixedByLaw) continue;
      const increase = value?.increase ?? 0;
      const discount = value?.discount ?? 0;
      const legacy = legacyOf(spec.behavior, increase, discount);
      const data = {
        name: spec.name,
        isSet: !!value,
        behavior: spec.behavior,
        increase,
        discount,
        type: legacy.type,
        amount: legacy.amount,
        ...(value ? {} : { manualOverride: false }),
      };
      if (line) {
        await this.prisma.payrollSetup.update({ where: { id: line.id }, data });
      } else if (value) {
        await this.prisma.payrollSetup.create({
          data: {
            ...data,
            companyId,
            employeeId: employee.id,
            templateId: template.id,
          },
        });
      }
    }
  }
}
