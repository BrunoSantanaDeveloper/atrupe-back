import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PlanControlService } from '../plan/plan-control.service';
import { ProductService } from '../product/product.service';
import { ASSEMBLY_INCLUDE } from './assembly-graph';
import {
  PRODUCT_NOT_FOUND,
  ProductAssemblyService,
} from './product-assembly.service';

/** Orçamentos que ainda podem ser aprovados: o mesmo critério do módulo 2. */
const OPEN_QUOTATION = ['OPEN', 'DONE', 'OVERDUE'] as const;

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

/**
 * O produto no cadastro: onde ele é usado (para o diálogo de inativar,
 * PAD-7) e o duplicar com a composição num passo só (03/10).
 */
@Injectable()
export class ProductCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assemblies: ProductAssemblyService,
    private readonly products: ProductService,
    private readonly planControl: PlanControlService,
  ) {}

  /**
   * As etapas-parte que apontam para o produto, em qualquer composição, e os
   * orçamentos em aberto que o têm como item.
   */
  async usage(companyId: string, productId: string) {
    await this.exists(companyId, productId);
    const [blocks, items] = await Promise.all([
      this.prisma.assemblyBlock.findMany({
        where: { partProductId: productId, assembly: { companyId } },
        select: {
          name: true,
          assembly: {
            select: {
              productId: true,
              product: { select: { name: true } },
              variation: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.quotationProduct.findMany({
        where: {
          productId,
          quotation: {
            companyId,
            isActive: true,
            status: { in: [...OPEN_QUOTATION] },
          },
        },
        select: {
          id: true,
          description: true,
          product: { select: { name: true } },
          quotation: {
            select: {
              id: true,
              quotationNumber: true,
              client: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    return {
      asPart: blocks.map((block) => ({
        productId: block.assembly.productId,
        name: block.assembly.product.name,
        variation: block.assembly.variation?.name ?? null,
        stage: block.name,
      })),
      openQuotations: items.map((item) => ({
        quotationId: item.quotation.id,
        reference:
          item.quotation.quotationNumber !== null
            ? String(item.quotation.quotationNumber)
            : null,
        client: item.quotation.client?.name ?? null,
        itemId: item.id,
        itemName: item.description || item.product.name,
      })),
    };
  }

  /**
   * Duplica o cadastro (itens, dados fiscais, variações) e, com a base de
   * custos, a composição (padrão e das variações). As faixas vão com a
   * composição do plano. A cópia nasce em edição (IP-14); a etapa de
   * processo continua ligada ao mesmo processo (CP-21).
   */
  async duplicate(companyId: string, productId: string, rawName: string) {
    const name = rawName.trim();
    if (!name) bad('Informe o nome do produto');
    const source = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      include: {
        items: { orderBy: { name: 'asc' } },
        fiscalData: true,
        stRules: true,
        variations: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        priceTiers: true,
      },
    });
    if (!source) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const [withCosts, withTiers] = await Promise.all([
      this.planControl.hasFeature(companyId, 'cost_base'),
      this.planControl.hasFeature(companyId, 'product_composition'),
    ]);
    const assemblies = withCosts
      ? await this.prisma.productAssembly.findMany({
          where: { productId, companyId },
          include: ASSEMBLY_INCLUDE,
        })
      : [];
    const code = await this.freeCode(companyId, source.code);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.create({
          data: {
            name,
            code,
            companyId,
            categoryId: source.categoryId,
            sectorId: source.sectorId,
            isService: source.isService,
            allowEditDescription: source.allowEditDescription,
            allowEditValues: source.allowEditValues,
            imageUrl: source.imageUrl,
            imageSize: source.imageSize,
            technicalDescription: source.technicalDescription,
            productionStages: source.productionStages ?? Prisma.DbNull,
            status: source.status,
            items: {
              create: source.items.map((item) => ({
                name: item.name,
                unitCost: item.unitCost,
                salePrice: item.salePrice,
                distance: item.distance,
                duration: item.duration,
                height: item.height,
                length: item.length,
                volume: item.volume,
                weight: item.weight,
                width: item.width,
                unitKind: item.unitKind,
                defaultUnitOfMeasureId: item.defaultUnitOfMeasureId,
              })),
            },
          },
          select: { id: true },
        });

        if (source.fiscalData) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, productId: _, ...fiscal } = source.fiscalData;
          await tx.productFiscalData.create({
            data: { ...fiscal, productId: product.id },
          });
        }
        if (source.stRules.length) {
          await tx.productStRule.createMany({
            data: source.stRules.map(
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              ({ id, productId: _, ...rule }) => ({
                ...rule,
                productId: product.id,
              }),
            ),
          });
        }

        const variationIds = new Map<string, string>();
        for (const variation of source.variations) {
          const copy = await tx.productVariation.create({
            data: {
              productId: product.id,
              name: variation.name,
              unitPrice: variation.unitPrice,
              position: variation.position,
            },
            select: { id: true },
          });
          variationIds.set(variation.id, copy.id);
        }

        if (withTiers && source.priceTiers.length) {
          await tx.productPriceTier.createMany({
            data: source.priceTiers.map((tier) => ({
              productId: product.id,
              variationId: tier.variationId
                ? (variationIds.get(tier.variationId) ?? null)
                : null,
              from: tier.from,
              unitPrice: tier.unitPrice,
            })),
          });
        }

        for (const assembly of assemblies) {
          const assemblyId = await this.assemblies.copyAssembly(tx, assembly, {
            companyId,
            productId: product.id,
            variationId: assembly.variationId
              ? (variationIds.get(assembly.variationId) ?? null)
              : null,
          });
          await tx.productAssembly.update({
            where: { id: assemblyId },
            data: { status: 'DRAFT' },
          });
        }
        return product;
      },
      { timeout: 30_000 },
    );
    return this.products.findOne(created.id);
  }

  private async exists(companyId: string, productId: string) {
    const found = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(PRODUCT_NOT_FOUND);
  }

  /** O código da cópia: o do original com "-C", e um número se já existir. */
  private async freeCode(companyId: string, base: string) {
    const taken = new Set(
      (
        await this.prisma.product.findMany({
          where: { companyId, code: { startsWith: `${base}-C` } },
          select: { code: true },
        })
      ).map((product) => product.code),
    );
    if (!taken.has(`${base}-C`)) return `${base}-C`;
    for (let index = 2; ; index++) {
      const code = `${base}-C${index}`;
      if (!taken.has(code)) return code;
    }
  }
}
