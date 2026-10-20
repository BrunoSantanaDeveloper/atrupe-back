import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { CostAuditService } from '../cost-base/cost-audit.service';
import { ASSET_POOL, AssetPool } from './asset-pool';
import { actorOfUser } from '../financial/cash-control/cash-ledger';
import { accountCodeOf } from '../financial/nature/account-code';
import { toProjectDateKey } from '../fiscal/utils/project-date.util';
import { UNIT_SYMBOL } from '../material/material-text';
import {
  AssetInput,
  activityHoursOf,
  depreciationOf,
  equipmentOwnCostOf,
  monthlyCostOf,
  productivityOf,
  setupUnitCostsOf,
  statusOf,
} from './asset-math';
import {
  AssetCostDto,
  AssetFilterDto,
  AssetReadingDto,
  AssetSetupDto,
  CreateAssetDto,
  ReadingFilterDto,
  SellAssetDto,
  ToggleAssetDto,
  UpdateAssetCostDto,
  UpdateAssetDto,
  UpdateAssetSetupDto,
} from './dto/asset.dto';

export const ASSET_NOT_FOUND = 'Patrimônio não encontrado';
export const READING_NOT_FOUND = 'Leitura não encontrada';
/** Teto de itens por página (SEG-2). */
export const ASSET_PAGE_LIMIT = 100;

const COST_NOT_FOUND = 'Custo não encontrado';
const SETUP_NOT_FOUND = 'Configuração não encontrada';

type ReadingRow = {
  id: string;
  date: Date;
  value: number;
  createdById: string | null;
  createdByName: string;
  createdAt: Date;
};

const readingView = (row: ReadingRow) => ({
  id: row.id,
  date: row.date.toISOString().slice(0, 10),
  value: row.value,
  createdById: row.createdById,
  createdByName: row.createdByName,
  createdAt: row.createdAt,
});

// "A leitura não pode voltar: em 05/10/2026 o contador marcava 12.345 km"
const backwardsMessage = (row: ReadingRow, unit: string | null) => {
  const day = row.date.toISOString().slice(0, 10).split('-').reverse();
  const value = row.value.toLocaleString('pt-BR', {
    maximumFractionDigits: 3,
  });
  return `A leitura não pode voltar: em ${day.join('/')} o contador marcava ${value}${unit ? ` ${unit}` : ''}`;
};

/** O recurso de máquina da composição: a configuração ou o grupo (P-28). */
export const machineResourceId = (setupId: string) => `machine:${setupId}`;

export const ASSET_INCLUDE = {
  sector: {
    select: { id: true, name: true, allocationCriterion: true },
  },
  group: { select: { id: true, name: true } },
  costs: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      subCategory: { select: { id: true, code: true, description: true } },
    },
  },
  setups: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.AssetInclude;

export type AssetRow = Prisma.AssetGetPayload<{
  include: typeof ASSET_INCLUDE;
}>;

// Os campos de valor que saem sem `values:values:view`
const VALUE_FIELDS = [
  'acquisitionValue',
  'residualValue',
  'monthlyDepreciation',
  'depreciableValue',
  'depreciatedValue',
  'remainingValue',
  'saleValue',
  'saleResult',
  'monthlyCost',
  'ownCost',
  // A configuração sai sem custo e sem preço; os custos do bem, inteiros
  'unitCost',
  'salePrice',
  'costs',
] as const;

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const dateOnly = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : null;

const toDate = (value: string | null | undefined) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null;

/** O bem como as contas do patrimônio leem. */
export const assetInputOf = (row: {
  active: boolean;
  detailed: boolean;
  acquisitionDate: Date | null;
  acquisitionValue: number;
  usefulLifeMonths: number | null;
  residualPercent: number | null;
  usefulLifeReviewedAt: Date | null;
  monthlyProductivity: number | null;
}): AssetInput => ({
  active: row.active,
  detailed: row.detailed,
  acquisitionDate: row.acquisitionDate,
  acquisitionValue: row.acquisitionValue,
  usefulLifeMonths: row.usefulLifeMonths,
  residualPercent: row.residualPercent,
  usefulLifeReviewedAt: row.usefulLifeReviewedAt,
  monthlyProductivity: row.monthlyProductivity,
});

/**
 * As contas de um bem com os custos e as configurações dele: depreciação,
 * situação, custo mensal de cada custo, o custo próprio do equipamento no
 * mês e o custo por unidade de cada configuração. `pool` é a parte do
 * rateio do setor que cabe ao bem (a base de custos calcula; sem ela, zero).
 */
export const computeAsset = (row: AssetRow, today: Date, pool = 0) => {
  const input = assetInputOf(row);
  const setups = row.setups.map((setup) => ({
    id: setup.id,
    timePerUnit: setup.timePerUnit,
    monthlyProductivity: setup.monthlyProductivity,
  }));
  const productivity = productivityOf(input, setups);
  const depreciation = depreciationOf(input, today);
  const status = statusOf(input, today, {
    sectorByTime: row.sector?.allocationCriterion === 'ACTIVITY_TIME',
    setups,
  });
  const setupProductivity = new Map(
    setups.map((setup) => [setup.id, setup.monthlyProductivity]),
  );
  const costs = row.costs.map((cost) => ({
    ...cost,
    monthlyCost: monthlyCostOf(cost, {
      asset: productivity,
      setup: (setupId) => setupProductivity.get(setupId) ?? 0,
    }),
  }));
  const ownCost = row.active
    ? equipmentOwnCostOf(depreciation.monthlyDepreciation, costs)
    : 0;
  const setupVariable = (setupId: string) =>
    row.costs
      .filter(
        (cost) =>
          cost.nature === 'SETUP_VARIABLE' &&
          cost.setupId === setupId &&
          cost.yieldAmount > 0,
      )
      .reduce((sum, cost) => sum + cost.unitCost / cost.yieldAmount, 0);
  const setupUnitCosts = setupUnitCostsOf(
    ownCost + pool,
    setups,
    setupVariable,
  );
  const machineVariablePerUnit = row.costs
    .filter(
      (cost) => cost.nature === 'MACHINE_VARIABLE' && cost.yieldAmount > 0,
    )
    .reduce((sum, cost) => sum + cost.unitCost / cost.yieldAmount, 0);
  // O custo de uma unidade do bem: o mês dividido pela produtividade (P-28)
  const unitCost =
    row.detailed && productivity > 0
      ? Math.round((ownCost + pool) / productivity)
      : null;
  return {
    productivity,
    depreciation,
    status,
    costs,
    ownCost,
    setupUnitCosts,
    unitCost,
    machineVariablePerUnit,
  };
};

const omitValues = <T>(body: T, values: boolean): T => {
  if (values) return body;
  const prune = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(prune);
    if (!value || typeof value !== 'object' || value instanceof Date) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !(VALUE_FIELDS as readonly string[]).includes(key))
        .map(([key, child]) => [key, prune(child)]),
    );
  };
  return prune(body) as T;
};

/**
 * Patrimônios da empresa (módulo 4, P-1 a P-32): cadastro rápido, depreciação
 * calculada na leitura, custos e configurações produtivas, venda e
 * inativação (nunca exclusão). Toda escrita que muda custo vai para o
 * histórico (SEG-4); sem `values:values:view`, os valores não saem.
 */
@Injectable()
export class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: CostAuditService,
    // A base de custos dá a parte do rateio do setor que cabe ao bem
    @Optional() @Inject(ASSET_POOL) private readonly pool?: AssetPool,
  ) {}

  /* ---------------------------------------------------------------- leitura */

  async list(companyId: string, filter: AssetFilterDto, values: boolean) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 50, ASSET_PAGE_LIMIT);
    const search = filter.search?.trim();
    const rows = await this.prisma.asset.findMany({
      where: {
        companyId,
        ...(filter.sectorId ? { sectorId: filter.sectorId } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: ASSET_INCLUDE,
    });
    const today = new Date();
    const status = filter.status ?? 'ativos';
    const items = rows
      .map((row) => this.view(row, today, false))
      .filter((item) => {
        switch (status) {
          case 'em-depreciacao':
            return ['DEPRECIATING', 'DEPRECIATED'].includes(item.status);
          case 'em-revisao':
            return item.status === 'REVIEW_NEEDED';
          case 'inconsistencias':
            return item.status === 'INCONSISTENT';
          case 'inativos':
            return item.status === 'INACTIVE';
          default:
            return item.status !== 'INACTIVE';
        }
      });
    return omitValues(
      {
        data: items.slice((page - 1) * limit, page * limit),
        page,
        lastPage: Math.max(1, Math.ceil(items.length / limit)),
        total: items.length,
      },
      values,
    );
  }

  /** As contagens das abas da situação. */
  /**
   * As contas do plano para o custo do bem (despesa, 02) e para a venda
   * (receita, 01), numa lista plana: quem cuida de patrimônio pode não ter a
   * permissão do plano de contas (decisão do PO, 14/10).
   */
  async accounts(companyId: string, type: 'payable' | 'receivable') {
    const rows = await this.prisma.subCategory.findMany({
      where: {
        companyId,
        isActive: true,
        nature: {
          isActive: true,
          level1: type === 'payable' ? '02' : '01',
        },
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
      .map((row) => {
        const code = accountCodeOf(row.nature, row.code);
        return {
          id: row.id,
          code,
          description: row.description ?? '',
          group: row.nature.description ?? '',
          label: [code, row.description].filter(Boolean).join(' — '),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
  }

  async quantity(companyId: string) {
    const rows = await this.prisma.asset.findMany({
      where: { companyId },
      include: ASSET_INCLUDE,
    });
    const today = new Date();
    const counts = {
      'em-depreciacao': 0,
      'em-revisao': 0,
      inconsistencias: 0,
      inativos: 0,
    };
    for (const row of rows) {
      const { status } = computeAsset(row, today);
      if (status === 'DEPRECIATING' || status === 'DEPRECIATED') {
        counts['em-depreciacao'] += 1;
      } else if (status === 'REVIEW_NEEDED') counts['em-revisao'] += 1;
      else if (status === 'INCONSISTENT') counts.inconsistencias += 1;
      else counts.inativos += 1;
    }
    return counts;
  }

  async detail(companyId: string, id: string, values: boolean) {
    const row = await this.findRow(companyId, id);
    return omitValues(await this.detailView(row), values);
  }

  /* ---------------------------------------------------------------- escrita */

  async create(companyId: string, userId: string, dto: CreateAssetDto) {
    await this.assertSector(companyId, dto.sectorId);
    this.assertImage(dto.imageUrl);
    const unit = dto.detailed ? dto.unit : null;
    if (dto.detailed && !unit) bad('Informe a unidade do bem detalhado');
    if (dto.groupId) {
      await this.assertGroup(
        companyId,
        dto.groupId,
        unit ?? null,
        dto.sectorId,
      );
    }
    const created = await this.prisma.asset.create({
      data: {
        companyId,
        name: dto.name,
        imageUrl: dto.imageUrl || null,
        kind: dto.kind,
        sectorId: dto.sectorId,
        groupId: dto.groupId || null,
        detailed: dto.detailed,
        unit,
        monthlyProductivity: dto.detailed
          ? (dto.monthlyProductivity ?? null)
          : null,
        acquisitionDate: toDate(dto.acquisitionDate),
        acquisitionValue: dto.acquisitionValue,
        // Cadastro rápido: o padrão, com lembrete para revisar (P-24)
        usefulLifeMonths: 60,
        residualPercent: 30,
      },
      include: ASSET_INCLUDE,
    });
    if (created.detailed) await this.markAllocationOutdated(created.sectorId);
    const view = await this.detailView(created);
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET',
      entityId: created.id,
      action: 'CREATE',
      after: view,
    });
    return view;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateAssetDto,
  ) {
    const row = await this.findRow(companyId, id);
    if (!row.active) bad('Reative o patrimônio antes de editar');
    const before = await this.detailView(row);
    if (dto.imageUrl !== undefined) this.assertImage(dto.imageUrl);

    const sectorId = dto.sectorId ?? row.sectorId;
    if (dto.sectorId && dto.sectorId !== row.sectorId) {
      await this.assertSector(companyId, dto.sectorId);
    }
    const detailed = dto.detailed ?? row.detailed;
    const unit = detailed
      ? dto.unit !== undefined
        ? dto.unit
        : row.unit
      : null;
    if (detailed && !unit) bad('Informe a unidade do bem detalhado');

    // De detalhado para simplificado: as configurações saem; as usadas em
    // composição pedem confirmação (P-16)
    if (row.detailed && !detailed && row.setups.length) {
      const usage = await this.setupUsage(row.setups.map((setup) => setup.id));
      if (usage.length && !dto.confirmed) {
        throw new ConflictException({
          statusCode: 409,
          message:
            'As configurações deste bem são usadas em composições. Confirme para passar a simplificado',
          compositions: usage,
        });
      }
    }

    const acquisitionValue = dto.acquisitionValue ?? row.acquisitionValue;
    const residualPercent = dto.residualPercent ?? row.residualPercent;
    if (
      residualPercent !== null &&
      residualPercent >= 100 &&
      acquisitionValue > 0
    ) {
      bad('O residual precisa ser menor que o valor de aquisição');
    }

    // Troca de setor tira o bem do grupo de outro setor (P-5.2)
    let groupId = dto.groupId !== undefined ? dto.groupId || null : row.groupId;
    if (groupId) {
      const group = await this.prisma.assetGroup.findFirst({
        where: { id: groupId, companyId },
      });
      if (!group) throw new NotFoundException('Grupo não encontrado');
      const sameSector = !group.sectorId || group.sectorId === sectorId;
      if (dto.groupId === undefined && !sameSector) groupId = null;
      else await this.assertGroup(companyId, groupId, unit, sectorId);
    }

    // A vida útil revista depois do fim: o bem fica depreciado (P-26). Só
    // conta como revisão mudar a vida útil ou o residual: o formulário manda
    // os dois em todo salvar (decisão do PO, 14/10)
    const usefulLifeMonths = dto.usefulLifeMonths ?? row.usefulLifeMonths;
    const reviewed =
      (dto.usefulLifeMonths !== undefined &&
        dto.usefulLifeMonths !== row.usefulLifeMonths) ||
      (dto.residualPercent !== undefined &&
        dto.residualPercent !== row.residualPercent);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (row.detailed && !detailed) {
        await tx.assetSetup.deleteMany({ where: { assetId: id } });
      }
      return tx.asset.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl || null }),
          ...(dto.kind !== undefined && { kind: dto.kind }),
          sectorId,
          groupId,
          detailed,
          unit,
          monthlyProductivity: detailed
            ? dto.monthlyProductivity !== undefined
              ? dto.monthlyProductivity
              : row.monthlyProductivity
            : null,
          ...(dto.acquisitionDate !== undefined && {
            acquisitionDate: toDate(dto.acquisitionDate),
          }),
          acquisitionValue,
          residualPercent,
          usefulLifeMonths,
          ...(reviewed && { usefulLifeReviewedAt: new Date() }),
        },
        include: ASSET_INCLUDE,
      });
    });

    if (row.detailed !== detailed || row.sectorId !== updated.sectorId) {
      await this.markAllocationOutdated(row.sectorId);
      await this.markAllocationOutdated(updated.sectorId);
    }
    const view = await this.detailView(updated);
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET',
      entityId: id,
      action: 'UPDATE',
      before,
      after: view,
    });
    return view;
  }

  /** Inativa ou reativa (nunca exclui). */
  async toggle(
    companyId: string,
    userId: string,
    id: string,
    dto: ToggleAssetDto,
  ) {
    const row = await this.findRow(companyId, id);
    if (dto.active && row.soldAt) bad('Patrimônio vendido não é reativado');
    const warnings: { message: string; compositions: unknown[] }[] = [];
    if (!dto.active && row.setups.length) {
      const usage = await this.setupUsage(row.setups.map((setup) => setup.id));
      if (usage.length) {
        warnings.push({
          message: 'As configurações deste bem são usadas em composições',
          compositions: usage,
        });
      }
    }
    const updated = await this.prisma.asset.update({
      where: { id },
      data: dto.active
        ? { active: true, inactivatedAt: null, inactiveReason: null }
        : {
            active: false,
            inactivatedAt: new Date(),
            inactiveReason: dto.reason || null,
          },
      include: ASSET_INCLUDE,
    });
    if (row.detailed && row.active !== updated.active) {
      await this.markAllocationOutdated(row.sectorId);
    }
    const view = await this.detailView(updated);
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET',
      entityId: id,
      action: dto.active ? 'REACTIVATE' : 'INACTIVATE',
      before: { active: row.active },
      after: { active: updated.active, reason: dto.reason ?? null },
    });
    return { ...view, warnings };
  }

  /**
   * Venda do bem (P-25): o restante é a aquisição menos a depreciação
   * acumulada até a data; o resultado é o recebido menos o restante; a
   * receita entra no financeiro com a conta escolhida; o bem é inativado.
   */
  async sell(companyId: string, userId: string, id: string, dto: SellAssetDto) {
    const row = await this.findRow(companyId, id);
    if (!row.active) bad('Este patrimônio já está inativo');
    const account = await this.prisma.subCategory.findFirst({
      where: { id: dto.financialNatureId, companyId, isActive: true },
      select: {
        id: true,
        natureId: true,
        nature: { select: { level1: true } },
      },
    });
    // Receita: o primeiro nível do plano de contas é o 01
    if (!account || account.nature.level1 !== '01') {
      bad('Escolha uma conta de receita do plano de contas');
    }
    if (dto.bankAccountId) {
      const bank = await this.prisma.bankAccount.findFirst({
        where: { id: dto.bankAccountId, companyId },
        select: { id: true },
      });
      if (!bank) throw new NotFoundException('Conta bancária não encontrada');
    }

    const date = toDate(dto.date)!;
    const depreciation = depreciationOf(assetInputOf(row), date);
    const remaining =
      row.acquisitionValue - (depreciation.depreciatedValue ?? 0);
    const result = dto.value - remaining;

    // O valor chega em centavos; o contas a receber guarda reais (Float)
    const saleReais = dto.value / 100;
    const receivableId = await this.prisma.$transaction(async (tx) => {
      let entryId: string | null = null;
      if (dto.value > 0) {
        const receivable = await tx.receivable.create({
          data: {
            companyId,
            description: `Venda do patrimônio ${row.name}`,
            referenceDate: date,
            totalAmount: saleReais,
            totalValue: saleReais,
            installmentQty: 1,
            mainAdditionalFee: 0,
            natureId: account!.natureId,
            subCategoryId: account!.id,
          },
        });
        await tx.receivableInstallment.create({
          data: {
            receivableId: receivable.id,
            installmentNumber: 1,
            dueDate: date,
            amount: saleReais,
            additionalFee: 0,
            bankAccountId: dto.bankAccountId ?? null,
          },
        });
        entryId = receivable.id;
      }
      await tx.asset.update({
        where: { id },
        data: {
          active: false,
          inactivatedAt: date,
          inactiveReason: 'Venda',
          soldAt: date,
          saleValue: dto.value,
          saleResult: result,
          saleReceivableId: entryId,
        },
      });
      return entryId;
    });
    if (row.detailed) await this.markAllocationOutdated(row.sectorId);

    const response = {
      received: dto.value,
      remaining,
      result,
      financialEntryId: receivableId,
    };
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET',
      entityId: id,
      action: 'SELL',
      before: { active: true },
      after: response,
    });
    return response;
  }

  /* ----------------------------------------------------------- custos do bem */

  async addCost(
    companyId: string,
    userId: string,
    id: string,
    dto: AssetCostDto,
  ) {
    const row = await this.activeRow(companyId, id);
    await this.assertCost(companyId, row, dto);
    const cost = await this.prisma.assetCost.create({
      data: {
        assetId: id,
        name: dto.name,
        nature: dto.nature,
        unitCost: dto.unitCost,
        yieldAmount: dto.yieldAmount,
        yieldUnit: dto.yieldUnit,
        subCategoryId: dto.financialNatureId || null,
        lastOccurrence: toDate(dto.lastOccurrence),
        setupId: dto.nature === 'SETUP_VARIABLE' ? dto.setupId! : null,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_COST',
      entityId: cost.id,
      action: 'CREATE',
      after: cost,
    });
    return this.detail(companyId, id, true);
  }

  async updateCost(
    companyId: string,
    userId: string,
    id: string,
    costId: string,
    dto: UpdateAssetCostDto,
  ) {
    const row = await this.activeRow(companyId, id);
    const current = row.costs.find((cost) => cost.id === costId);
    if (!current) throw new NotFoundException(COST_NOT_FOUND);
    const merged: AssetCostDto = {
      name: dto.name ?? current.name,
      nature: dto.nature ?? current.nature,
      unitCost: dto.unitCost ?? current.unitCost,
      yieldAmount: dto.yieldAmount ?? current.yieldAmount,
      yieldUnit: dto.yieldUnit ?? current.yieldUnit,
      financialNatureId:
        dto.financialNatureId !== undefined
          ? dto.financialNatureId
          : current.subCategoryId,
      lastOccurrence:
        dto.lastOccurrence !== undefined
          ? dto.lastOccurrence
          : dateOnly(current.lastOccurrence),
      setupId: dto.setupId !== undefined ? dto.setupId : current.setupId,
    };
    await this.assertCost(companyId, row, merged);
    const updated = await this.prisma.assetCost.update({
      where: { id: costId },
      data: {
        name: merged.name,
        nature: merged.nature,
        unitCost: merged.unitCost,
        yieldAmount: merged.yieldAmount,
        yieldUnit: merged.yieldUnit,
        subCategoryId: merged.financialNatureId || null,
        lastOccurrence: toDate(merged.lastOccurrence),
        setupId: merged.nature === 'SETUP_VARIABLE' ? merged.setupId! : null,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_COST',
      entityId: costId,
      action: 'UPDATE',
      before: current,
      after: updated,
    });
    return this.detail(companyId, id, true);
  }

  async removeCost(
    companyId: string,
    userId: string,
    id: string,
    costId: string,
  ) {
    const row = await this.activeRow(companyId, id);
    const current = row.costs.find((cost) => cost.id === costId);
    if (!current) throw new NotFoundException(COST_NOT_FOUND);
    await this.prisma.assetCost.delete({ where: { id: costId } });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_COST',
      entityId: costId,
      action: 'DELETE',
      before: current,
    });
    return this.detail(companyId, id, true);
  }

  /* --------------------------------------------- configurações produtivas */

  async addSetup(
    companyId: string,
    userId: string,
    id: string,
    dto: AssetSetupDto,
  ) {
    const row = await this.activeRow(companyId, id);
    this.assertSetup(row, dto, null);
    const setup = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assetSetup.create({
        data: {
          assetId: id,
          name: dto.name,
          abbreviation: dto.abbreviation ?? '',
          unit: dto.unit,
          timePerUnit: dto.timePerUnit,
          monthlyProductivity: dto.monthlyProductivity,
        },
      });
      await this.syncProductivity(tx, id);
      return created;
    });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_SETUP',
      entityId: setup.id,
      action: 'CREATE',
      after: setup,
    });
    return this.detail(companyId, id, true);
  }

  async updateSetup(
    companyId: string,
    userId: string,
    id: string,
    setupId: string,
    dto: UpdateAssetSetupDto,
  ) {
    const row = await this.activeRow(companyId, id);
    const current = row.setups.find((setup) => setup.id === setupId);
    if (!current) throw new NotFoundException(SETUP_NOT_FOUND);
    const merged: AssetSetupDto = {
      name: dto.name ?? current.name,
      abbreviation: dto.abbreviation ?? current.abbreviation,
      unit: dto.unit ?? current.unit,
      timePerUnit: dto.timePerUnit ?? current.timePerUnit,
      monthlyProductivity:
        dto.monthlyProductivity ?? current.monthlyProductivity,
    };
    this.assertSetup(row, merged, setupId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.assetSetup.update({
        where: { id: setupId },
        data: merged,
      });
      await this.syncProductivity(tx, id);
      return saved;
    });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_SETUP',
      entityId: setupId,
      action: 'UPDATE',
      before: current,
      after: updated,
    });
    return this.detail(companyId, id, true);
  }

  async removeSetup(
    companyId: string,
    userId: string,
    id: string,
    setupId: string,
  ) {
    const row = await this.activeRow(companyId, id);
    const current = row.setups.find((setup) => setup.id === setupId);
    if (!current) throw new NotFoundException(SETUP_NOT_FOUND);
    const usage = await this.setupUsage([setupId]);
    if (usage.length) {
      throw new ConflictException({
        statusCode: 409,
        message:
          'Esta configuração é usada em composições. Tire-a das composições antes de excluir',
        compositions: usage,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.assetSetup.delete({ where: { id: setupId } });
      await this.syncProductivity(tx, id);
    });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_SETUP',
      entityId: setupId,
      action: 'DELETE',
      before: current,
    });
    return this.detail(companyId, id, true);
  }

  /* ------------------------------------------------- leituras do contador */

  /**
   * As leituras do contador do bem (hodômetro, horímetro, contador de m²),
   * a mais recente primeiro, com a unidade do bem para a tela.
   */
  async readings(companyId: string, id: string, filter: ReadingFilterDto) {
    const row = await this.findRow(companyId, id);
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 50, ASSET_PAGE_LIMIT);
    const where = { assetId: id, companyId };
    const [total, rows] = await Promise.all([
      this.prisma.assetReading.count({ where }),
      this.prisma.assetReading.findMany({
        where,
        // No mesmo dia, o contador maior é o mais recente
        orderBy: [{ date: 'desc' }, { value: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      unit: row.unit,
      data: rows.map(readingView),
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  /**
   * Grava o que o contador marcava no dia. O contador não volta: a leitura
   * não fica abaixo da maior de um dia anterior nem acima da menor de um
   * dia posterior (no mesmo dia, qualquer ordem vale). Só bem ativo.
   */
  async addReading(
    companyId: string,
    user: { userId?: string; companyId: string },
    id: string,
    dto: AssetReadingDto,
  ) {
    const row = await this.activeRow(companyId, id);
    const day = dto.date.slice(0, 10);
    // O dia de hoje é o de São Paulo, como o resto do sistema
    if (day > toProjectDateKey(new Date())) {
      bad('A leitura não pode ser de um dia que ainda não chegou');
    }
    const date = toDate(day)!;
    const [before, after] = await Promise.all([
      this.prisma.assetReading.findFirst({
        where: { assetId: id, companyId, date: { lt: date } },
        orderBy: [{ value: 'desc' }, { date: 'desc' }],
      }),
      this.prisma.assetReading.findFirst({
        where: { assetId: id, companyId, date: { gt: date } },
        orderBy: [{ value: 'asc' }, { date: 'asc' }],
      }),
    ]);
    const unit = row.unit ? UNIT_SYMBOL[row.unit] : null;
    if (before && dto.value < before.value) {
      bad(backwardsMessage(before, unit));
    }
    if (after && dto.value > after.value) bad(backwardsMessage(after, unit));

    const actor = await actorOfUser(this.prisma, user);
    const created = await this.prisma.assetReading.create({
      data: {
        companyId,
        assetId: id,
        date,
        value: dto.value,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    const view = readingView(created);
    await this.audit.record({
      companyId,
      userId: actor.id,
      entity: 'ASSET_READING',
      entityId: created.id,
      action: 'CREATE',
      after: view,
    });
    return view;
  }

  /** Apaga a leitura digitada errado (a ordem das outras continua valendo). */
  async removeReading(
    companyId: string,
    userId: string,
    id: string,
    readingId: string,
  ) {
    await this.findRow(companyId, id);
    const reading = await this.prisma.assetReading.findFirst({
      where: { id: readingId, assetId: id, companyId },
    });
    if (!reading) throw new NotFoundException(READING_NOT_FOUND);
    await this.prisma.assetReading.delete({ where: { id: readingId } });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_READING',
      entityId: readingId,
      action: 'DELETE',
      before: readingView(reading),
    });
  }

  /* ---------------------------------------------------------------- apoio */

  /** O bem na lista: depreciação e situação calculadas. */
  view(row: AssetRow, today: Date, withDetail: boolean, pool = 0) {
    const computed = computeAsset(row, today, pool);
    const base = {
      id: row.id,
      name: row.name,
      imageUrl: row.imageUrl,
      kind: row.kind,
      sector: row.sector?.name ?? null,
      sectorId: row.sectorId,
      groupId: row.groupId,
      group: row.group ? { id: row.group.id, name: row.group.name } : null,
      detailed: row.detailed,
      unit: row.unit,
      monthlyProductivity: row.detailed ? computed.productivity : null,
      acquisitionDate: dateOnly(row.acquisitionDate),
      acquisitionValue: row.acquisitionValue,
      usefulLifeMonths: row.usefulLifeMonths,
      residualPercent: row.residualPercent,
      ...computed.depreciation,
      status: computed.status,
      inactivatedAt: row.inactivatedAt,
      inactiveReason: row.inactiveReason,
      sale: row.soldAt
        ? {
            date: dateOnly(row.soldAt),
            saleValue: row.saleValue,
            saleResult: row.saleResult,
            financialEntryId: row.saleReceivableId,
          }
        : null,
    };
    if (!withDetail) return base;
    return {
      ...base,
      ownCost: computed.ownCost,
      costs: computed.costs.map((cost) => ({
        id: cost.id,
        name: cost.name,
        nature: cost.nature,
        unitCost: cost.unitCost,
        yieldAmount: cost.yieldAmount,
        yieldUnit: cost.yieldUnit,
        financialNatureId: cost.subCategoryId,
        chartAccount: cost.subCategory
          ? [cost.subCategory.code, cost.subCategory.description]
              .filter(Boolean)
              .join(' — ')
          : null,
        lastOccurrence: dateOnly(cost.lastOccurrence),
        monthlyCost: cost.monthlyCost,
        setupId: cost.setupId,
      })),
      setups: row.setups.map((setup) => ({
        id: setup.id,
        name: setup.name,
        abbreviation: setup.abbreviation,
        unit: setup.unit,
        timePerUnit: setup.timePerUnit,
        monthlyProductivity: setup.monthlyProductivity,
        activityHours: Math.round(activityHoursOf(setup) * 100) / 100,
        unitCost: computed.setupUnitCosts.get(setup.id) ?? null,
        // O preço praticado, gravado pela Precificação › Máquinas
        salePrice: setup.salePrice ?? null,
      })),
    };
  }

  /** O detalhe com os processos e as composições que usam as configurações. */
  private async detailView(row: AssetRow) {
    const pool =
      row.active && row.detailed && row.companyId
        ? ((await this.pool?.poolOf(row.companyId, row.id)) ?? 0)
        : 0;
    const view = this.view(row, new Date(), true, pool) as ReturnType<
      AssetService['view']
    > & { setups: unknown[] };
    const usage = row.setups.length
      ? await this.setupUsage(row.setups.map((setup) => setup.id))
      : [];
    return {
      ...view,
      processes: usage
        .filter((item) => item.kind === 'PROCESS')
        .map(({ id, name }) => ({ id, name })),
    };
  }

  private async findRow(companyId: string, id: string) {
    const row = await this.prisma.asset.findFirst({
      where: { id, companyId },
      include: ASSET_INCLUDE,
    });
    if (!row) throw new NotFoundException(ASSET_NOT_FOUND);
    return row;
  }

  private async activeRow(companyId: string, id: string) {
    const row = await this.findRow(companyId, id);
    if (!row.active) throw new NotFoundException(ASSET_NOT_FOUND);
    return row;
  }

  private async assertSector(companyId: string, sectorId: string) {
    const sector = await this.prisma.companySector.findFirst({
      where: { id: sectorId, companyId, isActive: true },
      select: { id: true },
    });
    if (!sector) throw new NotFoundException('Setor não encontrado');
  }

  // A foto vem do upload da API (ALT-16): nada de data URL
  private assertImage(imageUrl: string | null | undefined) {
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      bad('Envie a foto pelo upload de arquivos');
    }
  }

  /** O grupo tem a mesma unidade e o mesmo setor do bem (P-5.2). */
  private async assertGroup(
    companyId: string,
    groupId: string,
    unit: string | null,
    sectorId: string | null,
  ) {
    const group = await this.prisma.assetGroup.findFirst({
      where: { id: groupId, companyId },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');
    if (
      group.unit !== unit ||
      (group.sectorId !== null && group.sectorId !== sectorId)
    ) {
      bad('O grupo precisa ter a mesma unidade e o mesmo setor do bem');
    }
    // O grupo que nasceu cadastrado ganha o setor do primeiro bem
    if (group.sectorId === null && sectorId) {
      await this.prisma.assetGroup.update({
        where: { id: group.id },
        data: { sectorId },
      });
    }
  }

  private async assertCost(
    companyId: string,
    row: AssetRow,
    dto: AssetCostDto,
  ) {
    if ((dto.nature === 'FIXED') !== (dto.yieldUnit === 'MONTH')) {
      bad('O custo fixo rende por mês; o variável, por unidade');
    }
    if (dto.nature === 'SETUP_VARIABLE') {
      if (
        !dto.setupId ||
        !row.setups.some((setup) => setup.id === dto.setupId)
      ) {
        throw new NotFoundException(SETUP_NOT_FOUND);
      }
    }
    if (dto.financialNatureId) {
      const account = await this.prisma.subCategory.findFirst({
        where: { id: dto.financialNatureId, companyId },
        select: { id: true },
      });
      if (!account) throw new NotFoundException('Conta não encontrada');
    }
  }

  private assertSetup(
    row: AssetRow,
    dto: AssetSetupDto,
    currentId: string | null,
  ) {
    if (!row.detailed) bad('Só o bem detalhado tem configuração produtiva');
    if (dto.unit !== row.unit) bad('A configuração usa a unidade do bem');
    const name = dto.name.trim().toLowerCase();
    if (
      row.setups.some(
        (setup) =>
          setup.id !== currentId && setup.name.trim().toLowerCase() === name,
      )
    ) {
      bad('Já existe uma configuração com este nome neste bem');
    }
  }

  // A produtividade do bem é a soma das configurações (P-31)
  private async syncProductivity(
    tx: Prisma.TransactionClient,
    assetId: string,
  ) {
    const setups = await tx.assetSetup.findMany({
      where: { assetId },
      select: { monthlyProductivity: true },
    });
    if (!setups.length) return;
    await tx.asset.update({
      where: { id: assetId },
      data: {
        monthlyProductivity: setups.reduce(
          (sum, setup) => sum + setup.monthlyProductivity,
          0,
        ),
      },
    });
  }

  /**
   * Os processos e as composições de produto que usam as configurações do
   * bem como recurso de máquina (P-16, P-18).
   */
  async setupUsage(setupIds: string[]) {
    if (!setupIds.length) return [];
    const options = await this.prisma.assemblyLineOption.findMany({
      where: { resourceId: { in: setupIds.map(machineResourceId) } },
      select: {
        line: {
          select: {
            process: { select: { id: true, name: true } },
            block: {
              select: {
                assembly: {
                  select: { product: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
    });
    const found = new Map<
      string,
      { kind: 'PROCESS' | 'PRODUCT'; id: string; name: string }
    >();
    for (const option of options) {
      const process = option.line.process;
      const product = option.line.block?.assembly.product;
      if (process) {
        found.set(`p:${process.id}`, { kind: 'PROCESS', ...process });
      }
      if (product) {
        found.set(`r:${product.id}`, { kind: 'PRODUCT', ...product });
      }
    }
    return [...found.values()];
  }

  /**
   * No rateio manual, a lista de equipamentos do setor mudou: o rateio não
   * se atualiza sozinho e o setor avisa até ser salvo de novo (BC-3.1).
   */
  private async markAllocationOutdated(sectorId: string | null) {
    if (!sectorId) return;
    await this.prisma.companySector.updateMany({
      where: { id: sectorId, allocationCriterion: 'MANUAL' },
      data: { allocationOutdated: true },
    });
  }
}
