import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuotationLineKind } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { COMMERCIAL_FACTOR } from '../../assembly/assembly-graph';
import { UnitKind } from '../../assembly/engine/types';
import { ProcessService } from '../../assembly/process.service';
import { ProductSaleService } from '../../assembly/product-sale.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { ProductionProjectService } from '../../production/production-project.service';
import {
  SalesSettingsService,
  outsourcedPrice,
} from '../sales-settings/sales-settings.service';
import { ItemLineDto } from './dto/item-line.dto';
import { itemValue, recalculateQuotationTotal } from './quotation-totals';
import { LINE_VIEW_SELECT } from './quotation.includes';

export const LINE_NOT_FOUND = 'Linha não encontrada';
const ITEM_NOT_FOUND = 'Item não encontrado';
const NOT_OPEN = 'Só dá para mexer no item com o orçamento em digitação';
export const APPROVED_WITH_STOCK =
  'Com o estoque ligado, a composição do item da O.S. aprovada fica como foi vendida';
const MEASURE_REQUIRED = 'Informe a medida da linha';

// Dinheiro das respostas das linhas: sem `values:values:view`, não sai
const LINE_MONEY = ['price', 'suggestedPrice', 'markup', 'linesTotal', 'total'];

type Measure = { quantity: number; width: number; height: number };
type FieldValue = { fieldId: string; value: number };
type Instruction = { stage: string; text: string };

/** O cálculo de uma linha, antes de gravar. */
type LineQuote = {
  kind: QuotationLineKind;
  name: string;
  sector: string;
  tags: string[];
  processId: string | null;
  productId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  followsBase: boolean | null;
  followsBaseDefault: boolean | null;
  measure: Measure | null;
  fields: FieldValue[] | null;
  price: number;
  cost: number;
  resolved: unknown;
  instructions: Instruction[];
  suggestedPrice: number | null;
  markup: number | null;
};

type ItemContext = {
  id: string;
  companies: string[];
  measure: Measure;
};

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const num = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

// "1 un", "3 × 1 m": a medida da linha em metros, como a tela mostra
const measureTags = (measure: Measure) => [
  `${num(measure.quantity)} un`,
  `${num(measure.width / 1000)} × ${num(measure.height / 1000)} m`,
];

// A proporção da parte ao mudar a medida do item (contrato, módulo 2)
const partMeasure = (measure: Measure) =>
  measure.quantity * (measure.width || 1) * (measure.height || 1);

const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const omit = <T extends Record<string, unknown>>(body: T, values: boolean) => {
  if (values) return body;
  const prune = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(prune);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !LINE_MONEY.includes(key))
        .map(([key, child]) => [key, prune(child)]),
    );
  };
  return prune(body) as T;
};

/**
 * As linhas acrescentadas dentro do item do orçamento (ORC-5, MS-15): o item
 * é um recipiente aberto, como no legado. Cada linha guarda preço, custo e o
 * retrato do cálculo (ORC-10); a tela recebe só o preço, e só com a
 * permissão de valores (ORC-7). O valor do item soma as linhas por fora do
 * desconto.
 */
@Injectable()
export class QuotationLinesService {
  private readonly logger = new Logger(QuotationLinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processes: ProcessService,
    private readonly productSale: ProductSaleService,
    private readonly settings: SalesSettingsService,
    private readonly planControl: PlanControlService,
    private readonly production: ProductionProjectService,
  ) {}

  /**
   * Depois de mudar o item da O.S. aprovada (ELITE): as tarefas de produção
   * acompanham o retrato novo. A falha fica no log e não desfaz a edição,
   * que já foi gravada.
   */
  async afterItemChange(itemId: string) {
    try {
      await this.production.syncItem(itemId);
    } catch (error) {
      this.logger.error(
        `Tarefas de produção do item ${itemId} não acompanharam a O.S.: ${error.message}`,
      );
    }
  }

  /**
   * A O.S. aprovada muda a composição do item (opções, variação e linhas) e
   * refaz o retrato quando a conta não tem estoque: com ele, o material já
   * pode ter sido baixado, e a venda fica como foi feita (decisão do PO,
   * 14/10/2026).
   */
  async approvedEditable(companyId: string): Promise<boolean> {
    return !(await this.planControl.hasFeature(companyId, 'stock_control'));
  }

  /* ---------------------------------------------------------------- rotas */

  /** O preço da linha antes de gravar, para o painel "Acrescentar". */
  async preview(
    quotationId: string,
    itemId: string,
    dto: ItemLineDto,
    values: boolean,
  ) {
    const item = await this.itemOf(quotationId, itemId);
    const quote = await this.quote(item, dto, values);
    return omit(
      {
        price: quote.price,
        tags: quote.tags,
        followsBaseDefault: quote.followsBaseDefault,
        instructions: quote.instructions,
        suggestedPrice: quote.suggestedPrice,
        markup: quote.markup,
      },
      values,
    );
  }

  async add(
    quotationId: string,
    itemId: string,
    dto: ItemLineDto,
    values: boolean,
  ) {
    const item = await this.itemOf(quotationId, itemId);
    const quote = await this.quote(item, dto, values);
    const line = await this.prisma.quotationItemLine.create({
      data: {
        quotationProductId: item.id,
        kind: quote.kind,
        name: quote.name,
        sector: quote.sector,
        tags: quote.tags,
        processId: quote.processId,
        productId: quote.productId,
        supplierId: quote.supplierId,
        supplierName: quote.supplierName,
        followsBase: quote.followsBase,
        measure: quote.measure ? asJson(quote.measure) : Prisma.DbNull,
        fields: quote.fields ? asJson(quote.fields) : Prisma.DbNull,
        price: quote.price,
        cost: quote.cost,
        resolved:
          quote.resolved !== null && quote.resolved !== undefined
            ? asJson(quote.resolved)
            : Prisma.DbNull,
      },
      select: LINE_VIEW_SELECT,
    });
    const summary = await this.refreshItem(item.id);
    await this.afterItemChange(item.id);
    return omit({ line, item: summary }, values);
  }

  async remove(
    quotationId: string,
    itemId: string,
    lineId: string,
    values: boolean,
  ) {
    const item = await this.itemOf(quotationId, itemId);
    const line = await this.prisma.quotationItemLine.findFirst({
      where: { id: lineId, quotationProductId: item.id },
      select: { id: true },
    });
    if (!line) throw new NotFoundException(LINE_NOT_FOUND);
    await this.prisma.quotationItemLine.delete({ where: { id: line.id } });
    const summary = await this.refreshItem(item.id);
    await this.afterItemChange(item.id);
    return omit({ item: summary }, values);
  }

  /* ------------------------------------------------------- uso do item */

  /**
   * O valor do item com as linhas (por fora do desconto) e o total do
   * orçamento refeitos.
   */
  async refreshItem(itemId: string) {
    const [item, sum] = await Promise.all([
      this.prisma.quotationProduct.findUniqueOrThrow({
        where: { id: itemId },
        select: {
          id: true,
          quotationId: true,
          totalValue: true,
          discount: true,
          discountType: true,
          addition: true,
        },
      }),
      this.prisma.quotationItemLine.aggregate({
        where: { quotationProductId: itemId },
        _sum: { price: true },
      }),
    ]);
    const linesTotal = sum._sum.price ?? 0;
    const finalValue = itemValue(
      item.totalValue ?? 0,
      item.discount,
      item.discountType,
      item.addition,
      linesTotal,
    );
    await this.prisma.quotationProduct.update({
      where: { id: item.id },
      data: { linesTotal, finalValue },
    });
    await recalculateQuotationTotal(this.prisma, item.quotationId);
    return { id: item.id, linesTotal, total: finalValue };
  }

  /**
   * Medida nova do item: as linhas que acompanham a base são refeitas, e as
   * de medida própria ficam como estão (05/10/2026, diferente do legado).
   * Processo pelo cálculo na medida nova; parte pela proporção da medida.
   * Devolve quantas foram refeitas; o valor do item fica para o chamador.
   */
  async recalculate(itemId: string) {
    const row = await this.prisma.quotationProduct.findUnique({
      where: { id: itemId },
      select: {
        quantity: true,
        items: { select: { width: true, height: true }, take: 1 },
        quotation: { select: { companyId: true } },
        lines: {
          where: { followsBase: true },
          select: {
            id: true,
            kind: true,
            processId: true,
            measure: true,
            fields: true,
            price: true,
            cost: true,
          },
        },
      },
    });
    if (!row?.lines.length) return 0;
    const measure = this.itemMeasure(row);

    let changed = 0;
    for (const line of row.lines) {
      if (line.kind === 'PROCESS' && line.processId) {
        try {
          const quote = await this.processes.lineQuote(
            row.quotation.companyId,
            line.processId,
            measure,
            (line.fields as FieldValue[] | null) ?? [],
            true,
          );
          await this.prisma.quotationItemLine.update({
            where: { id: line.id },
            data: {
              measure: asJson(measure),
              tags: measureTags(measure),
              price: quote.price,
              cost: quote.cost,
              resolved: asJson(quote.resolved),
              resolvedAt: new Date(),
            },
          });
          changed += 1;
        } catch (error) {
          // Processo inativado ou incompleto depois: a linha fica como está
          this.logger.warn(
            `Linha ${line.id} não refeita com a medida nova: ${error.message}`,
          );
        }
        continue;
      }
      if (line.kind === 'PART' && line.measure) {
        const before = partMeasure(line.measure as Measure);
        if (!(before > 0)) continue;
        const after = partMeasure(measure);
        await this.prisma.quotationItemLine.update({
          where: { id: line.id },
          data: {
            measure: asJson(measure),
            tags: measureTags(measure),
            price: Math.round((line.price / before) * after),
            cost: Math.round((line.cost / before) * after),
            resolvedAt: new Date(),
          },
        });
        changed += 1;
      }
    }
    return changed;
  }

  /* ---------------------------------------------------------------- apoio */

  /** O item de um orçamento em digitação, com a medida que a linha acompanha. */
  private async itemOf(quotationId: string, itemId: string) {
    const row = await this.prisma.quotationProduct.findFirst({
      where: { id: itemId, quotationId },
      select: {
        id: true,
        quantity: true,
        items: { select: { width: true, height: true }, take: 1 },
        quotation: {
          select: { status: true, companyId: true, subCompanyId: true },
        },
      },
    });
    if (!row) throw new NotFoundException(ITEM_NOT_FOUND);
    if (row.quotation.status === 'APPROVED') {
      if (!(await this.approvedEditable(row.quotation.companyId))) {
        bad(APPROVED_WITH_STOCK);
      }
    } else if (row.quotation.status !== 'OPEN') {
      bad(NOT_OPEN);
    }
    return {
      id: row.id,
      companies: [row.quotation.companyId, row.quotation.subCompanyId].filter(
        (id): id is string => !!id,
      ),
      measure: this.itemMeasure(row),
    } satisfies ItemContext;
  }

  // A medida do item em mm; o vendido por unidade conta como 1 × 1 m
  private itemMeasure(row: {
    quantity: number;
    items: { width: number | null; height: number | null }[];
  }): Measure {
    const first = row.items[0];
    return {
      quantity: row.quantity || 1,
      width: first?.width || 1000,
      height: first?.height || 1000,
    };
  }

  // A medida própria da linha precisa de largura e altura
  private ownMeasure(sent: Measure | undefined, needsHeight: boolean) {
    if (!sent || !(sent.width > 0) || (needsHeight && !(sent.height > 0))) {
      bad(MEASURE_REQUIRED);
    }
    return {
      quantity: sent!.quantity,
      width: sent!.width,
      height: needsHeight ? sent!.height : sent!.height || 0,
    };
  }

  private quote(item: ItemContext, dto: ItemLineDto, values: boolean) {
    switch (dto.kind) {
      case 'PROCESS':
        return this.processQuote(item, dto);
      case 'PART':
        return this.partQuote(item, dto);
      default:
        return this.looseQuote(item, dto, values);
    }
  }

  private async processQuote(
    item: ItemContext,
    dto: ItemLineDto,
  ): Promise<LineQuote> {
    if (!dto.processId) bad('Escolha o processo');
    const companyId = item.companies[0];
    const process = await this.prisma.process.findFirst({
      where: { id: dto.processId, companyId },
      select: { afterBase: true },
    });
    if (!process) throw new NotFoundException('Processo não encontrado');
    // Sem escolha, vale a preferência do processo (03/10/2026)
    const followsBase = dto.followsBase ?? process.afterBase === 'INHERIT';
    const measure = followsBase
      ? item.measure
      : this.ownMeasure(dto.measure, true);
    const fields = dto.fields ?? [];
    const quote = await this.processes.lineQuote(
      companyId,
      dto.processId!,
      measure,
      fields,
      followsBase,
    );
    return {
      kind: 'PROCESS',
      name: quote.name,
      sector: quote.sector,
      tags: measureTags(measure),
      processId: dto.processId!,
      productId: null,
      supplierId: null,
      supplierName: null,
      followsBase,
      followsBaseDefault: quote.followsBaseDefault,
      measure,
      fields,
      price: quote.price,
      cost: quote.cost,
      resolved: quote.resolved,
      instructions: quote.instructions,
      suggestedPrice: null,
      markup: null,
    };
  }

  private async partQuote(
    item: ItemContext,
    dto: ItemLineDto,
  ): Promise<LineQuote> {
    if (!dto.productId) bad('Escolha o produto');
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId: { in: item.companies } },
      select: {
        id: true,
        name: true,
        companyId: true,
        isActive: true,
        sector: { select: { name: true } },
        items: { select: { unitKind: true, unitCost: true }, take: 1 },
        assemblies: {
          where: { variationKey: '' },
          select: { status: true, _count: { select: { blocks: true } } },
        },
      },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');
    if (!product.isActive) bad('Produto inativo não entra no orçamento');
    const assembly = product.assemblies[0];
    const composed = !!assembly?._count.blocks;
    if (composed && assembly.status !== 'RELEASED') {
      bad('Este produto não está liberado para venda');
    }
    const unitKind = (product.items[0]?.unitKind ?? 'UNITY') as UnitKind;
    const raw = product.items[0]?.unitCost ?? 0;
    if (!(raw > 0)) bad('Este produto está sem preço de venda');
    const unitPrice = Math.round(raw * COMMERCIAL_FACTOR[unitKind]);

    // Por área ou por metro, a parte tem medida; por unidade, só quantidade
    const measured = unitKind === 'AREA' || unitKind === 'LENGTH';
    const followsBase = measured ? (dto.followsBase ?? true) : null;
    const measure: Measure = measured
      ? followsBase
        ? item.measure
        : this.ownMeasure(dto.measure, unitKind === 'AREA')
      : { quantity: dto.measure?.quantity ?? 1, width: 0, height: 0 };
    const factor =
      unitKind === 'AREA'
        ? (measure.width / 1000) * (measure.height / 1000)
        : unitKind === 'LENGTH'
          ? measure.width / 1000
          : 1;
    const price = Math.round(unitPrice * factor * measure.quantity);

    // O custo pela composição do produto, quando ele tem (corrige o custo
    // zero do exemplo); sem composição, o custo fica zero
    let cost = 0;
    let resolved: unknown = null;
    let instructions: Instruction[] = [];
    if (composed) {
      try {
        const { snapshot } = await this.productSale.itemComposition(
          product.companyId ?? item.companies[0],
          product.id,
          null,
          {
            quantity: measure.quantity,
            width: measure.width || undefined,
            height: measure.height || undefined,
          },
          {},
        );
        cost = snapshot.cost;
        resolved = snapshot.stages;
        const form = await this.productSale.saleForm(
          product.companyId ?? item.companies[0],
          product.id,
        );
        instructions = (form?.instructions ?? []).map(({ stage, text }) => ({
          stage,
          text,
        }));
      } catch (error) {
        this.logger.warn(
          `Custo da parte ${product.id} não calculado: ${error.message}`,
        );
      }
    }

    return {
      kind: 'PART',
      name: product.name,
      sector: product.sector.name,
      tags: measured
        ? unitKind === 'LENGTH'
          ? [`${num(measure.quantity)} un`, `${num(measure.width / 1000)} m`]
          : measureTags(measure)
        : [`${num(measure.quantity)} un`],
      processId: null,
      productId: product.id,
      supplierId: null,
      supplierName: null,
      followsBase,
      followsBaseDefault: measured ? true : null,
      measure,
      fields: null,
      price,
      cost,
      resolved,
      instructions,
      suggestedPrice: null,
      markup: null,
    };
  }

  private async looseQuote(
    item: ItemContext,
    dto: ItemLineDto,
    values: boolean,
  ): Promise<LineQuote> {
    const description = dto.description?.trim();
    if (!description) bad('Informe o que acrescentar');
    if (!(dto.cost! > 0)) bad('Informe o custo do terceirizado');

    let supplierName = dto.supplier?.trim() || null;
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId: { in: item.companies } },
        select: { name: true },
      });
      if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
      supplierName = supplier.name;
    }

    const markup = await this.settings.outsourcedMarkupOf(item.companies[0]);
    const suggestedPrice = outsourcedPrice(dto.cost!, markup);
    // O preço digitado só vale de quem vê valores; os outros gravam o sugerido
    const price =
      values && dto.price !== undefined ? dto.price : suggestedPrice;

    return {
      kind: 'LOOSE',
      name: description!,
      sector: supplierName ? `Terceirizado · ${supplierName}` : 'Terceirizado',
      tags: ['terceirizado'],
      processId: null,
      productId: null,
      supplierId: dto.supplierId ?? null,
      supplierName,
      followsBase: null,
      followsBaseDefault: null,
      measure: null,
      fields: null,
      price,
      // Vira despesa no financeiro quando a venda acontece (T-3)
      cost: dto.cost!,
      resolved: null,
      instructions: [],
      suggestedPrice,
      markup,
    };
  }
}

/**
 * Copia as linhas de um item para outro (duplicar item ou orçamento): preço,
 * custo e retrato como estavam.
 */
export async function copyItemLines(
  prisma: PrismaService,
  fromItemId: string,
  toItemId: string,
) {
  const lines = await prisma.quotationItemLine.findMany({
    where: { quotationProductId: fromItemId },
    orderBy: { createdAt: 'asc' },
  });
  if (!lines.length) return;
  await prisma.quotationItemLine.createMany({
    data: lines.map(
      ({
        id: _id,
        quotationProductId: _from,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        measure,
        fields,
        resolved,
        ...line
      }) => ({
        ...line,
        quotationProductId: toItemId,
        measure: measure ?? Prisma.DbNull,
        fields: fields ?? Prisma.DbNull,
        resolved: resolved ?? Prisma.DbNull,
      }),
    ),
  });
}
