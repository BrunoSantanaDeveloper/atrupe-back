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
  ComparisonSettingsDto,
  DistributionDto,
  ExpenseAllocationDto,
  LaborHoursDto,
  SectorAllocationDto,
  UpdateAdminExpenseDto,
} from './dto/cost-base.dto';
import { manualFits } from './engine/allocation';
import {
  ComparisonSource,
  ExpenseAccount,
  MachineAsset,
  Reading,
  SoldUse,
  assetCostSourceOf,
  financialCostSourceOf,
  itemMaterialCostOf,
  materialSourceOf,
  readingVolumeOf,
  soldVolumesOf,
  sourceAccountsOf,
  usesOf,
  volumeOf,
} from './engine/comparison';
import { criterionValueOf } from './engine/expenses';
import { toMinute } from './engine/labor';
import {
  monthStart,
  monthStartInstant,
  monthsUpTo,
  shiftMonth,
} from './engine/months';
import { distributionFits, summaryOf } from './engine/sectors';

const ACCOUNT_NOT_FOUND = 'Conta não encontrada';
const SECTOR_NOT_FOUND = 'Setor não encontrado';
/** Itens vendidos lidos por vez no comparativo (o ano inteiro de retratos) */
const SOLD_PAGE = 500;

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
    // Pelos percentuais ou pelo valor, com 1 centavo de tolerância
    const fits = distributionFits(
      account.referenceValue ?? 0,
      shares.map((share) => share.percentage),
    );
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
   * (§10). O previsto é a soma das fontes da conta, cada uma a estimativa
   * do cadastro × o volume do período:
   * - custo do bem ligado à conta: o fixo, custo mensal × meses; o variável
   *   da máquina, pelas leituras do contador, pelo vendido nas composições
   *   ou pela produtividade do cadastro, nessa ordem; o variável da
   *   configuração, pelo vendido nela ou pela produtividade dela;
   * - custo financeiro: o percentual da Precificação × o recebido, na conta
   *   do custo financeiro;
   * - material das composições vendidas no período, na conta do material.
   * O realizado é o contas a pagar realizado na conta mais as saídas do
   * caixa lançadas direto nela, sem parcela. Depreciação não entra (ORG-5).
   */
  async comparison(companyId: string, filter: ComparisonFilterDto) {
    const snapshot = await this.snapshots.load(companyId);
    const months = Number(filter.period ?? '12');
    const reference = snapshot.referenceMonth;
    const firstMonth = shiftMonth(reference, -(months - 1));
    const nextMonth = shiftMonth(reference, 1);
    // Datas sem horário (competência, leitura, pagamento da parcela) pela
    // meia-noite UTC; a aprovação da venda e o lançamento do caixa são
    // instantes, pelo mês de São Paulo
    const start = monthStart(firstMonth);
    const end = monthStart(nextMonth);
    const startInstant = monthStartInstant(firstMonth);
    const endInstant = monthStartInstant(nextMonth);

    const accounts = await this.comparisonAccountsOf(companyId, snapshot);
    const ids = accounts.map((account) => account.id);
    const linked = await this.linkedAccountsOf(companyId, accounts);

    // O volume de cada bem e de cada configuração no período
    const machines: MachineAsset[] = snapshot.assets.map(
      ({ row, computed }) => ({
        id: row.id,
        groupId: row.groupId,
        productivity: computed.productivity,
        setups: row.setups.map((setup) => ({
          id: setup.id,
          unit: setup.unit,
          timePerUnit: setup.timePerUnit,
          monthlyProductivity: setup.monthlyProductivity,
        })),
      }),
    );
    const [payables, outflows, readings, sales, groups, received, pricing] =
      await Promise.all([
        this.prisma.payable.groupBy({
          by: ['subCategoryId'],
          where: {
            companyId,
            subCategoryId: { in: ids },
            referenceDate: { gte: start, lt: end },
            ...REALIZED_PAYABLE,
          },
          _sum: { totalAmount: true },
        }),
        this.cashOutflowsOf(companyId, ids, startInstant, endInstant),
        this.readingsOf(companyId, start, end),
        this.soldOf(companyId, startInstant, endInstant),
        this.prisma.assetGroup.findMany({
          where: { companyId },
          select: { id: true, unit: true },
        }),
        linked.financialCost ? this.receivedOf(companyId, start, end) : 0,
        this.prisma.pricingParameters.findUnique({
          where: { companyId },
          select: { financialCost: true },
        }),
      ]);
    const sold = soldVolumesOf(sales.uses, machines, groups);

    // O realizado, em centavos, como o contas a pagar guarda (17/11/2026:
    // antes multiplicava por 100, e a despesa saía 100 vezes maior)
    const actualOf = new Map(outflows);
    for (const row of payables) {
      actualOf.set(
        row.subCategoryId!,
        (actualOf.get(row.subCategoryId!) ?? 0) +
          Math.round(row._sum.totalAmount ?? 0),
      );
    }

    // As fontes de cada conta: os custos dos bens ligados a ela
    const sourcesOf = new Map<string, ComparisonSource[]>();
    const push = (accountId: string, source: ComparisonSource) =>
      sourcesOf.set(accountId, [...(sourcesOf.get(accountId) ?? []), source]);
    for (const { row, computed } of snapshot.assets) {
      const readingVolume = readingVolumeOf(
        readings.get(row.id) ?? [],
        start,
        end,
      );
      for (const cost of computed.costs) {
        if (!cost.subCategoryId) continue;
        const setup =
          cost.nature === 'SETUP_VARIABLE'
            ? row.setups.find((item) => item.id === cost.setupId)
            : undefined;
        const volume = setup
          ? volumeOf({
              readings: null,
              sold: sold.setups.get(setup.id) ?? 0,
              productivity: setup.monthlyProductivity,
              months,
            })
          : volumeOf({
              readings: readingVolume,
              sold: sold.assets.get(row.id) ?? 0,
              productivity: computed.productivity,
              months,
            });
        const source = assetCostSourceOf({
          assetName: row.name,
          unit: row.unit,
          cost: {
            id: cost.id,
            label: setup ? `${cost.name} (${setup.name})` : cost.name,
            unitCost: cost.unitCost,
            yieldAmount: cost.yieldAmount,
            yieldUnit: cost.yieldUnit,
            monthlyCost: cost.monthlyCost,
          },
          volume,
          months,
        });
        push(cost.subCategoryId, source);
      }
    }
    // As fontes sem bem, cada uma na sua conta (sem conta, não aparece)
    if (linked.material) {
      push(
        linked.material,
        materialSourceOf(sales.materialCost, sales.materialSales),
      );
    }
    const financial = linked.financialCost
      ? financialCostSourceOf(pricing?.financialCost ?? 0, received)
      : null;
    if (financial) push(linked.financialCost!, financial);

    const rows = accounts
      .map((account) => {
        const sources = sourcesOf.get(account.id) ?? [];
        const estimated = sources.length
          ? sources.reduce((sum, source) => sum + source.value, 0)
          : null;
        const realized = actualOf.get(account.id) ?? 0;
        const difference = estimated === null ? null : estimated - realized;
        return {
          id: account.id,
          chartAccount: account.chartAccount,
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

  /**
   * As contas das fontes sem bem do comparativo ("Conta do material" e
   * "Conta do custo financeiro"), já resolvidas com o padrão, e as contas
   * que podem ser escolhidas: as do comparativo.
   */
  async comparisonSettings(companyId: string) {
    const snapshot = await this.snapshots.load(companyId);
    const accounts = await this.comparisonAccountsOf(companyId, snapshot);
    return this.comparisonSettingsView(
      accounts,
      await this.linkedAccountsOf(companyId, accounts),
    );
  }

  /**
   * Escolhe as contas das fontes sem bem; `null` volta ao padrão e o campo
   * que não vem fica como está. Só uma das contas do comparativo: de
   * despesa, ativa, da empresa e fora do administrativo (a administrativa
   * não aparece no comparativo, a fonte sumiria).
   */
  async updateComparisonSettings(
    companyId: string,
    userId: string | null,
    dto: ComparisonSettingsDto,
  ) {
    const snapshot = await this.snapshots.load(companyId);
    const accounts = await this.comparisonAccountsOf(companyId, snapshot);
    for (const id of [
      dto.materialSubCategoryId,
      dto.financialCostSubCategoryId,
    ]) {
      if (id && !accounts.some((account) => account.id === id)) {
        bad('Escolha uma conta de despesa da empresa');
      }
    }
    const before = await this.chosenAccountsOf(companyId);
    const data = {
      ...(dto.materialSubCategoryId !== undefined && {
        materialSubCategoryId: dto.materialSubCategoryId,
      }),
      ...(dto.financialCostSubCategoryId !== undefined && {
        financialCostSubCategoryId: dto.financialCostSubCategoryId,
      }),
    };
    const after = await this.prisma.costBaseSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
      select: { materialSubCategoryId: true, financialCostSubCategoryId: true },
    });
    // O histórico guarda a escolha (nula = o padrão)
    await this.audit.record({
      companyId,
      userId,
      entity: 'COST_BASE_COMPARISON_SETTINGS',
      entityId: companyId,
      action: 'UPDATE',
      before: before ?? {
        materialSubCategoryId: null,
        financialCostSubCategoryId: null,
      },
      after,
    });
    return this.comparisonSettingsView(
      accounts,
      sourceAccountsOf(accounts, after),
    );
  }

  /* ------------------------------------------- apoio */

  /**
   * As leituras do contador que o período usa, por bem: as de dentro dele e
   * a última antes do início (o resto do histórico não muda a conta).
   */
  private async readingsOf(companyId: string, start: Date, end: Date) {
    const select = { assetId: true, date: true, value: true } as const;
    const [inside, previous] = await Promise.all([
      this.prisma.assetReading.findMany({
        where: { companyId, date: { gte: start, lt: end } },
        select,
      }),
      this.prisma.assetReading.groupBy({
        by: ['assetId'],
        where: { companyId, date: { lt: start } },
        _max: { date: true },
      }),
    ]);
    const before = previous.length
      ? await this.prisma.assetReading.findMany({
          where: {
            companyId,
            OR: previous.map((row) => ({
              assetId: row.assetId,
              date: row._max.date!,
            })),
          },
          select,
        })
      : [];
    const byAsset = new Map<string, Reading[]>();
    for (const row of [...before, ...inside]) {
      byAsset.set(row.assetId, [
        ...(byAsset.get(row.assetId) ?? []),
        { date: row.date, value: row.value },
      ]);
    }
    return byAsset;
  }

  /**
   * As contas do comparativo: as de despesa ativas que não são
   * administrativas (§10), com o código como o plano mostra, na ordem dele.
   */
  private async comparisonAccountsOf(
    companyId: string,
    snapshot: CostBaseSnapshot,
  ) {
    const admin = new Set(snapshot.expenses.accounts.map((item) => item.id));
    const rows = await this.prisma.subCategory.findMany({
      where: {
        companyId,
        isActive: true,
        nature: { level1: '02', isActive: true },
      },
      select: {
        id: true,
        code: true,
        description: true,
        nature: {
          select: { code: true, level1: true, level2: true, description: true },
        },
      },
    });
    return rows
      .filter((row) => !admin.has(row.id))
      .map((row) => ({
        ...row,
        chartAccount: accountCodeOf(row.nature, row.code),
      }))
      .sort((a, b) =>
        a.chartAccount.localeCompare(b.chartAccount, 'pt-BR', {
          numeric: true,
        }),
      );
  }

  /** As contas escolhidas para as fontes sem bem, como estão gravadas. */
  private async chosenAccountsOf(companyId: string) {
    return this.prisma.costBaseSettings.findUnique({
      where: { companyId },
      select: { materialSubCategoryId: true, financialCostSubCategoryId: true },
    });
  }

  /**
   * A conta de cada fonte sem bem: a escolhida em "Conta do material" e
   * "Conta do custo financeiro", senão a do padrão pelo nome ("Matéria
   * Prima", "Tarifa de Cartão de Crédito"), entre as do comparativo.
   */
  private async linkedAccountsOf(
    companyId: string,
    accounts: ExpenseAccount[],
  ) {
    return sourceAccountsOf(accounts, await this.chosenAccountsOf(companyId));
  }

  private comparisonSettingsView(
    accounts: (ExpenseAccount & { chartAccount: string })[],
    linked: ReturnType<typeof sourceAccountsOf>,
  ) {
    return {
      materialSubCategoryId: linked.material,
      financialCostSubCategoryId: linked.financialCost,
      accounts: accounts.map((account) => ({
        id: account.id,
        chartAccount: account.chartAccount,
        name: account.description ?? '',
      })),
    };
  }

  /**
   * O que foi vendido no período: as vendas aprovadas nele, com a O.S. de
   * pé (o mesmo recorte dos relatórios de venda), lidas em páginas para não
   * carregar o ano inteiro de retratos de uma vez. Do retrato de cada item e
   * das linhas acrescentadas nele (ORC-5) saem as linhas de máquina (o
   * volume vendido) e o material estimado, com quantas vendas tiveram
   * material.
   */
  private async soldOf(companyId: string, start: Date, end: Date) {
    const uses: SoldUse[] = [];
    let materialCost = 0;
    const withMaterial = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const page = await this.prisma.quotationProduct.findMany({
        where: {
          quotation: {
            companyId,
            approvedAt: { gte: start, lt: end },
            order: { status: { not: 'CANCELED' } },
          },
        },
        orderBy: { id: 'asc' },
        take: SOLD_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          quotationId: true,
          origin: true,
          quantity: true,
          material: { select: { cost: true } },
          materialVariation: { select: { cost: true } },
          snapshot: { select: { data: true } },
          lines: { select: { resolved: true } },
        },
      });
      for (const item of page) {
        const itemUses = [
          ...usesOf(item.snapshot?.data),
          ...item.lines.flatMap((line) => usesOf(line.resolved)),
        ];
        uses.push(
          ...itemUses.filter((use) => use.resourceId?.startsWith('machine')),
        );
        const cost = itemMaterialCostOf({
          origin: item.origin,
          quantity: item.quantity,
          // Com variação, o custo é o dela (MT-3)
          materialCost:
            item.materialVariation?.cost ?? item.material?.cost ?? null,
          uses: itemUses,
        });
        if (cost > 0) {
          materialCost += cost;
          withMaterial.add(item.quotationId);
        }
      }
      if (page.length < SOLD_PAGE) break;
      cursor = page[page.length - 1].id;
    }
    return { uses, materialCost, materialSales: withMaterial.size };
  }

  /**
   * As saídas do caixa lançadas direto numa conta do comparativo, sem
   * parcela do contas a pagar ou a receber (a taxa da operadora na
   * liquidação do cartão, o lançamento criado pela conciliação do extrato,
   * o ajuste de saída): o contas a pagar não as vê. Não entram a
   * transferência (só a saída comum, OUTCOME, conta), o estorno (REVERSAL) e
   * o lançamento estornado (o estorno aponta para ele pelo linkedId): o par
   * se anula, em qualquer mês que o estorno caia. Reais no banco; aqui,
   * centavos por conta.
   */
  private async cashOutflowsOf(
    companyId: string,
    accountIds: string[],
    start: Date,
    end: Date,
  ) {
    const byAccount = new Map<string, number>();
    if (!accountIds.length) return byAccount;
    const rows = await this.prisma.transaction.findMany({
      where: {
        type: 'OUTCOME',
        subCategoryId: { in: accountIds },
        transactionDate: { gte: start, lt: end },
        payableInstallment: { none: {} },
        receivableInstallment: { none: {} },
        AND: [
          // `not` sozinho deixaria de fora o lançamento sem kind
          { OR: [{ kind: null }, { kind: { not: 'REVERSAL' } }] },
          // A conta sem controle lança sem caixa; o caixa antigo, sem conta
          {
            OR: [
              { bankAccount: { companyId } },
              { cashRegister: { companyId } },
            ],
          },
        ],
      },
      select: { id: true, subCategoryId: true, amount: true },
    });
    if (!rows.length) return byAccount;
    const reversals = await this.prisma.transaction.findMany({
      where: { kind: 'REVERSAL', linkedId: { in: rows.map((row) => row.id) } },
      select: { linkedId: true },
    });
    const reversed = new Set(reversals.map((row) => row.linkedId));
    for (const row of rows) {
      if (reversed.has(row.id)) continue;
      byAccount.set(
        row.subCategoryId!,
        (byAccount.get(row.subCategoryId!) ?? 0) + Math.round(row.amount),
      );
    }
    return byAccount;
  }

  /**
   * O recebido no período: as parcelas do contas a receber pagas, pela
   * data do pagamento; a provisionada (cartão a compensar) vale pela data da
   * provisão, como no fluxo de caixa, e a compensada não conta duas vezes.
   * O valor pago (sem ele, o da parcela), em centavos, como no banco.
   */
  private async receivedOf(companyId: string, start: Date, end: Date) {
    const rows = await this.prisma.receivableInstallment.findMany({
      where: {
        status: { in: ['PAID', 'PROVISIONED'] },
        receivable: { companyId, status: { not: 'CANCELED' } },
        OR: [
          { provisionDate: { gte: start, lt: end } },
          { provisionDate: null, paidDate: { gte: start, lt: end } },
        ],
      },
      select: { amount: true, paidAmount: true },
    });
    return rows.reduce(
      (sum, row) => sum + Math.round(row.paidAmount ?? row.amount),
      0,
    );
  }

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
