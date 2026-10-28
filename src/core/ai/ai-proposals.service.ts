import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { PayableService } from '../financial/payable/payable.service';
import { ProductService } from '../product/product.service';
import { isAtCashier } from '../sale/quick-sale/quick-sale.rules';
import { QuotationService } from '../sale/quotation/quotation.service';
import { AiProposalDeniedError } from './ai-quotation-draft.service';
import {
  confidentChoice,
  matchScore,
  queryTokens,
  rank,
} from './ai-text-match';
import { AiRequestUser } from './ai.types';

/** O que a ferramenta sabe da tela além dos argumentos do modelo. */
export interface AiProposalContext {
  quotationId?: string;
  quotationItemId?: string;
  productId?: string;
  payableId?: string;
}

export interface ItemDescriptionPayload {
  target: 'QUOTATION_ITEM' | 'PRODUCT';
  id: string;
  quotationId: string | null;
  name: string;
  current: string | null;
  proposed: string;
}

export interface FinancialCategoryPayload {
  description: string;
  payableId: string | null;
  suggestion: {
    natureId: string;
    natureName: string | null;
    subCategoryId: string | null;
    subCategoryName: string | null;
    supplierId: string | null;
    supplierName: string | null;
  } | null;
  confidence: 'HIGH' | 'LOW';
  basis: { similar: number; examples: string[] };
  warnings: string[];
}

export interface NextContactPayload {
  quotationId: string;
  quotationNumber: number | null;
  clientName: string | null;
  nextContactAt: string;
  note: string | null;
  current: { nextContactAt: string | null; note: string | null };
}

const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const NEGOTIATING_STATUSES = ['OPEN', 'DONE'];

/**
 * As propostas das fases 3 e 4 do agente (documento de 28/10/2026): o
 * descritivo técnico do item ou do produto, a categoria do lançamento pelo
 * histórico da empresa e o próximo contato do orçamento. Como no rascunho de
 * orçamento, a proposta só grava no "Aplicar", que confere tudo de novo e
 * grava pelos serviços das telas.
 */
@Injectable()
export class AiProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
    private readonly products: ProductService,
    private readonly quotations: QuotationService,
    private readonly payables: PayableService,
  ) {}

  // ─── Descritivo técnico ────────────────────────────────────────────────

  descriptionToolSchema() {
    return {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'O descritivo técnico proposto: material, medidas, acabamento e aplicação, em texto corrido. Sem preço.',
        },
        quotationItemId: {
          type: 'string',
          description: 'O item do orçamento, quando a tela é a do item.',
        },
        productId: {
          type: 'string',
          description: 'O produto do cadastro, quando a tela é a do produto.',
        },
      },
      required: ['text'],
    };
  }

  async buildItemDescription(
    args: Record<string, unknown>,
    user: AiRequestUser,
    context: AiProposalContext,
  ): Promise<ItemDescriptionPayload> {
    const proposed = clean(args.text, 2000);
    if (!proposed) {
      throw new BadRequestException('Escreva o descritivo proposto.');
    }
    const quotationItemId =
      clean(args.quotationItemId, 40) || context.quotationItemId;
    const productId = clean(args.productId, 40) || context.productId;
    if (quotationItemId) {
      const item = await this.quotationItemFor(user, quotationItemId);
      return {
        target: 'QUOTATION_ITEM',
        id: item.id,
        quotationId: item.quotationId,
        name: item.description ?? item.product?.name ?? 'Item',
        current: item.technicalDescription ?? null,
        proposed,
      };
    }
    if (productId) {
      const product = await this.productFor(user, productId);
      return {
        target: 'PRODUCT',
        id: product.id,
        quotationId: null,
        name: product.name,
        current: product.technicalDescription ?? null,
        proposed,
      };
    }
    throw new BadRequestException(
      'Diga de qual produto ou item do orçamento é o descritivo.',
    );
  }

  async applyItemDescription(
    payload: ItemDescriptionPayload,
    edited: { text?: unknown } | undefined,
    user: AiRequestUser,
  ) {
    const text = clean(edited?.text, 2000) || payload.proposed;
    if (payload.target === 'QUOTATION_ITEM') {
      await this.quotationItemFor(user, payload.id);
      await this.quotations.updateProductInQuotation(payload.id, {
        technicalDescription: text,
      } as Parameters<QuotationService['updateProductInQuotation']>[1]);
    } else {
      await this.productFor(user, payload.id);
      await this.products.update(payload.id, {
        technicalDescription: text,
      } as Parameters<ProductService['update']>[1]);
    }
    return {
      status: 'APPLIED' as const,
      target: payload.target,
      id: payload.id,
      quotationId: payload.quotationId,
    };
  }

  /** O item como a tela de itens confere: orçamento editável e liberado. */
  private async quotationItemFor(user: AiRequestUser, id: string) {
    const item = isUUID(id)
      ? await this.prisma.quotationProduct.findFirst({
          where: { id, quotation: { companyId: user.companyId } },
          select: {
            id: true,
            quotationId: true,
            description: true,
            technicalDescription: true,
            allowEditDescription: true,
            product: { select: { name: true } },
          },
        })
      : null;
    if (!item) throw new AiProposalDeniedError('Item não encontrado.');
    await this.editableQuotation(user, item.quotationId, ['OPEN']);
    if (item.allowEditDescription === false) {
      throw new AiProposalDeniedError(
        'Este produto não permite editar o descritivo no orçamento.',
      );
    }
    return item;
  }

  private async productFor(user: AiRequestUser, id: string) {
    const canEdit = await this.abacService.hasPermission(
      user,
      'edit',
      'product_settings:products',
    );
    if (!canEdit) {
      throw new AiProposalDeniedError('Seu perfil não pode editar produtos.');
    }
    const product = isUUID(id)
      ? await this.prisma.product.findFirst({
          where: { id, companyId: user.companyId, isActive: true },
          select: { id: true, name: true, technicalDescription: true },
        })
      : null;
    if (!product) throw new AiProposalDeniedError('Produto não encontrado.');
    return product;
  }

  // ─── Categoria do lançamento ───────────────────────────────────────────

  categoryToolSchema() {
    return {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            'A descrição do lançamento a pagar: "conta de luz", "lona 440 g da Papel Central".',
        },
        supplierHint: {
          type: 'string',
          description: 'O fornecedor, se a pessoa disse.',
        },
        payableId: {
          type: 'string',
          description: 'O lançamento já gravado, quando a tela é a dele.',
        },
      },
      required: ['description'],
    };
  }

  /**
   * A categoria do plano de contas (natureza e subcategoria) e o fornecedor
   * pelo histórico de contas a pagar da própria empresa: os lançamentos de
   * descrição parecida votam, com o peso da semelhança. Sem histórico, não
   * há proposta.
   */
  async buildFinancialCategory(
    args: Record<string, unknown>,
    user: AiRequestUser,
    context: AiProposalContext,
  ): Promise<FinancialCategoryPayload> {
    await this.ensurePayablePermission(user);
    const payableId = clean(args.payableId, 40) || context.payableId || null;
    const payable = payableId ? await this.payableFor(user, payableId) : null;
    const description =
      clean(args.description, 300) || payable?.description || '';
    if (!description) {
      throw new BadRequestException('Diga a descrição do lançamento.');
    }
    const warnings: string[] = [];

    const supplier = await this.matchSupplier(
      user.companyId,
      clean(args.supplierHint, 120),
    );
    const tokens = queryTokens(description);
    const history = await this.prisma.payable.findMany({
      where: {
        companyId: user.companyId,
        natureId: { not: null },
        ...(payableId ? { id: { not: payableId } } : {}),
        OR: [
          ...tokens.map((token) => ({
            description: { contains: token, mode: 'insensitive' as const },
          })),
          ...(supplier ? [{ supplierId: supplier.id }] : []),
        ],
      },
      select: {
        description: true,
        natureId: true,
        subCategoryId: true,
        supplierId: true,
        nature: { select: { description: true } },
        subCategory: { select: { description: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const scored = history
      .map((row) => ({
        row,
        score:
          matchScore(description, { name: row.description ?? '' }) +
          (supplier && row.supplierId === supplier.id ? 0.3 : 0),
      }))
      .filter((entry) => entry.score >= 0.3);
    if (!scored.length) {
      warnings.push(
        'Não há lançamentos parecidos no histórico: escolha a categoria no lançamento.',
      );
      return {
        description,
        payableId,
        suggestion: null,
        confidence: 'LOW',
        basis: { similar: 0, examples: [] },
        warnings,
      };
    }

    const vote = <K>(key: (row: (typeof scored)[number]['row']) => K) => {
      const totals = new Map<K, number>();
      for (const { row, score } of scored) {
        const value = key(row);
        if (value === null || value === undefined) continue;
        totals.set(value, (totals.get(value) ?? 0) + score);
      }
      return [...totals.entries()].sort((a, b) => b[1] - a[1]);
    };
    const categories = vote(
      (row) => `${row.natureId}|${row.subCategoryId ?? ''}`,
    );
    const [bestKey, bestWeight] = categories[0];
    const total = categories.reduce((sum, [, weight]) => sum + weight, 0);
    const best = scored.find(
      ({ row }) => `${row.natureId}|${row.subCategoryId ?? ''}` === bestKey,
    ).row;
    const supplierVote = supplier ? null : vote((row) => row.supplierId)[0];
    const supplierRow = supplierVote
      ? scored.find(({ row }) => row.supplierId === supplierVote[0])?.row
      : null;

    return {
      description,
      payableId,
      suggestion: {
        natureId: best.natureId,
        natureName: best.nature?.description ?? null,
        subCategoryId: best.subCategoryId,
        subCategoryName: best.subCategory?.description ?? null,
        supplierId: supplier?.id ?? supplierRow?.supplierId ?? null,
        supplierName: supplier?.name ?? supplierRow?.supplier?.name ?? null,
      },
      confidence:
        scored.length >= 2 && bestWeight / total >= 0.6 ? 'HIGH' : 'LOW',
      basis: {
        similar: scored.length,
        examples: [
          ...new Set(scored.map(({ row }) => row.description).filter(Boolean)),
        ].slice(0, 3),
      },
      warnings,
    };
  }

  /**
   * Com o lançamento gravado, atualiza pelo serviço da tela; sem ele (o
   * lançamento novo, ainda no formulário), devolve os campos para a tela
   * preencher.
   */
  async applyFinancialCategory(
    payload: FinancialCategoryPayload,
    edited: Record<string, unknown> | undefined,
    user: AiRequestUser,
  ) {
    if (!payload.suggestion) {
      throw new UnprocessableEntityException(
        'Não há categoria para aplicar: escolha no lançamento.',
      );
    }
    await this.ensurePayablePermission(user);
    const fields = {
      natureId: clean(edited?.natureId, 40) || payload.suggestion.natureId,
      subCategoryId:
        clean(edited?.subCategoryId, 40) ||
        payload.suggestion.subCategoryId ||
        undefined,
      supplierId:
        clean(edited?.supplierId, 40) ||
        payload.suggestion.supplierId ||
        undefined,
    };
    if (payload.payableId) {
      await this.payableFor(user, payload.payableId);
      // O serviço confere que natureza, subcategoria e fornecedor são da
      // empresa do lançamento e grava o histórico
      await this.payables.updateTitle(
        payload.payableId,
        fields,
        user.userId,
        user.username,
      );
    }
    return {
      status: 'APPLIED' as const,
      payableId: payload.payableId,
      fields,
    };
  }

  private async ensurePayablePermission(user: AiRequestUser) {
    const allowed = await this.abacService.hasAnyPermission(user, [
      { action: 'create', resource: 'financial:payable' },
      { action: 'edit', resource: 'financial:payable' },
      { action: 'create', resource: 'financial:flow' },
      { action: 'edit', resource: 'financial:flow' },
    ]);
    if (!allowed) {
      throw new AiProposalDeniedError(
        'Seu perfil não pode lançar contas a pagar.',
      );
    }
  }

  private async payableFor(user: AiRequestUser, id: string) {
    const payable = isUUID(id)
      ? await this.prisma.payable.findFirst({
          where: { id, companyId: user.companyId },
          select: { id: true, description: true },
        })
      : null;
    if (!payable) throw new AiProposalDeniedError('Lançamento não encontrado.');
    return payable;
  }

  private async matchSupplier(companyId: string, hint: string) {
    if (!hint) return null;
    const tokens = queryTokens(hint);
    if (!tokens.length) return null;
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        companyId,
        status: { not: 'INACTIVE' },
        OR: tokens.map((token) => ({
          name: { contains: token, mode: 'insensitive' as const },
        })),
      },
      select: { id: true, name: true },
      take: 30,
    });
    return confidentChoice(
      rank(hint, suppliers, (row) => ({ name: row.name })),
    );
  }

  // ─── Próximo contato ───────────────────────────────────────────────────

  nextContactToolSchema() {
    return {
      type: 'object',
      properties: {
        quotationId: {
          type: 'string',
          description:
            'O orçamento; omita quando a tela atual é a do orçamento.',
        },
        date: {
          type: 'string',
          description:
            'AAAA-MM-DD, calculada a partir de hoje ("na quinta" = a próxima quinta).',
        },
        time: { type: 'string', description: 'HH:MM, se a pessoa disse.' },
        note: {
          type: 'string',
          description: 'O lembrete: "ligar para a Juliana sobre a fachada".',
        },
      },
      required: ['date'],
    };
  }

  async buildNextContact(
    args: Record<string, unknown>,
    user: AiRequestUser,
    context: AiProposalContext,
  ): Promise<NextContactPayload> {
    const quotationId = clean(args.quotationId, 40) || context.quotationId;
    if (!quotationId) {
      throw new BadRequestException(
        'Diga de qual orçamento é o próximo contato.',
      );
    }
    const date = clean(args.date, 10);
    const time = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(clean(args.time, 5))
      ? clean(args.time, 5)
      : '09:00';
    const at = new Date(`${date}T${time}:00-03:00`);
    if (
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) ||
      Number.isNaN(at.getTime())
    ) {
      throw new BadRequestException('Informe a data como AAAA-MM-DD.');
    }
    const today = new Date(
      `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())}T00:00:00-03:00`,
    );
    if (at < today) {
      throw new BadRequestException(
        'A data do próximo contato já passou: escolha hoje ou depois.',
      );
    }
    const quotation = await this.editableQuotation(
      user,
      quotationId,
      NEGOTIATING_STATUSES,
    );
    return {
      quotationId: quotation.id,
      quotationNumber: quotation.quotationNumber ?? null,
      clientName: quotation.client?.name ?? null,
      nextContactAt: at.toISOString(),
      note: clean(args.note, 500) || null,
      current: {
        nextContactAt: quotation.nextContactAt?.toISOString() ?? null,
        note: quotation.nextContactNote ?? null,
      },
    };
  }

  async applyNextContact(
    payload: NextContactPayload,
    edited: Record<string, unknown> | undefined,
    user: AiRequestUser,
  ) {
    await this.editableQuotation(
      user,
      payload.quotationId,
      NEGOTIATING_STATUSES,
    );
    const editedAt = clean(edited?.nextContactAt, 40);
    const nextContactAt =
      editedAt && !Number.isNaN(new Date(editedAt).getTime())
        ? new Date(editedAt).toISOString()
        : payload.nextContactAt;
    const note =
      edited?.note !== undefined
        ? clean(edited.note, 500) || null
        : payload.note;
    await this.quotations.update(
      payload.quotationId,
      { nextContactAt, nextContactNote: note } as Parameters<
        QuotationService['update']
      >[1],
      user.userId,
      user.companyId,
    );
    return {
      status: 'APPLIED' as const,
      quotationId: payload.quotationId,
      nextContactAt,
      note,
    };
  }

  /**
   * O orçamento como a tela confere para editar: da empresa, do vendedor
   * (quem não vê os outros), na situação esperada e fora do caixa.
   */
  private async editableQuotation(
    user: AiRequestUser,
    quotationId: string,
    statuses: string[],
  ) {
    const canEdit = await this.abacService.hasPermission(
      user,
      'edit',
      'sale:quotation',
    );
    if (!canEdit) {
      throw new AiProposalDeniedError('Seu perfil não pode editar orçamentos.');
    }
    const quotation = isUUID(quotationId)
      ? await this.prisma.quotation.findFirst({
          where: { id: quotationId, companyId: user.companyId, isActive: true },
          select: {
            id: true,
            sellerId: true,
            status: true,
            quotationNumber: true,
            nextContactAt: true,
            nextContactNote: true,
            client: { select: { name: true } },
          },
        })
      : null;
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
    if (!statuses.includes(quotation.status)) {
      throw new AiProposalDeniedError(
        statuses.length === 1
          ? 'O orçamento não está em digitação.'
          : 'O orçamento não está mais em negociação.',
      );
    }
    if (await isAtCashier(this.prisma, quotationId)) {
      throw new AiProposalDeniedError('A venda já está no caixa.');
    }
    return quotation;
  }

  // ─── Resumos ────────────────────────────────────────────────────────────

  summaryForModel(type: string, actionId: string | null, payload: unknown) {
    switch (type) {
      case 'ITEM_DESCRIPTION': {
        const p = payload as ItemDescriptionPayload;
        return {
          actionId,
          proposal: 'descritivo',
          target: p.target === 'PRODUCT' ? 'produto' : 'item do orçamento',
          name: p.name,
        };
      }
      case 'FINANCIAL_CATEGORY': {
        const p = payload as FinancialCategoryPayload;
        return {
          actionId,
          proposal: 'categoria do lançamento',
          category: p.suggestion
            ? [p.suggestion.natureName, p.suggestion.subCategoryName]
                .filter(Boolean)
                .join(' › ')
            : null,
          supplier: p.suggestion?.supplierName ?? null,
          confidence: p.confidence,
          similarEntries: p.basis.similar,
          warnings: p.warnings,
        };
      }
      case 'NEXT_CONTACT': {
        const p = payload as NextContactPayload;
        return {
          actionId,
          proposal: 'próximo contato',
          quotation: p.quotationNumber,
          client: p.clientName,
          nextContactAt: p.nextContactAt,
          note: p.note,
        };
      }
      default:
        return { actionId };
    }
  }

  summaryLine(type: string, payload: unknown) {
    switch (type) {
      case 'ITEM_DESCRIPTION':
        return `Descritivo de ${(payload as ItemDescriptionPayload).name}`;
      case 'FINANCIAL_CATEGORY': {
        const s = (payload as FinancialCategoryPayload).suggestion;
        return `Categoria: ${[s?.natureName, s?.subCategoryName].filter(Boolean).join(' › ')}`;
      }
      case 'NEXT_CONTACT': {
        const p = payload as NextContactPayload;
        const day = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(p.nextContactAt));
        return `Próximo contato${p.quotationNumber ? ` do orçamento ${p.quotationNumber}` : ''} em ${day}`;
      }
      default:
        return 'Proposta do assistente';
    }
  }
}
