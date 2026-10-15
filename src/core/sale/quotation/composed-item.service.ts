import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import {
  DRAFT_NOT_FOUND,
  ProductAssemblyService,
} from '../../assembly/product-assembly.service';
import { ProductSaleService } from '../../assembly/product-sale.service';
import {
  AddComposedItemDto,
  CreateComposedDraftDto,
  SaveDraftAsProductDto,
  UpdateComposedItemDto,
} from './dto/composed-item.dto';
import { QuotationLinesService } from './quotation-lines.service';
import { QUOTATION_PRODUCT_SELECT } from './quotation.includes';
import { recalculateQuotationTotal } from './quotation-totals';
import { transformQuotationItem } from './quotation.transformers';
import { calculateFinalValue } from './quotation.utils';

export const COMPOSED_NOT_OPEN =
  'Só dá para mexer no item com o orçamento em digitação';
export const COMPOSED_NAME_REQUIRED = 'Informe o nome do item';
export const COMPOSED_ITEM_NOT_FOUND = 'Item não encontrado';
export const COMPOSED_WITHOUT_STAGES = 'Monte ao menos uma etapa antes';

/** O que é custo na leitura da composição: o rascunho nunca devolve (ORC-7). */
const DRAFT_COST_FIELDS = new Set(['unitCost', 'cost', 'setupCost', 'margin']);

/**
 * A leitura da composição do rascunho para o vendedor: o preço de venda de
 * cada etapa e recurso, nunca o custo (ORC-7, ORC-11).
 */
export function withoutCost<T extends object>(view: T) {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !DRAFT_COST_FIELDS.has(key))
          .map(([key, inner]) => [key, strip(inner)]),
      );
    }
    return value;
  };
  const hidden = strip(view) as Partial<T> & Record<string, unknown>;
  delete hidden.tierSummary;
  delete hidden.variationSummary;
  return hidden;
}

/** O rascunho que não virou item sai depois deste prazo (PO, 14/10/2026). */
export const DRAFT_TTL_DAYS = 30;

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

/** O que o rascunho devolve: nome e medida (mm). */
const DRAFT_SELECT = {
  id: true,
  name: true,
  quantity: true,
  width: true,
  height: true,
} as const;

/**
 * O item montado na hora (ORC-11, Fase 4.5): quando o produto não existe
 * pronto, o vendedor monta as etapas num rascunho de composição ligado ao
 * orçamento, com o mesmo editor do produto (rotas de etapa com o rascunho
 * como dono). Ao incluir, o servidor calcula o retrato das etapas na medida
 * do item (custo e venda de cada uma); o preço do item é a soma delas. Na
 * nota, o padrão genérico do emissor; nos relatórios e na agenda, os setores
 * das etapas.
 */
@Injectable()
export class ComposedItemService {
  private readonly logger = new Logger(ComposedItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assemblies: ProductAssemblyService,
    private readonly sale: ProductSaleService,
    private readonly lines: QuotationLinesService,
  ) {}

  /* -------------------------------------------------------------- rascunho */

  /** O rascunho novo, em digitação; a composição nasce na primeira etapa. */
  async createDraft(quotationId: string, dto: CreateComposedDraftDto) {
    const quotation = await this.openQuotation(quotationId);
    return this.prisma.quotationDraft.create({
      data: {
        companyId: quotation.companyId,
        quotationId,
        ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
        ...this.measureData(dto),
      },
      select: DRAFT_SELECT,
    });
  }

  /** Nome e medida do rascunho, antes de incluir ou de refazer o item. */
  async updateDraft(
    quotationId: string,
    draftId: string,
    dto: CreateComposedDraftDto,
  ) {
    await this.draftOf(quotationId, draftId);
    return this.prisma.quotationDraft.update({
      where: { id: draftId },
      data: {
        ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
        ...this.measureData(dto),
      },
      select: DRAFT_SELECT,
    });
  }

  /**
   * O rascunho deste orçamento (o id de outro responde como inexistente) e o
   * contexto da composição com ele como dono.
   */
  async draftOf(quotationId: string, draftId: string) {
    const draft = await this.prisma.quotationDraft.findFirst({
      where: { id: draftId, quotationId },
      select: { ...DRAFT_SELECT, companyId: true },
    });
    if (!draft) throw new NotFoundException(DRAFT_NOT_FOUND);
    return draft;
  }

  draftCtx(companyId: string, draftId: string) {
    return { companyId, productId: draftId, draftId, variationId: null };
  }

  /* ------------------------------------------------------------------ item */

  /**
   * Inclui o item montado: grava nome e medida no rascunho e o retrato das
   * etapas no item. Rascunho sem etapa não é erro: o item fica marcado para
   * atenção (MS-12) e o orçamento não conclui até as etapas existirem.
   */
  async addComposed(quotationId: string, dto: AddComposedItemDto) {
    await this.openQuotation(quotationId);
    const name = dto.name?.trim() || bad(COMPOSED_NAME_REQUIRED);
    const draft = await this.draftOf(quotationId, dto.draftId);
    await this.prisma.quotationDraft.update({
      where: { id: draft.id },
      data: { name, ...this.measureData(dto) },
    });
    const computed = await this.sale.draftComposition(
      draft.companyId,
      draft.id,
      {
        quantity: dto.quantity,
        width: dto.width ?? draft.width,
        height: dto.height ?? draft.height,
      },
    );
    const item = await this.prisma.quotationProduct.create({
      data: {
        quotationId,
        origin: 'COMPOSED',
        draftId: draft.id,
        description: name,
        technicalDescription: dto.description?.trim() || null,
        quantity: dto.quantity,
        totalValue: computed.price,
        finalValue: computed.price,
        snapshot: { create: { data: asJson(computed.snapshot) } },
      },
      select: { id: true },
    });
    await recalculateQuotationTotal(this.prisma, quotationId);
    return { ...(await this.itemView(item.id)), attention: computed.attention };
  }

  /**
   * Refaz o item montado com o rascunho de agora: nome, descritivo, medida e
   * o retrato. Em digitação, ou na O.S. aprovada de conta sem estoque.
   */
  async updateComposed(itemId: string, dto: UpdateComposedItemDto) {
    const item = await this.prisma.quotationProduct.findUnique({
      where: { id: itemId },
      include: {
        quotation: { select: { companyId: true, status: true } },
        draft: { select: DRAFT_SELECT },
      },
    });
    if (!item || item.origin !== 'COMPOSED' || !item.draft) {
      throw new NotFoundException(COMPOSED_ITEM_NOT_FOUND);
    }
    const editable =
      item.quotation.status === 'OPEN' ||
      (item.quotation.status === 'APPROVED' &&
        (await this.lines.approvedEditable(item.quotation.companyId)));
    if (!editable) bad(COMPOSED_NOT_OPEN);
    if (dto.name !== undefined && !dto.name.trim()) {
      bad(COMPOSED_NAME_REQUIRED);
    }

    const name = dto.name?.trim() || item.description || item.draft.name;
    const quantity = dto.quantity ?? item.quantity;
    await this.prisma.quotationDraft.update({
      where: { id: item.draft.id },
      data: { name, ...this.measureData(dto) },
    });
    const computed = await this.sale.draftComposition(
      item.quotation.companyId,
      item.draft.id,
      {
        quantity,
        width: dto.width ?? item.draft.width,
        height: dto.height ?? item.draft.height,
      },
    );
    await this.prisma.quotationProduct.update({
      where: { id: itemId },
      data: {
        description: name,
        ...(dto.description !== undefined && {
          technicalDescription: dto.description?.trim() || null,
        }),
        quantity,
        totalValue: computed.price,
        finalValue: calculateFinalValue(
          computed.price,
          item.discount,
          item.discountType,
        ),
        snapshot: {
          upsert: {
            create: { data: asJson(computed.snapshot) },
            update: { data: asJson(computed.snapshot), computedAt: new Date() },
          },
        },
      },
    });
    // O acréscimo e as linhas entram por fora do desconto (ALT-25, ORC-5)
    if (item.addition || item.linesTotal) {
      await this.lines.refreshItem(itemId);
    }
    await recalculateQuotationTotal(this.prisma, item.quotationId);
    // As tarefas de produção acompanham a O.S. alterada (ELITE)
    await this.lines.afterItemChange(itemId);
    return { ...(await this.itemView(itemId)), attention: computed.attention };
  }

  /**
   * "Salvar como produto" (ORC-11): um produto novo com as etapas do
   * rascunho, a composição "Em edição" (IP-14) e sem código: o código sai
   * quando a composição for liberada para venda (PO, 14/10/2026). O item do
   * orçamento continua sendo o que foi montado nele.
   */
  async saveAsProduct(
    quotationId: string,
    draftId: string,
    dto: SaveDraftAsProductDto,
  ) {
    const draft = await this.draftOf(quotationId, draftId);
    const ctx = this.draftCtx(draft.companyId, draft.id);
    const owner = await this.assemblies.product(ctx);
    const assembly = await this.assemblies.assemblyOf(owner, '');
    if (!assembly?.blocks.length) bad(COMPOSED_WITHOUT_STAGES);

    const name = dto.name?.trim() || draft.name;
    // O setor do produto: o da primeira etapa que tem um; sem nenhum, o
    // primeiro setor ativo da empresa
    const firstSector =
      assembly.blocks
        .map((block) => block.process?.sectorId ?? block.sectorId)
        .find(Boolean) ??
      (
        await this.prisma.companySector.findFirst({
          where: { companyId: draft.companyId, isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true },
        })
      )?.id;
    if (!firstSector) bad('Cadastre um setor antes de salvar o produto');
    const category = await this.prisma.category.findFirst({
      where: {
        kind: 'PRODUCT',
        isActive: true,
        OR: [{ companyId: draft.companyId }, { companyId: null }],
      },
      orderBy: [{ sectorId: 'asc' }, { name: 'asc' }],
      select: { id: true },
    });
    if (!category) bad('Cadastre uma categoria de produto antes');

    const productId = await this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.create({
          data: {
            name,
            code: null,
            companyId: draft.companyId,
            categoryId: category.id,
            sectorId: firstSector,
            items: {
              create: [
                {
                  name,
                  unitKind: 'UNITY',
                  unitCost: 0,
                  salePrice: 0,
                  width: draft.width,
                  height: draft.height,
                },
              ],
            },
          },
          select: { id: true },
        });
        const copy = await this.assemblies.copyAssembly(tx, assembly, {
          companyId: draft.companyId,
          productId: product.id,
          variationId: null,
        });
        await tx.productAssembly.update({
          where: { id: copy },
          data: { status: 'DRAFT' },
        });
        return product.id;
      },
      { timeout: 30_000 },
    );
    return { productId, name, status: 'DRAFT' as const, code: null };
  }

  /* ------------------------------------------------------------- limpeza */

  /**
   * Todo dia, os rascunhos com mais de 30 dias que não viraram item saem com
   * a composição deles (PO, 14/10/2026).
   */
  @Cron('15 3 * * *', {
    name: 'quotation-draft-cleanup',
    timeZone: 'America/Sao_Paulo',
  })
  async cleanupDrafts(now = new Date()) {
    const limit = new Date(now.getTime() - DRAFT_TTL_DAYS * 86_400_000);
    try {
      const { count } = await this.prisma.quotationDraft.deleteMany({
        where: { createdAt: { lt: limit }, items: { none: {} } },
      });
      if (count) {
        this.logger.log(`${count} rascunhos de item montado apagados`);
      }
      return count;
    } catch (error) {
      this.logger.error(`Rascunhos não apagados: ${error?.message}`);
      return 0;
    }
  }

  /**
   * Uma cópia do rascunho com a composição dele, para o item duplicado (o
   * do orçamento ou o do orçamento inteiro): editar a cópia não mexe no
   * original.
   */
  async cloneDraft(draftId: string, quotationId: string) {
    const draft = await this.prisma.quotationDraft.findUnique({
      where: { id: draftId },
    });
    if (!draft) return null;
    const owner = await this.assemblies.product(
      this.draftCtx(draft.companyId, draft.id),
    );
    const assembly = await this.assemblies.assemblyOf(owner, '');
    return this.prisma.$transaction(async (tx) => {
      const copy = await tx.quotationDraft.create({
        data: {
          companyId: draft.companyId,
          quotationId,
          name: draft.name,
          quantity: draft.quantity,
          width: draft.width,
          height: draft.height,
        },
        select: { id: true },
      });
      if (assembly) {
        await this.assemblies.copyAssembly(tx, assembly, {
          companyId: draft.companyId,
          draftId: copy.id,
          variationId: null,
        });
      }
      return copy.id;
    });
  }

  /* ----------------------------------------------------------------- apoio */

  private async openQuotation(quotationId: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, companyId: true, status: true },
    });
    if (!quotation) throw new NotFoundException('Orçamento não encontrado');
    if (quotation.status !== 'OPEN') bad(COMPOSED_NOT_OPEN);
    return quotation;
  }

  private measureData(dto: {
    quantity?: number;
    width?: number;
    height?: number;
  }) {
    return {
      ...(dto.quantity !== undefined && { quantity: dto.quantity }),
      ...(dto.width !== undefined && { width: dto.width }),
      ...(dto.height !== undefined && { height: dto.height }),
    };
  }

  private async itemView(itemId: string) {
    const item = await this.prisma.quotationProduct.findUnique({
      where: { id: itemId },
      select: QUOTATION_PRODUCT_SELECT,
    });
    return item ? transformQuotationItem(item) : null;
  }
}
