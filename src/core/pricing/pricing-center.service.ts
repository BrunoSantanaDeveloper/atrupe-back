import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MaterialPriceRule } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { ProductAssemblyService } from '../assembly/product-assembly.service';
import { CostAuditService } from '../cost-base/cost-audit.service';
import {
  CostBaseSnapshot,
  CostBaseSnapshotService,
} from '../cost-base/cost-base-snapshot.service';
import { shiftMonth, monthStart } from '../cost-base/engine/months';
import {
  PricingCharges,
  priceStatusOf,
  variablePriceOf,
} from '../material/material-pricing';
import { UNIT_SYMBOL } from '../material/material-text';
import {
  PRICING_GROUPS,
  PricingGroup,
  PricingItemFilterDto,
  PricingParametersDto,
  UpdatePricingItemDto,
} from './dto/pricing.dto';
import { PricingParametersService } from './pricing-parameters.service';
import {
  chargesTotalOf,
  marginAfterChargesOf,
  markupOf,
  profitFits,
} from './pricing-math';

const ITEM_NOT_FOUND = 'Item não encontrado';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

export type PricingItem = {
  id: string;
  name: string;
  code: string | null;
  sector: string | null;
  unit: string;
  cost: number | null;
  costUpdatedAt: string | null;
  rule: MaterialPriceRule;
  price: number | null;
  profit: number | null;
  margin: number | null;
  status: ReturnType<typeof priceStatusOf>;
};

/**
 * A precificação (módulo 4, PRO): parâmetros da empresa, itens por grupo com
 * custo, regra, preço, margem e situação, e o preço de mão de obra e
 * máquinas. O custo nunca é gravado aqui (DC-6): vem da origem (base de
 * custos, patrimônio, material, composição). O preço é gravado no próprio
 * cadastro (setor, configuração produtiva, grupo de bens), que a composição
 * lê; material tem a rota dele e o produto, o cadastro do produto.
 */
@Injectable()
export class PricingCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parameters: PricingParametersService,
    private readonly snapshots: CostBaseSnapshotService,
    private readonly assemblies: ProductAssemblyService,
    private readonly audit: CostAuditService,
  ) {}

  /* --------------------------------------------- resumo e parâmetros */

  async summary(companyId: string) {
    const params = await this.parameters.parametersOf(companyId);
    const snapshot = await this.snapshots.load(companyId);
    const groups = [];
    for (const group of PRICING_GROUPS) {
      const items = await this.itemsOf(companyId, group, snapshot, params);
      groups.push({
        group,
        total: items.length,
        priced: items.filter((item) => !!item.price).length,
        pending: items.filter((item) => !item.price).length,
        belowCost: items.filter((item) => item.status === 'BELOW_COST').length,
      });
    }
    return {
      referenceMonth: snapshot.referenceMonth,
      parameters: { ...params, markup: markupOf(params) },
      groups,
    };
  }

  /** Só os parâmetros: o modal de preço do cadastro de produtos e materiais. */
  async parametersView(companyId: string) {
    const params = await this.parameters.parametersOf(companyId);
    return { ...params, markup: markupOf(params) };
  }

  async updateParameters(
    companyId: string,
    userId: string | null,
    dto: PricingParametersDto,
  ) {
    const next = {
      taxation: dto.taxation,
      commission: dto.commission,
      financialCost: dto.financialCost,
      desiredMargin: dto.desiredMargin,
    };
    if (chargesTotalOf(next) + next.desiredMargin >= 1000) {
      bad('A soma dos parâmetros precisa ficar abaixo de 100%');
    }
    const before = await this.parameters.parametersOf(companyId);
    await this.prisma.pricingParameters.upsert({
      where: { companyId },
      create: { companyId, ...next },
      update: next,
    });
    // O preço variável acompanha, preservando o lucro de cada item
    await this.repriceVariable(companyId, next);
    await this.audit.record({
      companyId,
      userId,
      entity: 'PRICING_PARAMETERS',
      entityId: companyId,
      action: 'UPDATE',
      before,
      after: next,
    });
    return { ...next, markup: markupOf(next) };
  }

  /* --------------------------------------------- itens */

  async items(companyId: string, filter: PricingItemFilterDto) {
    const params = await this.parameters.parametersOf(companyId);
    const snapshot = await this.snapshots.load(companyId);
    const search = filter.search?.trim().toLowerCase();
    const status = filter.status ?? 'todos';
    const rows = (
      await this.itemsOf(companyId, filter.group, snapshot, params)
    ).filter(
      (item) =>
        (status === 'todos' || item.status === status) &&
        (!search ||
          item.name.toLowerCase().includes(search) ||
          (item.code ?? '').toLowerCase().includes(search)),
    );
    const limit = filter.limit ?? 100;
    const lastPage = Math.max(1, Math.ceil(rows.length / limit));
    const page = Math.min(filter.page ?? 1, lastPage);
    return {
      referenceMonth: snapshot.referenceMonth,
      data: rows.slice((page - 1) * limit, page * limit),
      page,
      lastPage,
      total: rows.length,
    };
  }

  async updateItem(
    companyId: string,
    userId: string | null,
    id: string,
    dto: UpdatePricingItemDto,
  ) {
    if (dto.group === 'materials') {
      bad('O preço do material é gravado no cadastro do material');
    }
    if (dto.group === 'products') {
      bad('O preço do produto é definido no cadastro do produto');
    }
    const params = await this.parameters.parametersOf(companyId);
    const snapshot = await this.snapshots.load(companyId);
    const items = await this.itemsOf(companyId, dto.group, snapshot, params);
    const item = items.find((row) => row.id === id);
    if (!item) throw new NotFoundException(ITEM_NOT_FOUND);
    if (item.cost === null) bad('Este item ainda não tem custo calculado.');

    const { price, profit } = this.priceOf(item.cost!, dto, params);
    const data = {
      rule: dto.rule,
      price,
      profit: dto.rule === 'VARIABLE' ? profit : null,
    };
    if (dto.group === 'labor') {
      await this.prisma.companySector.update({
        where: { id },
        data: {
          hourSale: data.price,
          hourSaleRule: data.rule,
          hourSaleProfit: data.profit,
        },
      });
    } else {
      const [kind, refId] = id.split(':');
      const fields = {
        salePrice: data.price,
        priceRule: data.rule,
        profit: data.profit,
      };
      if (kind === 'setup') {
        await this.prisma.assetSetup.update({
          where: { id: refId },
          data: fields,
        });
      } else {
        await this.prisma.assetGroup.update({
          where: { id: refId },
          data: fields,
        });
      }
    }
    const after = (
      await this.itemsOf(
        companyId,
        dto.group,
        await this.snapshots.load(companyId),
        params,
      )
    ).find((row) => row.id === id)!;
    await this.audit.record({
      companyId,
      userId,
      entity: 'PRICING_ITEM',
      entityId: id,
      action: 'UPDATE',
      before: {
        rule: item.rule,
        price: item.price,
        profit: item.profit,
        cost: item.cost,
      },
      after: {
        rule: after.rule,
        price: after.price,
        profit: after.profit,
        cost: after.cost,
      },
    });
    return after;
  }

  /**
   * O preço pela regra (PR-2): no fixo, o informado; no variável, o do
   * servidor pelo lucro, e o preço enviado só confere (1 centavo).
   */
  private priceOf(
    cost: number,
    dto: UpdatePricingItemDto,
    charges: PricingCharges,
  ) {
    if (dto.rule === 'FIXED') {
      if (!(typeof dto.price === 'number' && dto.price > 0)) {
        bad('Informe o preço');
      }
      return { price: dto.price!, profit: null };
    }
    if (typeof dto.profit !== 'number') bad('Informe o lucro');
    if (!profitFits(charges, dto.profit!)) {
      bad('O lucro e os encargos passam de 100% do preço');
    }
    const price = variablePriceOf(cost, dto.profit!, charges)!;
    if (typeof dto.price === 'number' && Math.abs(dto.price - price) > 1) {
      bad('O preço mudou; abra o item de novo');
    }
    return { price, profit: dto.profit! };
  }

  /* --------------------------------------------- os grupos */

  private async itemsOf(
    companyId: string,
    group: PricingGroup,
    snapshot: CostBaseSnapshot,
    charges: PricingCharges,
  ): Promise<PricingItem[]> {
    const rows =
      group === 'labor'
        ? this.laborOf(snapshot)
        : group === 'machines'
          ? await this.machinesOf(companyId, snapshot)
          : group === 'materials'
            ? await this.materialsOf(companyId)
            : await this.productsOf(companyId);
    return rows.map((row) => ({
      ...row,
      margin: marginAfterChargesOf(row.price, row.cost, charges),
      status: priceStatusOf(row.cost, row.price),
    }));
  }

  // O custo da base é o do mês de referência: muda quando o mês fecha
  private costDateOf(snapshot: CostBaseSnapshot) {
    const end = monthStart(shiftMonth(snapshot.referenceMonth, 1));
    return new Date(end.getTime() - 1).toISOString().slice(0, 10);
  }

  /** Mão de obra: o custo-hora de cada setor produtivo (F-11). */
  private laborOf(snapshot: CostBaseSnapshot) {
    const costDate = this.costDateOf(snapshot);
    return snapshot.labor.map((labor, index) => {
      const sector = snapshot.sectorById.get(labor.id)!;
      return {
        id: labor.id,
        name: labor.name,
        code: `MO-${String(index + 1).padStart(2, '0')}`,
        sector: labor.name,
        unit: 'h',
        cost: labor.costPerHour,
        costUpdatedAt: labor.costPerHour === null ? null : costDate,
        rule: sector.hourSaleRule,
        price: sector.hourSale ?? null,
        profit: sector.hourSaleProfit ?? null,
      };
    });
  }

  /**
   * Máquinas: cada configuração produtiva do bem detalhado e cada grupo de
   * bens equivalentes como uma linha só (P-28), com o custo por unidade já
   * com a parte do rateio do setor. A composição lê a mesma lista.
   */
  private async machinesOf(companyId: string, snapshot: CostBaseSnapshot) {
    const costDate = this.costDateOf(snapshot);
    const lines = await this.snapshots.machineLines(companyId, snapshot);
    return lines.map((line) => ({
      id: line.id,
      name: line.name,
      code: line.code,
      sector: line.sector,
      unit: UNIT_SYMBOL[line.unit],
      cost: line.cost,
      costUpdatedAt: line.cost === null ? null : costDate,
      rule: line.rule,
      price: line.price,
      profit: line.profit,
    }));
  }

  /** Materiais: o material, ou cada marca × cor dele (MT-3). */
  private async materialsOf(companyId: string) {
    const materials = await this.prisma.material.findMany({
      where: { companyId, active: true },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        priceRule: true,
        cost: true,
        price: true,
        desiredMargin: true,
        costUpdatedAt: true,
        sector: { select: { name: true } },
        variations: {
          orderBy: [{ brand: 'asc' }, { color: 'asc' }],
          select: {
            id: true,
            brand: true,
            color: true,
            cost: true,
            price: true,
            desiredMargin: true,
            costUpdatedAt: true,
          },
        },
      },
    });
    return materials.flatMap((material) => {
      const base = {
        code: material.code,
        sector: material.sector?.name ?? null,
        unit: UNIT_SYMBOL[material.unit],
        rule: material.priceRule,
      };
      const date = (value: Date | null) =>
        value ? value.toISOString().slice(0, 10) : null;
      if (!material.variations.length) {
        return [
          {
            ...base,
            id: `mat:${material.id}`,
            name: material.name,
            cost: material.cost,
            costUpdatedAt: date(material.costUpdatedAt),
            price: material.price,
            profit:
              material.priceRule === 'VARIABLE' ? material.desiredMargin : null,
          },
        ];
      }
      return material.variations.map((variation) => ({
        ...base,
        id: `mat:${material.id}:${variation.id}`,
        name: `${material.name} · ${variation.brand} ${variation.color}`.trim(),
        cost: variation.cost,
        costUpdatedAt: date(variation.costUpdatedAt),
        price: variation.price,
        profit:
          material.priceRule === 'VARIABLE' ? variation.desiredMargin : null,
      }));
    });
  }

  /**
   * Produtos: o custo da composição na medida padrão, por unidade comercial;
   * sem composição, custo não calculado (DC-15). O preço é o do cadastro.
   */
  private async productsOf(companyId: string) {
    const products = await this.prisma.product.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        sector: { select: { name: true } },
        assemblies: { where: { variationKey: '' }, select: { id: true } },
      },
    });
    const rows = [];
    for (const product of products) {
      const pricing = product.assemblies.length
        ? await this.assemblies.standardPricing(companyId, product.id)
        : null;
      rows.push({
        id: product.id,
        name: product.name,
        code: product.code || null,
        sector: product.sector?.name ?? null,
        unit: pricing ? this.productUnitOf(pricing.unitKind) : 'un',
        cost: pricing?.unitCost ?? null,
        costUpdatedAt: null,
        rule: 'FIXED' as MaterialPriceRule,
        price: pricing?.unitPrice ?? null,
        profit: null,
      });
    }
    return rows;
  }

  private productUnitOf(unitKind: string) {
    return (
      { AREA: 'm²', LENGTH: 'm', UNITY: 'un', WEIGHT: 'kg', VOLUME: 'l' }[
        unitKind
      ] ?? 'un'
    );
  }

  /** O preço de todo item variável refeito pelos parâmetros novos. */
  private async repriceVariable(companyId: string, charges: PricingCharges) {
    const materials = await this.prisma.material.findMany({
      where: { companyId, priceRule: 'VARIABLE' },
      select: {
        id: true,
        cost: true,
        desiredMargin: true,
        variations: { select: { id: true, cost: true, desiredMargin: true } },
      },
    });
    const updates = [];
    const reprice = (cost: number | null, profit: number | null) =>
      cost !== null && profit !== null
        ? variablePriceOf(cost, profit, charges)
        : null;
    for (const material of materials) {
      const price = reprice(material.cost, material.desiredMargin);
      if (price !== null) {
        updates.push(
          this.prisma.material.update({
            where: { id: material.id },
            data: { price },
          }),
        );
      }
      for (const variation of material.variations) {
        const variationPrice = reprice(variation.cost, variation.desiredMargin);
        if (variationPrice !== null) {
          updates.push(
            this.prisma.materialVariation.update({
              where: { id: variation.id },
              data: { price: variationPrice },
            }),
          );
        }
      }
    }
    const snapshot = await this.snapshots.load(companyId);
    for (const item of this.laborOf(snapshot)) {
      const price =
        item.rule === 'VARIABLE' ? reprice(item.cost, item.profit) : null;
      if (price !== null) {
        updates.push(
          this.prisma.companySector.update({
            where: { id: item.id },
            data: { hourSale: price },
          }),
        );
      }
    }
    for (const item of await this.machinesOf(companyId, snapshot)) {
      const price =
        item.rule === 'VARIABLE' ? reprice(item.cost, item.profit) : null;
      if (price === null) continue;
      const [kind, refId] = item.id.split(':');
      updates.push(
        kind === 'setup'
          ? this.prisma.assetSetup.update({
              where: { id: refId },
              data: { salePrice: price },
            })
          : this.prisma.assetGroup.update({
              where: { id: refId },
              data: { salePrice: price },
            }),
      );
    }
    if (updates.length) await this.prisma.$transaction(updates);
  }
}
