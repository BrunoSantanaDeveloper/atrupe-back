import { Injectable } from '@nestjs/common';
import { CostCriterion, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { ASSET_INCLUDE, computeAsset } from '../asset/asset.service';
import { chargesTotalOf } from '../pricing/pricing-math';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import { activityHoursOf } from '../asset/asset-math';
import {
  employeeTotalsOf,
  PayrollLine,
} from '../financial/salaries/payroll-math';
import { LINE_SELECT } from '../financial/salaries/payroll-structure.service';
import { allocationOf } from './engine/allocation';
import {
  ExpenseShare,
  criterionValueOf,
  defaultCriterionOf,
  shareValueOf,
  sharesOf,
  statsOf,
} from './engine/expenses';
import { laborOf } from './engine/labor';
import {
  monthOfDate,
  monthStart,
  monthsUpTo,
  referenceMonthOf,
  shiftMonth,
} from './engine/months';
import { SectorCostItem, SectorInput, sectorCostsOf } from './engine/sectors';
import { accountCodeOf } from '../financial/nature/account-code';

export { accountCodeOf };

// O realizado: lançado no contas a pagar, fora o cancelado e o provisionado,
// e fora a folha (o custo dela entra pela mão de obra)
export const REALIZED_PAYABLE: Prisma.PayableWhereInput = {
  status: { notIn: ['CANCELED', 'PROVISIONED'] },
  expenseSource: { not: 'EMPLOYEE' },
};

// As despesas administrativas são as contas da natureza "Administrativo"
// do plano (02.01)
export const ADMIN_NATURE: Prisma.NatureWhereInput = {
  level1: '02',
  level2: '01',
  isActive: true,
};

const SECTOR_SELECT = {
  id: true,
  name: true,
  kind: true,
  nature: true,
  distributionPercentage: true,
  allocationCriterion: true,
  allocationPercentages: true,
  allocationPreviousCriterion: true,
  allocationOutdated: true,
  hourSale: true,
  hourSaleRule: true,
  hourSaleProfit: true,
} satisfies Prisma.CompanySectorSelect;

type SectorRow = Prisma.CompanySectorGetPayload<{
  select: typeof SECTOR_SELECT;
}>;

// Os nomes do setor que recebe as despesas administrativas
const ADMIN_HOST_NAMES = ['administração', 'administracao', 'administrativo'];

/** Os percentuais manuais gravados no setor: { assetId → percentual }. */
export const manualSharesOf = (value: unknown) =>
  new Map<string, number>(
    Array.isArray(value)
      ? value
          .filter(
            (share) =>
              !!share &&
              typeof share.assetId === 'string' &&
              typeof share.percentage === 'number',
          )
          .map((share) => [share.assetId, share.percentage] as const)
      : [],
  );

/**
 * O retrato da base de custos de uma empresa no mês de referência: as
 * contas administrativas, o custo de cada setor, a distribuição, o rateio
 * entre equipamentos e a mão de obra. Todas as rotas leem daqui, para cada
 * número ter uma fonte só (SEG-1).
 */
@Injectable()
export class CostBaseSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingParametersService,
  ) {}

  async load(companyId: string, today = new Date()) {
    const reference = referenceMonthOf(today);
    const windowStart = monthStart(shiftMonth(reference, -11));
    const windowEnd = monthStart(shiftMonth(reference, 1));

    const [sectorRows, employees, assetRows, accountRows, settings, workloads] =
      await Promise.all([
        this.prisma.companySector.findMany({
          where: { companyId, isActive: true },
          orderBy: { name: 'asc' },
          select: SECTOR_SELECT,
        }),
        this.prisma.employee.findMany({
          where: { companyId, isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            sectorId: true,
            role: { select: { name: true } },
            PayrollSetup: { select: LINE_SELECT },
          },
        }),
        this.prisma.asset.findMany({
          where: { companyId, active: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          include: ASSET_INCLUDE,
        }),
        this.prisma.subCategory.findMany({
          where: { companyId, isActive: true, nature: ADMIN_NATURE },
          orderBy: [{ code: 'asc' }, { description: 'asc' }],
          select: {
            id: true,
            code: true,
            description: true,
            nature: {
              select: {
                code: true,
                level1: true,
                level2: true,
                description: true,
              },
            },
          },
        }),
        this.prisma.costBaseExpense.findMany({ where: { companyId } }),
        this.prisma.employeeWorkload.findMany({ where: { companyId } }),
      ]);

    const sectorById = new Map(sectorRows.map((sector) => [sector.id, sector]));

    // Os bens ativos já calculados (depreciação, custos, configurações)
    const assets = assetRows.map((row) => ({
      row,
      computed: computeAsset(row, today),
    }));

    // Conta ligada a custo de patrimônio não é despesa administrativa (P-17)
    const linkedToAssets = new Set(
      assetRows.flatMap((row) =>
        row.costs.map((cost) => cost.subCategoryId).filter(Boolean),
      ),
    );
    const adminAccounts = accountRows.filter(
      (account) => !linkedToAssets.has(account.id),
    );
    const expenses = await this.expensesOf(
      companyId,
      adminAccounts,
      settings,
      reference,
      windowStart,
      windowEnd,
      sectorRows,
    );

    const items = new Map<string, SectorCostItem[]>(
      sectorRows.map((sector) => [sector.id, []]),
    );
    const push = (sectorId: string | null, item: SectorCostItem) => {
      if (sectorId && items.has(sectorId)) items.get(sectorId)!.push(item);
    };

    // LABOR: o custo de cada colaborador na folha (ALT-19)
    for (const employee of employees) {
      const cost = employeeTotalsOf(
        employee.PayrollSetup as PayrollLine[],
      ).employeeCost;
      push(employee.sectorId, {
        id: `labor:${employee.id}`,
        name: employee.role?.name
          ? `${employee.name} — ${employee.role.name}`
          : (employee.name ?? 'Colaborador'),
        origin: 'LABOR',
        detail: 'Salário, encargos e benefícios',
        value: cost,
      });
    }

    // DEPRECIATION e ASSETS: o bem que ainda deprecia e os custos fixos
    // mensais dele (o variável por unidade não entra no custo do setor)
    for (const { row, computed } of assets) {
      const { monthlyDepreciation, remainingValue } = computed.depreciation;
      if (monthlyDepreciation && (remainingValue ?? 0) > 0) {
        push(row.sectorId, {
          id: `depreciation:${row.id}`,
          name: row.name,
          origin: 'DEPRECIATION',
          detail: row.detailed ? 'Depreciação mensal' : 'Cadastro simplificado',
          value: monthlyDepreciation,
          assetId: row.id,
        });
      }
      for (const cost of computed.costs) {
        if (cost.nature !== 'FIXED') continue;
        push(row.sectorId, {
          id: `asset-cost:${cost.id}`,
          name: row.name,
          origin: 'ASSETS',
          detail: cost.name,
          value: cost.monthlyCost,
          assetId: row.id,
        });
      }
    }

    // OTHER: as despesas administrativas num setor administrativo (o que
    // sobrou do rateio por item) e a parte rateada em cada produtivo (BC-8)
    const host = this.adminHostOf(sectorRows);
    const remainder = expenses.referenceValue - expenses.allocatedValue;
    const adminItem: SectorCostItem = {
      id: 'admin-expenses',
      name: 'Despesas administrativas',
      origin: 'OTHER',
      detail: expenses.allocatedValue
        ? 'Contas administrativas, já sem o que foi rateado por item'
        : 'Contas administrativas do plano de contas',
      value: remainder,
    };
    const virtualHost = !host && remainder > 0;
    if (host) push(host.id, adminItem);
    for (const account of expenses.accounts) {
      for (const share of account.allocations) {
        push(share.sectorId, {
          id: `expense-share:${account.id}:${share.sectorId}`,
          name: account.name,
          origin: 'OTHER',
          detail: `Rateio por item · ${share.percentage.toLocaleString('pt-BR')}% do custo de referência`,
          value: share.value,
        });
      }
    }

    const inputs: SectorInput[] = sectorRows.map((sector) => ({
      id: sector.id,
      name: sector.name,
      nature: sector.nature,
      distributionPercentage: sector.distributionPercentage,
      allocationCriterion: sector.allocationCriterion,
      items: items.get(sector.id)!,
    }));
    // Sem setor administrativo, as despesas ficam num setor à parte, para o
    // total administrativo não sumir
    if (virtualHost) {
      inputs.push({
        id: 'administrativo',
        name: 'Administrativo',
        nature: 'ADMINISTRATIVE',
        distributionPercentage: 0,
        allocationCriterion: 'ACQUISITION_VALUE',
        items: [adminItem],
      });
    }
    const costs = sectorCostsOf(inputs);
    const costById = new Map(
      costs.sectors.map((sector) => [sector.id, sector]),
    );

    // O rateio entre os equipamentos detalhados de cada setor produtivo
    const allocations = sectorRows
      .filter((sector) => sector.nature === 'PRODUCTIVE')
      .map((sector) => {
        const equipment = assets.filter(
          ({ row }) => row.detailed && row.sectorId === sector.id,
        );
        if (!equipment.length) return null;
        const ids = new Set(equipment.map(({ row }) => row.id));
        const cost = costById.get(sector.id)!;
        const ofEquipment = cost.items
          .filter((item) => item.assetId && ids.has(item.assetId))
          .reduce((sum, item) => sum + item.value, 0);
        const result = allocationOf({
          criterion: sector.allocationCriterion,
          manual: manualSharesOf(sector.allocationPercentages),
          pool: Math.max(0, (cost.totalCost ?? 0) - ofEquipment),
          equipment: equipment.map(({ row, computed }) => ({
            id: row.id,
            name: row.name,
            acquisitionValue: row.acquisitionValue,
            activityHours: row.setups.reduce(
              (sum, setup) => sum + activityHoursOf(setup),
              0,
            ),
            ownCost: computed.ownCost,
          })),
        });
        return {
          sectorId: sector.id,
          sectorName: sector.name,
          criterion: sector.allocationCriterion,
          previousCriterion: sector.allocationPreviousCriterion,
          allocationOutdated: sector.allocationOutdated,
          ...result,
        };
      })
      .filter((allocation) => allocation !== null);

    // A mão de obra de cada setor produtivo (F-11)
    const charges = chargesTotalOf(await this.pricing.chargesOf(companyId));
    const hoursOf = new Map(
      workloads.map((workload) => [workload.employeeId, workload]),
    );
    const labor = sectorRows
      .filter((sector) => sector.nature === 'PRODUCTIVE')
      .map((sector) => {
        const collaborators = employees
          .filter((employee) => employee.sectorId === sector.id)
          .map((employee) => {
            const workload = hoursOf.get(employee.id);
            return {
              id: employee.id,
              name: employee.name ?? '',
              role: employee.role?.name ?? '',
              // As horas valem para o setor do cadastro (F-2)
              hours: workload?.sectorId === sector.id ? workload.hours : 0,
            };
          });
        return {
          id: sector.id,
          name: sector.name,
          ...laborOf({
            totalCost: costById.get(sector.id)?.totalCost ?? null,
            hours: collaborators.map((collaborator) => collaborator.hours),
            salePrice: sector.hourSale ?? null,
            // A margem é a da precificação: depois dos encargos (PR-3)
            charges,
          }),
          collaborators,
        };
      });

    return {
      referenceMonth: reference,
      today,
      sectorById,
      assets,
      expenses,
      costs,
      allocations,
      labor,
    };
  }

  /**
   * As máquinas da empresa como a precificação e a composição leem: cada
   * configuração produtiva do bem detalhado e cada grupo de bens equivalentes
   * como uma linha só (P-28), com o custo por unidade já com a parte do
   * rateio do setor (o grupo, pelo custo médio por unidade dos bens dele).
   */
  async machineLines(companyId: string, snapshot: CostBaseSnapshot) {
    const poolShare = new Map(
      snapshot.allocations.flatMap((allocation) =>
        allocation.equipment.map((item) => [item.id, item.poolShare] as const),
      ),
    );
    const groups = await this.prisma.assetGroup.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        unit: true,
        priceRule: true,
        salePrice: true,
        profit: true,
        sector: { select: { name: true } },
      },
    });
    const byGroup = new Map<string, number[]>();
    const lines = [];
    for (const { row } of snapshot.assets) {
      const computed = computeAsset(
        row,
        snapshot.today,
        poolShare.get(row.id) ?? 0,
      );
      if (row.groupId) {
        if (computed.unitCost !== null) {
          byGroup.set(row.groupId, [
            ...(byGroup.get(row.groupId) ?? []),
            computed.unitCost,
          ]);
        }
        continue;
      }
      if (!row.detailed) continue;
      for (const setup of row.setups) {
        lines.push({
          id: `setup:${setup.id}`,
          kind: 'setup' as const,
          refId: setup.id,
          name: `${row.name} · ${setup.name}`,
          code: setup.abbreviation || null,
          sector: row.sector?.name ?? null,
          unit: setup.unit,
          cost: computed.setupUnitCosts.get(setup.id) ?? null,
          rule: setup.priceRule,
          price: setup.salePrice ?? null,
          profit: setup.profit ?? null,
        });
      }
    }
    const groupLines = groups.map((group) => {
      const costs = byGroup.get(group.id) ?? [];
      return {
        id: `group:${group.id}`,
        kind: 'group' as const,
        refId: group.id,
        name: group.name,
        code: null as string | null,
        sector: group.sector?.name ?? null,
        unit: group.unit,
        cost: costs.length
          ? Math.round(
              costs.reduce((sum, value) => sum + value, 0) / costs.length,
            )
          : null,
        rule: group.priceRule,
        price: group.salePrice ?? null,
        profit: group.profit ?? null,
      };
    });
    return [...lines, ...groupLines];
  }

  /**
   * O que a composição lê da base de custos (SEG-1): o custo-hora calculado
   * de cada setor produtivo que já tem horas, e as máquinas com custo e
   * preço por unidade.
   */
  async ratesOf(companyId: string) {
    const snapshot = await this.load(companyId);
    return {
      hourCosts: new Map(
        snapshot.labor
          .filter((sector) => sector.costPerHour !== null)
          .map((sector) => [sector.id, sector.costPerHour as number] as const),
      ),
      machines: await this.machineLines(companyId, snapshot),
    };
  }

  /** A parte do rateio do setor que cabe ao bem no mês (para o patrimônio). */
  async poolOf(companyId: string, assetId: string) {
    const { allocations } = await this.load(companyId);
    for (const allocation of allocations) {
      const item = allocation.equipment.find((row) => row.id === assetId);
      if (item) return item.poolShare;
    }
    return 0;
  }

  /**
   * O setor administrativo que recebe as despesas administrativas: o que se
   * chama Administração (ou Administrativo), senão o primeiro pelo nome.
   */
  private adminHostOf(sectors: SectorRow[]) {
    const admin = sectors.filter(
      (sector) => sector.nature === 'ADMINISTRATIVE',
    );
    return (
      admin.find((sector) =>
        ADMIN_HOST_NAMES.includes(sector.name.trim().toLowerCase()),
      ) ?? admin[0]
    );
  }

  private async expensesOf(
    companyId: string,
    accounts: {
      id: string;
      code: string | null;
      description: string | null;
      nature: {
        code: string | null;
        level1: string | null;
        level2: string | null;
        description: string | null;
      };
    }[],
    settings: {
      subCategoryId: string;
      criterion: CostCriterion;
      manualValue: number | null;
      allocations: Prisma.JsonValue;
    }[],
    reference: string,
    windowStart: Date,
    windowEnd: Date,
    sectors: SectorRow[],
  ) {
    const ids = accounts.map((account) => account.id);
    const [payables, firsts] = ids.length
      ? await Promise.all([
          this.prisma.payable.findMany({
            where: {
              companyId,
              subCategoryId: { in: ids },
              referenceDate: { gte: windowStart, lt: windowEnd },
              ...REALIZED_PAYABLE,
            },
            select: {
              subCategoryId: true,
              referenceDate: true,
              totalAmount: true,
            },
          }),
          this.prisma.payable.groupBy({
            by: ['subCategoryId'],
            where: {
              companyId,
              subCategoryId: { in: ids },
              referenceDate: { lt: windowEnd },
              ...REALIZED_PAYABLE,
            },
            _min: { referenceDate: true },
          }),
        ])
      : [[], []];

    const byAccount = new Map<string, Map<string, number>>();
    for (const payable of payables) {
      const months = byAccount.get(payable.subCategoryId!) ?? new Map();
      const month = monthOfDate(payable.referenceDate);
      // O contas a pagar guarda reais (Float); a base de custos calcula em
      // centavos (antes a despesa administrativa saía 100 vezes menor)
      months.set(
        month,
        (months.get(month) ?? 0) + Math.round(payable.totalAmount * 100),
      );
      byAccount.set(payable.subCategoryId!, months);
    }
    const firstMonth = new Map(
      firsts.map((row) => [
        row.subCategoryId,
        row._min.referenceDate ? monthOfDate(row._min.referenceDate) : null,
      ]),
    );
    const settingOf = new Map(settings.map((row) => [row.subCategoryId, row]));
    const productive = new Map(
      sectors
        .filter((sector) => sector.nature === 'PRODUCTIVE')
        .map((sector) => [sector.id, sector.name]),
    );

    const list = accounts.map((account) => {
      const stats = statsOf(
        byAccount.get(account.id) ?? new Map(),
        firstMonth.get(account.id) ?? null,
        reference,
      );
      const setting = settingOf.get(account.id);
      const criterion = setting?.criterion ?? defaultCriterionOf(stats);
      const manualValue =
        criterion === 'MANUAL' ? (setting?.manualValue ?? null) : null;
      const referenceValue = criterionValueOf(stats, criterion, manualValue);
      // O rateio vale só para setor produtivo ativo
      const shares: ExpenseShare[] = sharesOf(setting?.allocations).filter(
        (share) => productive.has(share.sectorId),
      );
      const allocations = shares.map((share) => ({
        sectorId: share.sectorId,
        sectorName: productive.get(share.sectorId)!,
        percentage: share.percentage,
        value: shareValueOf(referenceValue ?? 0, share.percentage),
      }));
      const allocatedValue = allocations.reduce(
        (sum, share) => sum + share.value,
        0,
      );
      return {
        id: account.id,
        name: account.description ?? '',
        chartAccount: accountCodeOf(account.nature, account.code),
        ...stats,
        criterion,
        manualValue,
        referenceValue,
        allocations,
        allocatedValue,
        remainder:
          referenceValue === null ? null : referenceValue - allocatedValue,
      };
    });

    return {
      accounts: list,
      referenceValue: list.reduce(
        (sum, account) => sum + (account.referenceValue ?? 0),
        0,
      ),
      allocatedValue: list.reduce(
        (sum, account) => sum + account.allocatedValue,
        0,
      ),
    };
  }
}

export type CostBaseSnapshot = Awaited<
  ReturnType<CostBaseSnapshotService['load']>
>;

/** Os meses do período do comparativo, até o de referência. */
export const periodMonthsOf = (reference: string, months: number) =>
  monthsUpTo(reference, months);
