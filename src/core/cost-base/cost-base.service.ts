import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { CostAuditService } from './cost-audit.service';
import {
  CostBaseSnapshot,
  CostBaseSnapshotService,
  REALIZED_PAYABLE,
  accountCodeOf,
} from './cost-base-snapshot.service';
import {
  AdminExpenseFilterDto,
  ComparisonFilterDto,
  DistributionDto,
  ExpenseAllocationDto,
  LaborHoursDto,
  SectorAllocationDto,
  UpdateAdminExpenseDto,
} from './dto/cost-base.dto';
import { manualFits } from './engine/allocation';
import { criterionValueOf, shareValueOf } from './engine/expenses';
import { toMinute } from './engine/labor';
import { monthStart, monthsUpTo, shiftMonth } from './engine/months';
import { distributionFits, summaryOf } from './engine/sectors';

const ACCOUNT_NOT_FOUND = 'Conta não encontrada';
const SECTOR_NOT_FOUND = 'Setor não encontrado';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const pageOf = <T>(rows: T[], filter: { page?: number; limit?: number }) => {
  const limit = filter.limit ?? 100;
  const lastPage = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(filter.page ?? 1, lastPage);
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    page,
    lastPage,
    total: rows.length,
  };
};

/**
 * A base de custos (módulo 4, PRO): despesas administrativas, custo por
 * setor e resumo, distribuição do administrativo, rateio entre os
 * equipamentos, mão de obra, depreciação e o comparativo. Tudo sai do
 * retrato do mês de referência (CostBaseSnapshotService); cada escrita vai
 * para o histórico de custo com antes e depois (SEG-4).
 */
@Injectable()
export class CostBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: CostBaseSnapshotService,
    private readonly audit: CostAuditService,
  ) {}

  /* ------------------------------------------- despesas administrativas */

  async adminExpenses(companyId: string, filter: AdminExpenseFilterDto) {
    const snapshot = await this.snapshots.load(companyId);
    const search = filter.search?.trim().toLowerCase();
    const rows = snapshot.expenses.accounts.filter(
      (account) =>
        (!filter.criterion || account.criterion === filter.criterion) &&
        (!search ||
          account.name.toLowerCase().includes(search) ||
          account.chartAccount.includes(search)),
    );
    return { referenceMonth: snapshot.referenceMonth, ...pageOf(rows, filter) };
  }

  async adminExpenseTotals(companyId: string) {
    const { expenses, referenceMonth } = await this.snapshots.load(companyId);
    const manual = expenses.accounts.filter(
      (account) => account.criterion === 'MANUAL',
    ).length;
    return {
      referenceMonth,
      total: expenses.accounts.length,
      byAverage: expenses.accounts.length - manual,
      manual,
      referenceValue: expenses.referenceValue,
      // O que foi rateado por item e o que fica no administrativo (BC-8)
      allocatedValue: expenses.allocatedValue,
      remainingValue: expenses.referenceValue - expenses.allocatedValue,
    };
  }

  async updateAdminExpense(
    companyId: string,
    userId: string | null,
    id: string,
    dto: UpdateAdminExpenseDto,
  ) {
    const snapshot = await this.snapshots.load(companyId);
    const account = this.accountOf(snapshot, id);
    if (dto.criterion === 'MANUAL') {
      if (!(typeof dto.manualValue === 'number' && dto.manualValue > 0)) {
        bad('Informe o valor mensal desta conta');
      }
    } else if (criterionValueOf(account, dto.criterion, null) === null) {
      bad('Esta conta ainda não tem histórico para este critério');
    }
    const manualValue = dto.criterion === 'MANUAL' ? dto.manualValue! : null;
    await this.prisma.costBaseExpense.upsert({
      where: { companyId_subCategoryId: { companyId, subCategoryId: id } },
      create: {
        companyId,
        subCategoryId: id,
        criterion: dto.criterion,
        manualValue,
      },
      update: { criterion: dto.criterion, manualValue },
    });
    const after = this.accountOf(await this.snapshots.load(companyId), id);
    await this.audit.record({
      companyId,
      userId,
      entity: 'COST_BASE_EXPENSE',
      entityId: id,
      action: 'UPDATE',
      before: this.criterionView(account),
      after: this.criterionView(after),
    });
    return after;
  }

  /** O diálogo do rateio por item (BC-8): a conta e os setores produtivos. */
  async expenseAllocation(companyId: string, id: string) {
    const snapshot = await this.snapshots.load(companyId);
    const account = this.accountOf(snapshot, id);
    return this.allocationDialogOf(snapshot, account);
  }

  async updateExpenseAllocation(
    companyId: string,
    userId: string | null,
    id: string,
    dto: ExpenseAllocationDto,
  ) {
    const snapshot = await this.snapshots.load(companyId);
    const account = this.accountOf(snapshot, id);
    const shares = dto.allocations.filter((share) => share.percentage > 0);
    const seen = new Set<string>();
    for (const share of shares) {
      const sector = snapshot.sectorById.get(share.sectorId);
      if (!sector || sector.nature !== 'PRODUCTIVE') {
        bad('Só setor produtivo recebe rateio por item');
      }
      if (seen.has(share.sectorId)) bad('Setor repetido no rateio');
      seen.add(share.sectorId);
    }
    // Pelo valor, com 1 centavo de tolerância; sem valor, pelos percentuais
    const reference = account.referenceValue ?? 0;
    const fits =
      reference > 0
        ? shares.reduce(
            (sum, share) => sum + shareValueOf(reference, share.percentage),
            0,
          ) <=
          reference + 1
        : shares.reduce((sum, share) => sum + share.percentage, 0) <= 100;
    if (!fits) bad('O rateio não pode passar de 100% do custo de referência.');

    const allocations = shares.map(({ sectorId, percentage }) => ({
      sectorId,
      percentage,
    }));
    await this.prisma.costBaseExpense.upsert({
      where: { companyId_subCategoryId: { companyId, subCategoryId: id } },
      create: {
        companyId,
        subCategoryId: id,
        allocations: allocations.length ? allocations : Prisma.DbNull,
      },
      update: { allocations: allocations.length ? allocations : Prisma.DbNull },
    });
    const after = await this.snapshots.load(companyId);
    await this.audit.record({
      companyId,
      userId,
      entity: 'COST_BASE_EXPENSE_ALLOCATION',
      entityId: id,
      action: 'UPDATE',
      before: account.allocations,
      after: this.accountOf(after, id).allocations,
    });
    return this.allocationDialogOf(after, this.accountOf(after, id));
  }

  /* ------------------------------------------- por setor, resumo, distribuição */

  async sectors(companyId: string) {
    const { referenceMonth, costs } = await this.snapshots.load(companyId);
    return {
      referenceMonth,
      isDistributing: costs.isDistributing,
      sectors: costs.sectors.map((sector) => ({
        id: sector.id,
        name: sector.name,
        nature: sector.nature,
        labor: sector.labor,
        assets: sector.assets,
        depreciation: sector.depreciation,
        other: sector.other,
        ownCost: sector.ownCost,
        receivedCost: sector.receivedCost,
        totalCost: sector.totalCost,
        allocationCriterion: sector.allocationCriterion,
        items: sector.items.map(({ id, name, origin, detail, value }) => ({
          id,
          name,
          origin,
          detail,
          value,
        })),
      })),
    };
  }

  async summary(companyId: string) {
    const { referenceMonth, costs } = await this.snapshots.load(companyId);
    return { referenceMonth, ...summaryOf(costs) };
  }

  async distribution(companyId: string) {
    return this.distributionOf(await this.snapshots.load(companyId));
  }

  async updateDistribution(
    companyId: string,
    userId: string | null,
    dto: DistributionDto,
  ) {
    const snapshot = await this.snapshots.load(companyId);
    const given = new Map<string, number>();
    for (const share of dto.percentages) {
      const sector = snapshot.sectorById.get(share.id);
      if (!sector || sector.nature !== 'PRODUCTIVE') {
        bad('Só setor produtivo recebe distribuição');
      }
      if (given.has(share.id)) bad('Setor repetido na distribuição');
      given.set(share.id, share.percentage);
    }
    if (
      !distributionFits(snapshot.costs.administrativeCost, [...given.values()])
    ) {
      bad('A soma dos setores produtivos não pode passar de 100%.');
    }
    // O produtivo que não veio fica com zero
    const productive = [...snapshot.sectorById.values()].filter(
      (sector) => sector.nature === 'PRODUCTIVE',
    );
    await this.prisma.$transaction(
      productive.map((sector) =>
        this.prisma.companySector.update({
          where: { id: sector.id },
          data: { distributionPercentage: given.get(sector.id) ?? 0 },
        }),
      ),
    );
    const after = this.distributionOf(await this.snapshots.load(companyId));
    await this.audit.record({
      companyId,
      userId,
      entity: 'COST_BASE_DISTRIBUTION',
      entityId: companyId,
      action: 'UPDATE',
      before: productive.map((sector) => ({
        id: sector.id,
        percentage: sector.distributionPercentage,
      })),
      after: after.sectors
        .filter((sector) => sector.nature === 'PRODUCTIVE')
        .map((sector) => ({ id: sector.id, percentage: sector.percentage })),
    });
    return after;
  }

  /* ------------------------------------------- rateio entre os equipamentos */

  async sectorAllocations(companyId: string) {
    const { referenceMonth, allocations } =
      await this.snapshots.load(companyId);
    return {
      referenceMonth,
      data: allocations.map((allocation) => this.allocationView(allocation)),
    };
  }

  async updateSectorAllocation(
    companyId: string,
    userId: string | null,
    sectorId: string,
    dto: SectorAllocationDto,
  ) {
    const snapshot = await this.snapshots.load(companyId);
    const sector = snapshot.sectorById.get(sectorId);
    if (!sector) throw new NotFoundException(SECTOR_NOT_FOUND);
    if (sector.nature !== 'PRODUCTIVE') {
      bad('Só setor produtivo tem rateio entre equipamentos');
    }
    const allocation = snapshot.allocations.find(
      (item) => item.sectorId === sectorId,
    );
    if (!allocation)
      bad('Este setor não tem equipamento detalhado para ratear');

    let percentages: { assetId: string; percentage: number }[] | null = null;
    if (dto.criterion === 'MANUAL') {
      const given = new Map(
        (dto.percentages ?? []).map((share) => [
          share.assetId,
          share.percentage,
        ]),
      );
      const ids = new Set(allocation!.equipment.map((item) => item.id));
      for (const assetId of given.keys()) {
        if (!ids.has(assetId)) bad('Equipamento fora do rateio deste setor');
      }
      for (const item of allocation!.equipment) {
        const percentage = given.get(item.id);
        if (percentage === undefined)
          bad(`Informe o percentual de ${item.name}`);
        if (!(percentage! >= 0 && percentage! <= 100)) {
          bad(`O percentual de ${item.name} precisa ficar entre 0 e 100%`);
        }
      }
      percentages = allocation!.equipment.map((item) => ({
        assetId: item.id,
        percentage: given.get(item.id)!,
      }));
      if (
        !manualFits(
          allocation!.pool,
          percentages.map((share) => share.percentage),
        )
      ) {
        bad('A soma dos equipamentos precisa fechar 100%');
      }
    }

    await this.prisma.companySector.update({
      where: { id: sectorId },
      data:
        dto.criterion === 'MANUAL'
          ? {
              allocationCriterion: 'MANUAL',
              allocationPercentages: percentages!,
              // O automático de onde o manual nasceu
              allocationPreviousCriterion:
                sector.allocationCriterion === 'MANUAL'
                  ? sector.allocationPreviousCriterion
                  : sector.allocationCriterion,
              allocationOutdated: false,
            }
          : {
              allocationCriterion: dto.criterion,
              allocationPercentages: Prisma.DbNull,
              allocationPreviousCriterion: null,
              allocationOutdated: false,
            },
    });
    const after = (await this.snapshots.load(companyId)).allocations.find(
      (item) => item.sectorId === sectorId,
    )!;
    await this.audit.record({
      companyId,
      userId,
      entity: 'COST_BASE_SECTOR_ALLOCATION',
      entityId: sectorId,
      action: 'UPDATE',
      before: {
        criterion: allocation!.criterion,
        shares: allocation!.equipment.map(({ id, share }) => ({ id, share })),
      },
      after: {
        criterion: after.criterion,
        shares: after.equipment.map(({ id, share }) => ({ id, share })),
      },
    });
    return this.allocationView(after);
  }

  /* ------------------------------------------- mão de obra */

  async labor(companyId: string) {
    const { referenceMonth, labor } = await this.snapshots.load(companyId);
    return { referenceMonth, data: labor };
  }

  async updateLaborHours(
    companyId: string,
    userId: string | null,
    sectorId: string,
    dto: LaborHoursDto,
  ) {
    const snapshot = await this.snapshots.load(companyId);
    const sector = snapshot.sectorById.get(sectorId);
    if (!sector) throw new NotFoundException(SECTOR_NOT_FOUND);
    if (sector.nature !== 'PRODUCTIVE')
      bad('Só setor produtivo tem mão de obra');
    const before = snapshot.labor.find((item) => item.id === sectorId)!;
    if (!before.collaborators.length) bad('Setor sem colaboradores');
    const ids = new Set(before.collaborators.map((item) => item.id));
    const seen = new Set<string>();
    for (const item of dto.hours) {
      if (!ids.has(item.id)) bad('Colaborador não encontrado neste setor');
      if (seen.has(item.id)) bad('Colaborador repetido');
      seen.add(item.id);
    }
    await this.prisma.$transaction(
      dto.hours.map((item) =>
        this.prisma.employeeWorkload.upsert({
          where: { employeeId: item.id },
          create: {
            companyId,
            employeeId: item.id,
            sectorId,
            hours: toMinute(item.hours),
          },
          update: { sectorId, hours: toMinute(item.hours) },
        }),
      ),
    );
    const after = (await this.snapshots.load(companyId)).labor.find(
      (item) => item.id === sectorId,
    )!;
    await this.audit.record({
      companyId,
      userId,
      entity: 'COST_BASE_LABOR_HOURS',
      entityId: sectorId,
      action: 'UPDATE',
      before: before.collaborators.map(({ id, hours }) => ({ id, hours })),
      after: after.collaborators.map(({ id, hours }) => ({ id, hours })),
    });
    return after;
  }

  /* ------------------------------------------- patrimônios e comparativo */

  async depreciation(companyId: string) {
    const { referenceMonth, assets } = await this.snapshots.load(companyId);
    const sum = (pick: (value: (typeof assets)[number]) => number | null) =>
      assets.reduce((total, asset) => total + (pick(asset) ?? 0), 0);
    return {
      referenceMonth,
      invested: sum(({ row }) => row.acquisitionValue),
      depreciated: sum(
        ({ computed }) => computed.depreciation.depreciatedValue,
      ),
      remaining: sum(({ computed }) => computed.depreciation.remainingValue),
      // Só o bem que ainda deprecia custa depreciação no mês
      monthlyDepreciation: sum(({ computed }) =>
        (computed.depreciation.remainingValue ?? 0) > 0
          ? computed.depreciation.monthlyDepreciation
          : 0,
      ),
      activeAssets: assets.length,
    };
  }

  /**
   * Previsto × realizado nas contas de despesa que não são administrativas
   * (§10). O previsto sai, por enquanto, só dos custos dos bens ligados à
   * conta (custo mensal × meses do período); km rodados, m² vendidos, custo
   * financeiro e material das composições vendidas ainda não têm volume
   * guardado (entrega parcial). Depreciação não entra (ORG-5).
   */
  async comparison(companyId: string, filter: ComparisonFilterDto) {
    const snapshot = await this.snapshots.load(companyId);
    const months = Number(filter.period ?? '12');
    const reference = snapshot.referenceMonth;
    const start = monthStart(shiftMonth(reference, -(months - 1)));
    const end = monthStart(shiftMonth(reference, 1));
    const admin = new Set(snapshot.expenses.accounts.map((item) => item.id));

    const accounts = await this.prisma.subCategory.findMany({
      where: {
        companyId,
        isActive: true,
        nature: { level1: '02', isActive: true },
      },
      select: {
        id: true,
        code: true,
        description: true,
        nature: { select: { code: true, level1: true, level2: true } },
      },
    });
    const rest = accounts.filter((account) => !admin.has(account.id));
    const actual = await this.prisma.payable.groupBy({
      by: ['subCategoryId'],
      where: {
        companyId,
        subCategoryId: { in: rest.map((account) => account.id) },
        referenceDate: { gte: start, lt: end },
        ...REALIZED_PAYABLE,
      },
      _sum: { totalAmount: true },
    });
    const actualOf = new Map(
      actual.map((row) => [row.subCategoryId, row._sum.totalAmount ?? 0]),
    );

    const rows = rest
      .map((account) => {
        const sources = snapshot.assets.flatMap(({ row, computed }) =>
          computed.costs
            .filter((cost) => cost.subCategoryId === account.id)
            .map((cost) => ({
              id: cost.id,
              name: row.name,
              detail: cost.name,
              value: cost.monthlyCost * months,
            })),
        );
        const estimated = sources.length
          ? sources.reduce((sum, source) => sum + source.value, 0)
          : null;
        const realized = Math.round(actualOf.get(account.id) ?? 0);
        const difference = estimated === null ? null : estimated - realized;
        return {
          id: account.id,
          chartAccount: accountCodeOf(account.nature, account.code),
          name: account.description ?? '',
          estimated,
          actual: realized,
          difference,
          differencePercent:
            estimated && difference !== null
              ? Math.round((difference / estimated) * 1000) / 10
              : null,
          sources,
        };
      })
      // Só a conta com previsão ou com lançamento no período
      .filter((row) => row.estimated !== null || row.actual > 0)
      .sort((a, b) =>
        a.chartAccount.localeCompare(b.chartAccount, 'pt-BR', {
          numeric: true,
        }),
      );

    const withEstimate = rows.filter((row) => row.estimated !== null).length;
    const status = filter.status ?? 'todas';
    const filtered = rows.filter((row) =>
      status === 'com-previsao'
        ? row.estimated !== null
        : status === 'sem-previsao'
          ? row.estimated === null
          : true,
    );
    return {
      referenceMonth: reference,
      period: String(months),
      months: monthsUpTo(reference, months).reverse(),
      coverage: {
        total: rows.length,
        withEstimate,
        withoutEstimate: rows.length - withEstimate,
      },
      ...pageOf(filtered, filter),
    };
  }

  /* ------------------------------------------- apoio */

  private accountOf(snapshot: CostBaseSnapshot, id: string) {
    const account = snapshot.expenses.accounts.find((item) => item.id === id);
    if (!account) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    return account;
  }

  private criterionView(account: {
    criterion: string;
    manualValue: number | null;
    referenceValue: number | null;
  }) {
    return {
      criterion: account.criterion,
      manualValue: account.manualValue,
      referenceValue: account.referenceValue,
    };
  }

  private allocationDialogOf(
    snapshot: CostBaseSnapshot,
    account: CostBaseSnapshot['expenses']['accounts'][number],
  ) {
    const shares = new Map(
      account.allocations.map((share) => [share.sectorId, share.percentage]),
    );
    return {
      accountId: account.id,
      accountName: account.name,
      referenceValue: account.referenceValue ?? 0,
      sectors: snapshot.costs.sectors
        .filter((sector) => sector.nature === 'PRODUCTIVE')
        .map((sector) => ({
          id: sector.id,
          name: sector.name,
          ownCost: sector.ownCost,
          percentage: shares.get(sector.id) ?? 0,
        })),
    };
  }

  private distributionOf(snapshot: CostBaseSnapshot) {
    const { costs, expenses } = snapshot;
    return {
      referenceMonth: snapshot.referenceMonth,
      sectors: costs.sectors.map((sector) => ({
        id: sector.id,
        name: sector.name,
        nature: sector.nature,
        percentage: sector.percentage,
        directCost: sector.ownCost,
      })),
      totals: {
        administrativeCost: costs.administrativeCost,
        allocatedByItem: expenses.allocatedValue,
        distributedCost: costs.distributedCost,
        notDistributedCost: costs.administrativeCost - costs.distributedCost,
        receivingSectors: costs.sectors.filter(
          (sector) => sector.nature === 'PRODUCTIVE' && sector.percentage > 0,
        ).length,
      },
    };
  }

  private allocationView(allocation: CostBaseSnapshot['allocations'][number]) {
    return {
      sectorId: allocation.sectorId,
      sectorName: allocation.sectorName,
      criterion: allocation.criterion,
      previousCriterion: allocation.previousCriterion,
      allocationOutdated: allocation.allocationOutdated,
      pool: allocation.pool,
      equipment: allocation.equipment.map(
        ({ poolShare: _poolShare, ...item }) => item,
      ),
      missingTime: allocation.missingTime,
    };
  }
}
