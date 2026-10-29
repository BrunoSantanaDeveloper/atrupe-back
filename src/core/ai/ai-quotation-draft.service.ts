import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { BASE_PRODUCT_WHERE } from '../product/product.service';
import { isAtCashier } from '../sale/quick-sale/quick-sale.rules';
import { QuickSaleService } from '../sale/quick-sale/quick-sale.service';
import {
  AddItemDto,
  AddProductItemDto,
} from '../sale/quotation/dto/create-quotation.dto';
import { rawMeasure } from '../sale/quotation/item-base-price';
import {
  COMMERCIAL_UNIT,
  ItemPrice,
  priceSimpleItem,
  rawPerUnit,
} from '../sale/quotation/item-price';
import { QuotationService } from '../sale/quotation/quotation.service';
import { AiPlanFeatures } from './ai-plan';
import {
  confidentChoice,
  normalizeText,
  parseDimensions,
  queryTokens,
  rank,
} from './ai-text-match';
import { AiRequestUser } from './ai.types';

export type DraftItemStatus =
  | 'OK'
  | 'NEEDS_CHOICE'
  | 'NEEDS_MEASURE'
  | 'BASE_PRODUCT';

export interface DraftCandidate {
  id: string;
  name: string;
  code: string | null;
  unit: string;
}

export interface DraftItem {
  /** O trecho original do pedido */
  text: string;
  status: DraftItemStatus;
  productId?: string;
  productName?: string;
  /** A unidade comercial: un, m2, m, kg, l, h, km */
  unit?: string;
  quantity: number;
  /** Largura e altura em metros (produto em m²) */
  width?: number;
  height?: number;
  /** A medida nas outras unidades (m, kg, l, km, h), por unidade */
  measure?: number;
  variationId?: string;
  variationName?: string;
  /** O nome do item no orçamento */
  description?: string;
  technicalDescription?: string;
  /** Centavos; fora quando a pessoa não vê valores */
  unitPrice?: number;
  total?: number;
  rules?: string[];
  /** O que falta para aplicar */
  missing?: string;
  candidates?: DraftCandidate[];
  variations?: { id: string; name: string }[];
}

export interface QuotationDraftPayload {
  client: {
    id: string | null;
    name: string | null;
    match: 'EXACT' | 'NEEDS_CHOICE' | 'NONE';
    candidates?: { id: string; name: string }[];
  };
  deliveryDate: string | null;
  notes: string | null;
  target: 'NEW' | 'CURRENT';
  quotationId: string | null;
  quickSale: boolean;
  items: DraftItem[];
  total: number;
  warnings: string[];
}

/** O que a pessoa muda no cartão antes de aplicar. */
export interface QuotationDraftEdits {
  clientId?: string | null;
  deliveryDate?: string | null;
  items?: {
    index: number;
    removed?: boolean;
    productId?: string;
    variationId?: string;
    quantity?: number;
    width?: number;
    height?: number;
    measure?: number;
  }[];
}

interface ItemInput {
  text: string;
  productHint: string;
  quantity: number;
  width?: number;
  height?: number;
  unitHint?: string;
  variationHint?: string;
}

/** O item e o que vai ao "Adicionar item" (fica no servidor). */
interface ResolvedItem {
  item: DraftItem;
  add?: { quantity: number; rows: AddProductItemDto[] };
}

interface DraftContext {
  companyId: string;
  /** Faixas: recurso da composição (LITE) */
  tiers: boolean;
}

const MAX_ITEMS = 30;
const MAX_QUANTITY = 1_000_000;
/** Medida acima disso, em metros, é centímetro escrito como metro */
const MAX_METERS = 20;
const UNIT_HINTS = ['un', 'm2', 'm', 'kg', 'l', 'h', 'km'];

const PRODUCT_SELECT = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  minQuantity: true,
  technicalDescription: true,
  sector: { select: { name: true } },
  items: {
    select: {
      id: true,
      name: true,
      unitKind: true,
      unitCost: true,
      width: true,
      height: true,
      length: true,
      volume: true,
      weight: true,
      distance: true,
      duration: true,
    },
  },
  variations: {
    select: { id: true, name: true, unitPrice: true },
    orderBy: { position: 'asc' as const },
  },
  priceTiers: {
    where: { variationId: null },
    select: { from: true, unitPrice: true },
  },
} as const;

type CatalogProduct = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  minQuantity: number | null;
  technicalDescription: string | null;
  sector: { name: string } | null;
  items: {
    id: string;
    name: string;
    unitKind: string | null;
    unitCost: number | null;
    width: number | null;
    height: number | null;
    length: number | null;
    volume: number | null;
    weight: number | null;
    distance: number | null;
    duration: number | null;
  }[];
  variations: { id: string; name: string; unitPrice: number | null }[];
  priceTiers: { from: number; unitPrice: number }[];
};

const text = (value: unknown, max: number) =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const positive = (value: unknown, max = MAX_QUANTITY) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max
    ? parsed
    : undefined;
};

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T12:00:00-03:00`).getTime());

const unitOf = (product: CatalogProduct) =>
  COMMERCIAL_UNIT[product.items[0]?.unitKind ?? 'UNITY'] ?? 'un';

const isBase = (name: string) => name.startsWith('Produto base – ');

/**
 * O rascunho de orçamento do agente (seção 7 do documento de 28/10/2026). O
 * modelo manda o que o cliente pediu (sem preço); o servidor casa cliente e
 * produtos com o cadastro, confere a medida e calcula o preço com a regra
 * da tela. Nunca cria cliente nem produto. Aplicar grava pelos serviços do
 * orçamento, com as mesmas permissões e regras da tela.
 */
@Injectable()
export class AiQuotationDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
    private readonly quotations: QuotationService,
    private readonly quickSales: QuickSaleService,
  ) {}

  getToolSchema() {
    return {
      type: 'object',
      properties: {
        clientHint: {
          type: 'string',
          description:
            'O cliente como o vendedor escreveu ("Clínica Sorriso", "a Juliana"). Omita se não houver.',
        },
        deliveryDate: { type: 'string', description: 'AAAA-MM-DD' },
        notes: { type: 'string', description: 'Observações do pedido.' },
        target: {
          type: 'string',
          enum: ['NEW', 'CURRENT'],
          description:
            'CURRENT quando a tela atual é um orçamento em digitação e o pedido é para incluir nele.',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description:
                  'O trecho original do pedido: "200 placas 30x40 em PVC 3mm".',
              },
              productHint: {
                type: 'string',
                description: 'O produto, sem quantidade: "placa PVC 3mm".',
              },
              quantity: { type: 'number' },
              width: { type: 'number', description: 'Largura em metros.' },
              height: { type: 'number', description: 'Altura em metros.' },
              unitHint: { type: 'string', enum: UNIT_HINTS },
              variationHint: {
                type: 'string',
                description:
                  'Tamanho, cor ou acabamento: "G", "frente e verso".',
              },
            },
            required: ['text', 'productHint', 'quantity'],
          },
        },
      },
      required: ['items'],
    };
  }

  /**
   * Monta a proposta. Confere a permissão de orçar (e de editar o orçamento
   * aberto, com CURRENT); o plano já foi conferido pela ferramenta.
   */
  async build(
    args: Record<string, unknown>,
    user: AiRequestUser,
    features: AiPlanFeatures,
    options: { currentQuotationId?: string; quickSale?: boolean } = {},
  ): Promise<QuotationDraftPayload> {
    const items = this.itemInputs(args.items);
    if (!items.length) {
      throw new BadRequestException(
        'Diga quais produtos e quantidades o cliente pediu.',
      );
    }
    const warnings: string[] = [];
    const quickSale = !!options.quickSale;

    let target: 'NEW' | 'CURRENT' =
      args.target === 'CURRENT' && options.currentQuotationId
        ? 'CURRENT'
        : 'NEW';
    if (args.target === 'CURRENT' && target === 'NEW') {
      warnings.push(
        'Não há orçamento em digitação aberto na tela: a proposta cria um novo.',
      );
    }
    if (target === 'CURRENT') {
      const editable = await this.editableQuotation(
        options.currentQuotationId,
        user,
      ).catch((error: Error) => error);
      if (editable instanceof AiProposalDeniedError && !editable.fallback) {
        // Orçamento de outro vendedor ou sem permissão de editar: recusa
        throw editable;
      }
      if (editable instanceof Error) {
        warnings.push(`${editable.message} A proposta cria um orçamento novo.`);
        target = 'NEW';
      }
    }
    if (target === 'NEW') await this.ensureCanCreate(user);

    const context = await this.context(user.companyId, features);
    const client = quickSale
      ? { id: null, name: null, match: 'NONE' as const }
      : await this.matchClient(user.companyId, text(args.clientHint, 120));
    if (!quickSale && target === 'NEW') {
      if (client.match === 'NONE') {
        warnings.push(
          args.clientHint
            ? `Não achei o cliente "${text(args.clientHint, 120)}" no cadastro: escolha o cliente antes de aplicar.`
            : 'Escolha o cliente antes de aplicar.',
        );
      } else if (client.match === 'NEEDS_CHOICE') {
        warnings.push('Há mais de um cliente parecido: escolha o certo.');
      }
    }

    const resolved: DraftItem[] = [];
    for (const input of items) {
      resolved.push((await this.resolveItem(context, input)).item);
    }
    warnings.push(...this.itemWarnings(resolved));

    const deliveryDate = isDate(args.deliveryDate) ? args.deliveryDate : null;
    return {
      client,
      deliveryDate,
      notes: text(args.notes, 500) || null,
      target,
      quotationId: target === 'CURRENT' ? options.currentQuotationId : null,
      quickSale,
      items: resolved,
      total: this.totalOf(resolved),
      warnings,
    };
  }

  /**
   * Aplica a proposta: confere de novo a permissão, recalcula os preços e
   * grava pelos mesmos serviços da tela (criar o orçamento e adicionar o
   * produto). Item em dúvida ou sem medida recusa o aplicar.
   */
  async apply(
    payload: QuotationDraftPayload,
    edits: QuotationDraftEdits | undefined,
    user: AiRequestUser,
    features: AiPlanFeatures,
  ) {
    const context = await this.context(user.companyId, features);
    const warnings: string[] = [];
    const items: DraftItem[] = [];
    payload.items.forEach((item, index) => {
      const edit = edits?.items?.find((e) => e.index === index);
      if (edit?.removed) return;
      items.push(this.withEdit(item, edit));
    });
    if (!items.length) {
      throw new UnprocessableEntityException({
        message: 'A proposta ficou sem itens.',
        missing: [],
      });
    }

    // Recalcula tudo pelo cadastro de agora
    const recalculated: ResolvedItem[] = [];
    for (const item of items) {
      const { item: fresh, add } = await this.resolveItem(
        context,
        this.inputOf(item),
        {
          productId: item.productId,
          variationId: item.variationId,
          width: item.width,
          height: item.height,
          measure: item.measure,
        },
      );
      if (
        item.total !== undefined &&
        fresh.total !== undefined &&
        fresh.total !== item.total
      ) {
        warnings.push(
          `O preço de "${fresh.description ?? item.text}" mudou depois da proposta: vale o de agora.`,
        );
      }
      const keepText = fresh.status === 'BASE_PRODUCT';
      recalculated.push({
        item: {
          ...fresh,
          description: keepText ? item.description : fresh.description,
          technicalDescription: keepText
            ? item.technicalDescription
            : fresh.technicalDescription,
        },
        add,
      });
    }
    const missing = recalculated
      .map(({ item }, index) => ({ index, item }))
      .filter(
        ({ item }) =>
          item.status === 'NEEDS_CHOICE' || item.status === 'NEEDS_MEASURE',
      )
      .map(({ index, item }) => ({
        index,
        text: item.text,
        status: item.status,
        missing: item.missing,
      }));
    if (missing.length) {
      throw new UnprocessableEntityException({
        message: 'Falta escolher o produto ou a medida de alguns itens.',
        missing,
      });
    }

    let quotationId: string;
    if (payload.target === 'CURRENT' && payload.quotationId) {
      await this.editableQuotation(payload.quotationId, user);
      quotationId = payload.quotationId;
    } else {
      quotationId = await this.createQuotation(payload, edits, user);
    }

    const before = new Set(
      (
        await this.prisma.quotationProduct.findMany({
          where: { quotationId },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    for (const { item, add } of recalculated) {
      await this.quotations.addProductToQuotation(
        quotationId,
        this.addItemDto(item, add),
      );
    }
    const itemIds = (
      await this.prisma.quotationProduct.findMany({
        where: { quotationId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
    )
      .map((row) => row.id)
      .filter((id) => !before.has(id));

    const zeroPrice = recalculated.filter(({ item }) => !item.total);
    if (zeroPrice.length) {
      warnings.push(
        `Defina o preço de ${zeroPrice.length === 1 ? 'um item' : `${zeroPrice.length} itens`} no orçamento (Produto base sem preço).`,
      );
    }
    return { status: 'APPLIED' as const, quotationId, itemIds, warnings };
  }

  /** O que vai ao modelo: o resumo, sem valores nem ids. */
  summaryForModel(actionId: string, payload: QuotationDraftPayload) {
    return {
      actionId,
      proposal: payload.quickSale ? 'venda rápida' : 'orçamento',
      target: payload.target,
      client:
        payload.client.match === 'EXACT'
          ? payload.client.name
          : payload.client.match === 'NEEDS_CHOICE'
            ? 'mais de um cliente parecido: a pessoa escolhe no cartão'
            : payload.quickSale
              ? 'venda rápida (cliente da configuração)'
              : 'não encontrado: a pessoa escolhe no cartão',
      items: payload.items.map((item, index) => ({
        index,
        text: item.text,
        status: item.status,
        product: item.productName ?? null,
        missing: item.missing ?? null,
      })),
      warnings: payload.warnings,
      note: 'Os valores aparecem só no cartão da proposta. Não informe preço nem total.',
    };
  }

  /** Sem values:values, o cartão mostra só itens e quantidades. */
  withoutValues(payload: QuotationDraftPayload): QuotationDraftPayload {
    return {
      ...payload,
      total: undefined,
      items: payload.items.map((item) => {
        const copy = { ...item };
        delete copy.unitPrice;
        delete copy.total;
        return copy;
      }),
    };
  }

  /** Um texto curto para a lista de ações da resposta do chat. */
  summaryLine(payload: QuotationDraftPayload) {
    const pending = payload.items.filter(
      (item) =>
        item.status === 'NEEDS_CHOICE' || item.status === 'NEEDS_MEASURE',
    ).length;
    const kind = payload.quickSale ? 'Venda rápida' : 'Orçamento';
    const who =
      payload.client.match === 'EXACT' ? ` para ${payload.client.name}` : '';
    const count = `${payload.items.length} ${payload.items.length === 1 ? 'item' : 'itens'}`;
    return `${kind}${who}: ${count}${pending ? `, ${pending} a completar` : ''}`;
  }

  private itemInputs(value: unknown): ItemInput[] {
    if (!Array.isArray(value)) return [];
    return value
      .slice(0, MAX_ITEMS)
      .map((raw) => {
        const item = (raw && typeof raw === 'object' ? raw : {}) as Record<
          string,
          unknown
        >;
        const productHint = text(item.productHint, 120) || text(item.text, 120);
        const unitHint = text(item.unitHint, 4).toLowerCase();
        return {
          text: text(item.text, 200) || productHint,
          productHint,
          // Preço que o modelo mandar é ignorado: só o que o servidor calcula
          quantity: positive(item.quantity) ?? 1,
          width: positive(item.width, 10_000),
          height: positive(item.height, 10_000),
          unitHint: UNIT_HINTS.includes(unitHint) ? unitHint : undefined,
          variationHint: text(item.variationHint, 60) || undefined,
        };
      })
      .filter((item) => item.productHint);
  }

  private inputOf(item: DraftItem): ItemInput {
    return {
      text: item.text,
      productHint: item.productName ?? item.text,
      quantity: item.quantity,
      width: item.width,
      height: item.height,
      unitHint: item.unit,
      variationHint: item.variationName,
    };
  }

  private withEdit(
    item: DraftItem,
    edit: NonNullable<QuotationDraftEdits['items']>[number] | undefined,
  ): DraftItem {
    if (!edit) return item;
    const changedProduct = edit.productId && edit.productId !== item.productId;
    return {
      ...item,
      ...(edit.productId ? { productId: edit.productId } : {}),
      ...(changedProduct ? { variationId: undefined } : {}),
      ...(edit.variationId ? { variationId: edit.variationId } : {}),
      ...(positive(edit.quantity) ? { quantity: positive(edit.quantity) } : {}),
      ...(positive(edit.width, 10_000)
        ? { width: positive(edit.width, 10_000) }
        : {}),
      ...(positive(edit.height, 10_000)
        ? { height: positive(edit.height, 10_000) }
        : {}),
      ...(positive(edit.measure) ? { measure: positive(edit.measure) } : {}),
    };
  }

  private async context(
    companyId: string,
    features: AiPlanFeatures,
  ): Promise<DraftContext> {
    return { companyId, tiers: features.has('product_composition') };
  }

  /**
   * O cliente pelo nome, entre os ativos e pré-cadastros, ou pelo nome do
   * responsável ("a Juliana"). Um claro, usa; vários, a pessoa escolhe;
   * nenhum, fica sem cliente. Nunca cria cliente.
   */
  async matchClient(
    companyId: string,
    hint: string,
  ): Promise<QuotationDraftPayload['client']> {
    const cleaned = hint.replace(/^(a|o|as|os|da|do|pra|para)\s+/i, '').trim();
    if (!cleaned) return { id: null, name: null, match: 'NONE' };
    const tokens = queryTokens(cleaned);
    if (!tokens.length) return { id: null, name: null, match: 'NONE' };

    const [clients, contacts] = await Promise.all([
      this.prisma.client.findMany({
        where: {
          companyId,
          status: { not: 'INACTIVE' },
          OR: tokens.flatMap((token) => [
            { name: { contains: token, mode: 'insensitive' as const } },
            { tradeName: { contains: token, mode: 'insensitive' as const } },
          ]),
        },
        select: { id: true, name: true, tradeName: true },
        take: 50,
      }),
      this.prisma.contact.findMany({
        where: {
          client: { companyId, status: { not: 'INACTIVE' } },
          OR: tokens.map((token) => ({
            name: { contains: token, mode: 'insensitive' as const },
          })),
        },
        select: {
          name: true,
          client: { select: { id: true, name: true, tradeName: true } },
        },
        take: 20,
      }),
    ]);

    const byId = new Map<
      string,
      { id: string; name: string; extra: string[] }
    >();
    for (const client of clients) {
      byId.set(client.id, {
        id: client.id,
        name: client.name,
        extra: client.tradeName ? [client.tradeName] : [],
      });
    }
    for (const contact of contacts) {
      if (!contact.client) continue;
      const entry = byId.get(contact.client.id) ?? {
        id: contact.client.id,
        name: contact.client.name,
        extra: contact.client.tradeName ? [contact.client.tradeName] : [],
      };
      entry.extra.push(contact.name);
      byId.set(entry.id, entry);
    }

    const ranked = rank(cleaned, [...byId.values()], (entry) => ({
      name: entry.name,
      extra: entry.extra,
    }));
    const chosen = confidentChoice(ranked);
    if (chosen) return { id: chosen.id, name: chosen.name, match: 'EXACT' };
    if (ranked.length) {
      return {
        id: null,
        name: null,
        match: 'NEEDS_CHOICE',
        candidates: ranked
          .slice(0, 5)
          .map(({ item }) => ({ id: item.id, name: item.name })),
      };
    }
    return { id: null, name: null, match: 'NONE' };
  }

  /**
   * Um item: o produto (os 5 candidatos mais parecidos, sem o modelo), a
   * variação, a medida e o preço. Sem candidato, o Produto base do setor.
   * Devolve também as linhas do "Adicionar item", que ficam no servidor.
   */
  private async resolveItem(
    context: DraftContext,
    input: ItemInput,
    chosen: {
      productId?: string;
      variationId?: string;
      width?: number;
      height?: number;
      measure?: number;
    } = {},
  ): Promise<ResolvedItem> {
    const base: DraftItem = {
      text: input.text,
      status: 'OK',
      quantity: input.quantity,
    };
    let product: CatalogProduct | null = null;
    let viaBase = false;

    if (chosen.productId) {
      product = isUUID(chosen.productId)
        ? ((await this.prisma.product.findFirst({
            where: {
              id: chosen.productId,
              companyId: context.companyId,
              isActive: true,
            },
            select: PRODUCT_SELECT,
          })) as CatalogProduct | null)
        : null;
      if (!product) {
        return {
          item: {
            ...base,
            status: 'NEEDS_CHOICE',
            missing: 'O produto escolhido não está ativo no cadastro.',
            candidates: [],
          },
        };
      }
      viaBase = isBase(product.name);
    } else {
      const found = await this.matchProduct(context.companyId, input);
      if (found.product) {
        product = found.product;
      } else if (found.candidates.length) {
        return {
          item: {
            ...base,
            status: 'NEEDS_CHOICE',
            missing: 'Escolha o produto.',
            candidates: found.candidates,
          },
        };
      } else {
        product = await this.baseProductFor(
          context.companyId,
          input,
          found.sector,
        );
        if (!product) {
          return {
            item: {
              ...base,
              status: 'NEEDS_CHOICE',
              missing: 'Produto não cadastrado: escolha um do cadastro.',
              candidates: [],
            },
          };
        }
        viaBase = true;
      }
    }

    const item: DraftItem = {
      ...base,
      productId: product.id,
      productName: product.name,
      unit: unitOf(product),
      description: product.name,
      technicalDescription: product.technicalDescription ?? undefined,
    };
    if (viaBase) {
      // O nome do pedido vai no item; o descritivo leva o trecho inteiro
      item.status = 'BASE_PRODUCT';
      item.description = capitalize(input.productHint);
      item.technicalDescription = input.text;
    }
    if (!product.items.length) {
      return {
        item: {
          ...item,
          status: 'NEEDS_CHOICE',
          missing: 'O produto não tem item de cálculo no cadastro.',
          candidates: [],
        },
      };
    }

    // Produto de várias linhas: a medida do cadastro × a quantidade
    if (product.items.length > 1) {
      const rows = product.items.map((row) => {
        const unitKind = row.unitKind ?? 'UNITY';
        const salePrice = Math.round(
          (row.unitCost ?? 0) *
            rawMeasure({ ...row, unitKind }, unitKind) *
            item.quantity,
        );
        return this.row(row, unitKind, 1, row.unitCost ?? 0, row, salePrice);
      });
      const total = rows.reduce((sum, row) => sum + row.salePrice, 0);
      return {
        item: { ...item, total, rules: [] },
        add: { quantity: item.quantity, rows },
      };
    }

    // Variação: o servidor exige a escolha quando o produto tem variações
    let variation: CatalogProduct['variations'][number] | null = null;
    if (product.variations.length) {
      variation =
        product.variations.find((v) => v.id === chosen.variationId) ??
        (input.variationHint
          ? confidentChoice(
              rank(input.variationHint, product.variations, (v) => ({
                name: v.name,
              })),
            )
          : null);
      if (!variation) {
        return {
          item: {
            ...item,
            status: 'NEEDS_CHOICE',
            missing: 'Escolha a variação do produto.',
            variations: product.variations.map(({ id, name }) => ({
              id,
              name,
            })),
          },
        };
      }
      item.variationId = variation.id;
      item.variationName = variation.name;
      item.description = `${product.name} · ${variation.name}`;
    } else if (input.variationHint && !viaBase) {
      // Sem variação no cadastro (é o caso do START): vai no descritivo
      item.technicalDescription = [
        item.technicalDescription,
        `Pedido: ${input.variationHint}`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    const row = product.items[0];
    const unitKind = row.unitKind ?? 'UNITY';
    const measure = this.measureOf(unitKind, input, chosen, item);
    if (!measure) {
      return {
        item: {
          ...item,
          status: 'NEEDS_MEASURE',
          missing:
            unitKind === 'AREA'
              ? 'Informe a largura e a altura.'
              : `Informe a medida em ${COMMERCIAL_UNIT[unitKind] ?? 'unidades'}.`,
        },
      };
    }
    const price = priceSimpleItem({
      unitKind,
      catalogUnitCost: row.unitCost ?? 0,
      measure: measure.raw,
      quantity: item.quantity,
      variation: variation
        ? { name: variation.name, unitPrice: variation.unitPrice }
        : null,
      tiers: context.tiers && !variation ? product.priceTiers : [],
      minQuantity: product.minQuantity,
    });
    const priced: DraftItem = {
      ...item,
      ...measure.shown,
      ...this.priceFields(price, measure.notes),
    };
    return {
      item: priced,
      // Item simples: a quantidade é a da linha e a do produto fica 1
      add: {
        quantity: 1,
        rows: [
          this.row(
            row,
            unitKind,
            priced.quantity,
            price?.rawUnitCost ?? 0,
            measure.raw,
            priced.total ?? 0,
          ),
        ],
      },
    };
  }

  /** A linha do "Adicionar item", como a tela manda. */
  private row(
    productItem: { id: string },
    unitKind: string,
    quantity: number,
    unitCost: number,
    measure: Partial<
      Record<
        | 'width'
        | 'height'
        | 'length'
        | 'volume'
        | 'weight'
        | 'distance'
        | 'duration',
        number | null
      >
    >,
    salePrice: number,
  ): AddProductItemDto {
    return {
      id: productItem.id,
      unitKind,
      quantity,
      width: measure.width || undefined,
      height: measure.height || undefined,
      length: measure.length || undefined,
      volume: measure.volume || undefined,
      weight: measure.weight || undefined,
      distance: measure.distance || undefined,
      duration: measure.duration || undefined,
      unitCost,
      salePrice,
    } as AddProductItemDto;
  }

  private priceFields(price: ItemPrice | null, notes: string[]) {
    return {
      unitPrice: price?.unitPrice ?? 0,
      total: price?.total ?? 0,
      rules: [...notes, ...(price?.rules ?? [])],
    };
  }

  /**
   * A medida da linha na unidade bruta. Em m², largura e altura (a escrita
   * no pedido manda: "30x40" sem unidade é centímetro); nas outras
   * unidades, a medida informada ou a quantidade na mesma unidade ("10 m").
   */
  private measureOf(
    unitKind: string,
    input: ItemInput,
    chosen: { width?: number; height?: number; measure?: number },
    item: DraftItem,
  ): {
    raw: Record<string, number>;
    shown: Partial<DraftItem>;
    notes: string[];
  } | null {
    if (unitKind === 'UNITY') return { raw: {}, shown: {}, notes: [] };
    const notes: string[] = [];
    if (unitKind === 'AREA') {
      let width = chosen.width;
      let height = chosen.height;
      if (!width || !height) {
        const parsed = parseDimensions(input.text);
        if (parsed) {
          width = parsed.width;
          height = parsed.height;
          if (parsed.unit !== 'm') {
            notes.push(`medida em ${parsed.unit} convertida para metros`);
          }
        } else {
          width = input.width;
          height = input.height;
          if (width > MAX_METERS || height > MAX_METERS) {
            width = width / 100;
            height = height / 100;
            notes.push('medida em cm convertida para metros');
          }
        }
      }
      if (!width || !height) return null;
      return {
        raw: { width: width * 1000, height: height * 1000 },
        shown: { width, height },
        notes,
      };
    }
    const field: Record<string, string> = {
      LENGTH: 'length',
      CAPACITY: 'volume',
      WEIGHT: 'weight',
      DISTANCE: 'distance',
      DURATION: 'duration',
    };
    let measure =
      chosen.measure ?? (unitKind === 'LENGTH' ? input.width : undefined);
    if (!measure && input.unitHint === COMMERCIAL_UNIT[unitKind]) {
      // "10 m de fita": a quantidade é a medida
      measure = item.quantity;
      item.quantity = 1;
    }
    if (!measure || !field[unitKind]) return null;
    return {
      raw: { [field[unitKind]]: measure * rawPerUnit(unitKind) },
      shown: { measure, quantity: item.quantity },
      notes,
    };
  }

  private async matchProduct(companyId: string, input: ItemInput) {
    const tokens = queryTokens(input.productHint);
    const rows = tokens.length
      ? ((await this.prisma.product.findMany({
          where: {
            companyId,
            isActive: true,
            NOT: BASE_PRODUCT_WHERE,
            OR: [
              ...tokens.map((token) => ({
                name: { contains: token, mode: 'insensitive' as const },
              })),
              {
                code: {
                  equals: input.productHint,
                  mode: 'insensitive' as const,
                },
              },
            ],
          },
          select: PRODUCT_SELECT,
          take: 60,
        })) as CatalogProduct[])
      : [];
    const ranked = rank(
      input.productHint,
      rows,
      (row) => ({ name: row.name, code: row.code }),
      // A unidade pedida desempata
      (row) => (input.unitHint && unitOf(row) === input.unitHint ? 0.05 : 0),
    );
    const product = confidentChoice(ranked);
    return {
      product,
      candidates: product
        ? []
        : ranked.slice(0, 5).map(({ item }) => ({
            id: item.id,
            name: item.name,
            code: item.code,
            unit: unitOf(item),
          })),
      // O setor provável, para o Produto base: o do mais parecido
      sector: rows.length
        ? (rank(
            input.productHint,
            rows,
            (row) => ({ name: row.name }),
            () => 0,
          )[0]?.item.sector?.name ?? null)
        : null,
    };
  }

  /** O Produto base do setor provável; sem setor, o que o pedido citar. */
  private async baseProductFor(
    companyId: string,
    input: ItemInput,
    sector: string | null,
  ) {
    const bases = (await this.prisma.product.findMany({
      where: { companyId, isActive: true, ...BASE_PRODUCT_WHERE },
      select: PRODUCT_SELECT,
      orderBy: { name: 'asc' },
    })) as CatalogProduct[];
    if (!bases.length) return null;
    const hint = normalizeText(input.text);
    return (
      bases.find((base) => sector && base.sector?.name === sector) ??
      bases.find(
        (base) =>
          base.sector?.name && hint.includes(normalizeText(base.sector.name)),
      ) ??
      bases[0]
    );
  }

  private itemWarnings(items: DraftItem[]) {
    const warnings: string[] = [];
    items.forEach((item) => {
      if (item.status === 'NEEDS_MEASURE') {
        warnings.push(`Falta a medida de "${item.text}".`);
      } else if (item.status === 'NEEDS_CHOICE') {
        warnings.push(
          `"${item.text}": ${item.missing ?? 'escolha o produto.'}`,
        );
      } else if (item.status === 'BASE_PRODUCT') {
        warnings.push(
          `"${item.text}" não está no cadastro: vai como ${item.productName}, com o preço a definir.`,
        );
      }
    });
    return warnings;
  }

  private totalOf(items: DraftItem[]) {
    return items.reduce((sum, item) => sum + (item.total ?? 0), 0);
  }

  private async ensureCanCreate(user: AiRequestUser) {
    const allowed = await this.abacService.hasPermission(
      user,
      'create',
      'sale:quotation',
    );
    if (!allowed) {
      throw new AiProposalDeniedError('Seu perfil não pode criar orçamentos.');
    }
  }

  /**
   * O orçamento aberto na tela, como a tela confere: desta empresa, do
   * vendedor (quem não vê os outros), em digitação e fora do caixa.
   */
  async editableQuotation(
    quotationId: string | undefined,
    user: AiRequestUser,
  ) {
    if (!quotationId || !isUUID(quotationId)) {
      throw new AiProposalDeniedError('Orçamento não encontrado.');
    }
    const canEdit = await this.abacService.hasPermission(
      user,
      'edit',
      'sale:quotation',
    );
    if (!canEdit) {
      throw new AiProposalDeniedError('Seu perfil não pode editar orçamentos.');
    }
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId: user.companyId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!quotation)
      throw new AiProposalDeniedError('Orçamento não encontrado.');
    const canSeeOthers = await this.abacService.canAccessOtherSellers(
      user,
      'edit',
    );
    if (
      !canSeeOthers &&
      !user.isAdmin &&
      user.employeeId &&
      quotation.sellerId !== user.employeeId
    ) {
      throw new AiProposalDeniedError(
        'Você não pode editar orçamentos de outros vendedores.',
      );
    }
    if (quotation.status !== 'OPEN') {
      throw new AiProposalDeniedError(
        'O orçamento não está em digitação.',
        true,
      );
    }
    if (await isAtCashier(this.prisma, quotationId)) {
      throw new AiProposalDeniedError('A venda já está no caixa.', true);
    }
    return quotation;
  }

  /**
   * O orçamento novo com os padrões da tela: a série padrão que o vendedor
   * pode usar, o vendedor da sessão e a origem "Venda Direta".
   */
  private async createQuotation(
    payload: QuotationDraftPayload,
    edits: QuotationDraftEdits | undefined,
    user: AiRequestUser,
  ) {
    await this.ensureCanCreate(user);
    if (payload.quickSale) {
      // A venda rápida nasce com os padrões da configuração (cliente,
      // série e vendedor da sessão), como o botão da tela (LITE)
      const sale = await this.quickSales.create(user);
      return sale.id;
    }
    const clientId =
      edits?.clientId !== undefined ? edits.clientId : payload.client.id;
    if (clientId) {
      const client = isUUID(clientId)
        ? await this.prisma.client.findFirst({
            where: { id: clientId, companyId: user.companyId },
            select: { id: true },
          })
        : null;
      if (!client) {
        throw new UnprocessableEntityException({
          message: 'Cliente não encontrado.',
          missing: [{ field: 'clientId' }],
        });
      }
    } else if (!payload.quickSale) {
      throw new UnprocessableEntityException({
        message: 'Escolha o cliente do orçamento.',
        missing: [{ field: 'clientId' }],
      });
    }
    if (!user.employeeId) {
      throw new UnprocessableEntityException(
        'Seu usuário não tem colaborador vinculado: o orçamento precisa de um vendedor.',
      );
    }
    const seriesId = await this.defaultSeries(user);
    const contactSource = await this.prisma.contactSource.findFirst({
      where: { name: 'Venda Direta', companyId: user.companyId },
      select: { id: true },
    });
    const created = await this.quotations.create(
      {
        companyId: user.companyId,
        sellerId: user.employeeId,
        clientId: clientId ?? undefined,
        seriesId,
        contactSourceId: contactSource?.id,
        description: payload.notes ?? undefined,
      } as Parameters<QuotationService['create']>[0],
      user.userId,
      user.companyId,
    );
    const deliveryDate =
      edits?.deliveryDate !== undefined
        ? edits.deliveryDate
        : payload.deliveryDate;
    if (isDate(deliveryDate)) {
      await this.prisma.deliveryInfo.updateMany({
        where: { quotationId: created.id },
        data: {
          estimatedDate: new Date(`${deliveryDate}T12:00:00-03:00`),
          deliveryDisplayMode: 'DATE',
        },
      });
    }
    return created.id;
  }

  /** A série padrão entre as que o perfil do vendedor pode usar. */
  private async defaultSeries(user: AiRequestUser) {
    const employee = user.employeeId
      ? await this.prisma.employee.findUnique({
          where: { id: user.employeeId },
          select: { sellerProfileId: true },
        })
      : null;
    const profileFilter = user.isAdmin
      ? {}
      : employee?.sellerProfileId
        ? {
            OR: [
              { allowedProfiles: { none: {} } },
              {
                allowedProfiles: {
                  some: { id: employee.sellerProfileId },
                },
              },
            ],
          }
        : { allowedProfiles: { none: {} } };
    const series = await this.prisma.saleSeries.findFirst({
      where: { companyId: user.companyId, isActive: true, ...profileFilter },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (!series) {
      throw new UnprocessableEntityException(
        'Nenhuma série de venda ativa para o seu perfil: cadastre uma em Configurações › Vendas.',
      );
    }
    return series.id;
  }

  /** O item como a tela manda ao "Adicionar item". */
  private addItemDto(item: DraftItem, add: ResolvedItem['add']): AddItemDto {
    return {
      productId: item.productId,
      quantity: add?.quantity ?? 1,
      description: item.description,
      technicalDescription: item.technicalDescription,
      variationId: item.variationId,
      items: add?.rows ?? [],
    } as AddItemDto;
  }
}

/**
 * Recusa da proposta: vira `denied` na ferramenta. Com `fallback`, não é
 * permissão (o orçamento saiu da digitação, foi ao caixa): a proposta segue
 * como orçamento novo.
 */
export class AiProposalDeniedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly fallback = false,
  ) {
    super(reason);
  }
}
