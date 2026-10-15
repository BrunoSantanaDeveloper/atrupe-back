import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  HttpException,
  Optional,
} from '@nestjs/common';
import { ComposedItemService } from './composed-item.service';
import { PrismaService } from 'nestjs-prisma';
import { Prisma } from '@prisma/client';
import { ProductSaleService } from '../../assembly/product-sale.service';
import { SaleChoicesDto } from '../../assembly/dto/sale.dto';
import { AddItemDto } from './dto/create-quotation.dto';
import { UpdateItemDto } from './dto/update-quotation.dto';
import { calculateFinalValue, DEFAULT_IMAGE_SIZE } from './quotation.utils';
import {
  copyItemLines,
  QuotationLinesService,
} from './quotation-lines.service';
import { itemValue, recalculateQuotationTotal } from './quotation-totals';
import {
  AddMaterialItemDto,
  UpdateMaterialItemDto,
} from './dto/material-item.dto';
import { materialItemName } from './item-origin';
import { QUOTATION_PRODUCT_SELECT } from './quotation.includes';
import { transformQuotationItem } from './quotation.transformers';

/**
 * O valor do item: o desconto sobre o total e, por fora, o acréscimo
 * (ALT-25) e as linhas acrescentadas (ORC-5).
 */
export const itemFinalValue = itemValue;

// As escolhas vêm de classes de DTO: no banco vão como JSON simples
const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type ItemMeasureSource = {
  width?: number | null;
  height?: number | null;
};

// O item sem produto (material, montado na hora; Fase 4.4 e 4.5)
export const MATERIAL_ITEM_NOT_OPEN =
  'Só dá para mexer no item com o orçamento em digitação';
export const ITEM_WITHOUT_PRODUCT =
  'Este item não tem produto do cadastro: a variação, a composição e as medidas não mudam por aqui';

/**
 * QuotationItemsService
 * Responsável por gerenciamento de produtos/itens do orçamento.
 */
@Injectable()
export class QuotationItemsService {
  private readonly logger = new Logger(QuotationItemsService.name);

  constructor(
    private prisma: PrismaService,
    private productSale: ProductSaleService,
    private lines: QuotationLinesService,
    // Copia o rascunho do item montado ao duplicar o item (ORC-11)
    @Optional() private composed?: ComposedItemService,
  ) {}

  /**
   * A variação do item (PV-3, PV-6): precisa ser do produto. Na inclusão,
   * o produto com variações exige uma.
   */
  private async variationFor(
    productId: string,
    variationId: string | null | undefined,
    required: boolean,
  ) {
    const variations = await this.prisma.productVariation.findMany({
      where: { productId },
      select: { id: true },
    });
    if (variationId) {
      if (!variations.some((item) => item.id === variationId)) {
        throw new NotFoundException('Variação não encontrada');
      }
      return variationId;
    }
    if (required && variations.length) {
      throw new BadRequestException('Escolha a variação do produto');
    }
    return null;
  }

  /**
   * A composição escolhida e o retrato da venda (ORC-10). Com escolhas, o
   * erro delas volta para a tela; sem escolhas, o produto com composição
   * liberada ganha o retrato com as escolhas padrão, e uma falha aqui não
   * impede a venda.
   */
  private async compositionFor(
    companyId: string,
    productId: string,
    variationId: string | null,
    quantity: number,
    items: ItemMeasureSource[],
    choices: SaleChoicesDto | undefined,
  ) {
    const first = items[0];
    const measure = {
      quantity,
      width: first?.width || undefined,
      height: first?.height || undefined,
    };
    if (choices) {
      return this.productSale.itemComposition(
        companyId,
        productId,
        variationId,
        measure,
        choices,
      );
    }
    const released = await this.prisma.productAssembly.findFirst({
      where: { productId, status: 'RELEASED', blocks: { some: {} } },
      select: { id: true },
    });
    if (!released) return null;
    try {
      return await this.productSale.itemComposition(
        companyId,
        productId,
        variationId,
        measure,
        {},
      );
    } catch (error) {
      this.logger.warn(
        `Retrato da composição do produto ${productId} não calculado: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * O preço do material de venda direta (ORG-1): o da variação, senão o do
   * material. Só material ativo e de venda direta da empresa.
   */
  private async materialSale(
    companyId: string,
    materialId: string,
    variationId: string | null | undefined,
    quantity: number,
  ) {
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, companyId, active: true, directSale: true },
      include: { variations: true },
    });
    if (!material) throw new NotFoundException('Material não encontrado');
    if (material.variations.length && !variationId) {
      throw new BadRequestException('Escolha a variação do material');
    }
    const variation = variationId
      ? material.variations.find((item) => item.id === variationId)
      : null;
    if (variationId && !variation) {
      throw new NotFoundException('Variação não encontrada');
    }
    const unitPrice = variation?.price ?? material.price;
    if (unitPrice === null || unitPrice === undefined) {
      throw new BadRequestException('Este material está sem preço de venda');
    }
    return {
      material,
      variation,
      unitPrice,
      totalValue: Math.round(unitPrice * quantity),
      description: materialItemName(material, variation),
    };
  }

  /** O item como o detalhe do orçamento devolve. */
  private async itemView(itemId: string) {
    const item = await this.prisma.quotationProduct.findUnique({
      where: { id: itemId },
      select: QUOTATION_PRODUCT_SELECT,
    });
    return item ? transformQuotationItem(item) : null;
  }

  /**
   * O material de venda direta como item do orçamento (ORG-1, Fase 4.4): a
   * unidade e o preço do material (ou da variação), sem produto do cadastro.
   * O fiscal sai do material na nota e o relatório o põe no setor dele.
   */
  async addMaterialItem(quotationId: string, dto: AddMaterialItemDto) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, companyId: true, status: true },
    });
    if (!quotation) throw new NotFoundException('Orçamento não encontrado');
    if (quotation.status !== 'OPEN') {
      throw new BadRequestException(MATERIAL_ITEM_NOT_OPEN);
    }
    const sale = await this.materialSale(
      quotation.companyId,
      dto.materialId,
      dto.variationId,
      dto.quantity,
    );
    const item = await this.prisma.quotationProduct.create({
      data: {
        quotationId,
        origin: 'MATERIAL',
        materialId: sale.material.id,
        materialVariationId: sale.variation?.id ?? null,
        unitPrice: sale.unitPrice,
        quantity: dto.quantity,
        description: sale.description,
        totalValue: sale.totalValue,
        finalValue: sale.totalValue,
        // O preço é o do cadastro do material: o desconto fica no item
        allowEditValues: false,
      },
      select: { id: true },
    });
    await this.recalculateQuotationTotalValue(quotationId);
    return this.itemView(item.id);
  }

  /**
   * Muda a quantidade (e a variação) do item de material e refaz o valor
   * pelo preço de hoje. Na O.S. aprovada, só numa conta sem estoque.
   */
  async updateMaterialItem(itemId: string, dto: UpdateMaterialItemDto) {
    const item = await this.prisma.quotationProduct.findUnique({
      where: { id: itemId },
      include: { quotation: { select: { companyId: true, status: true } } },
    });
    if (!item || item.origin !== 'MATERIAL' || !item.materialId) {
      throw new NotFoundException('Item não encontrado');
    }
    const editable =
      item.quotation.status === 'OPEN' ||
      (item.quotation.status === 'APPROVED' &&
        (await this.lines.approvedEditable(item.quotation.companyId)));
    if (!editable) throw new BadRequestException(MATERIAL_ITEM_NOT_OPEN);

    const sale = await this.materialSale(
      item.quotation.companyId,
      item.materialId,
      dto.variationId !== undefined
        ? dto.variationId
        : item.materialVariationId,
      dto.quantity,
    );
    await this.prisma.quotationProduct.update({
      where: { id: itemId },
      data: {
        materialVariationId: sale.variation?.id ?? null,
        unitPrice: sale.unitPrice,
        quantity: dto.quantity,
        description: sale.description,
        totalValue: sale.totalValue,
        finalValue: calculateFinalValue(
          sale.totalValue,
          item.discount,
          item.discountType,
        ),
      },
    });
    // O acréscimo e as linhas entram por fora do desconto (ALT-25, ORC-5)
    if (item.addition || item.linesTotal) {
      await this.lines.refreshItem(itemId);
    }
    await this.recalculateQuotationTotalValue(item.quotationId);
    return this.itemView(itemId);
  }

  /**
   * Returns the quotationId for a given quotation product ID.
   */
  async getQuotationIdByProductId(productId: string): Promise<string | null> {
    const product = await this.prisma.quotationProduct.findUnique({
      where: { id: productId },
      select: { quotationId: true },
    });
    return product?.quotationId || null;
  }

  /**
   * Adiciona um produto ao orçamento
   */
  async addProductToQuotation(quotationId: string, data: AddItemDto) {
    try {
      // Busca o orçamento e verifica se existe
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: quotationId },
      });
      if (!quotation) {
        throw new NotFoundException('Orçamento não encontrado');
      }

      // O produto precisa ser da empresa do orçamento: antes, o de outra
      // empresa entrava, com nome, imagem e itens do catálogo dela
      const product = await this.prisma.product.findFirst({
        where: {
          id: data.productId,
          companyId: {
            in: [quotation.companyId, quotation.subCompanyId].filter(
              (companyId): companyId is string => !!companyId,
            ),
          },
        },
        include: { items: true },
      });
      if (!product) {
        throw new NotFoundException('Produto não encontrado');
      }
      // Produto inativo não entra no orçamento (PAD-7)
      if (!product.isActive) {
        throw new BadRequestException('Produto inativo não entra no orçamento');
      }
      const variationId = await this.variationFor(
        product.id,
        data.variationId,
        true,
      );
      const composed = await this.compositionFor(
        product.companyId ?? quotation.companyId,
        product.id,
        variationId,
        data.quantity,
        data.items,
        data.composition,
      );

      // Usar o valor total calculado do frontend, ou calcular se não fornecido
      const totalValue =
        data.totalValue ||
        data.items.reduce((total, item) => {
          return total + (item.salePrice || 0);
        }, 0);

      // Cria o QuotationProduct com valores do frontend
      const quotationProduct = await this.prisma.quotationProduct.create({
        data: {
          quotationId,
          productId: product.id,
          quantity: data.quantity,
          description: data.description || undefined,
          technicalDescription:
            data.technicalDescription || product.technicalDescription,
          imageUrl: data.imageUrl || product.imageUrl,
          imageSize: data.imageSize || product.imageSize || DEFAULT_IMAGE_SIZE,
          totalValue: data.totalValue || totalValue,
          finalValue: data.finalValue || data.totalValue || totalValue,
          discount: data.discount || 0,
          discountType: data.discountType || 'VALUE',
          notes: data.notes || undefined,
          allowEditDescription: product.allowEditDescription,
          allowEditValues: product.allowEditValues,
          variationId,
          ...(composed
            ? {
                composition: asJson(composed.composition),
                // O retrato tem custo: tabela própria, fora das leituras
                snapshot: { create: { data: asJson(composed.snapshot) } },
              }
            : {}),
        },
      });

      // Cria os QuotationProductItems com valores calculados do frontend
      const quotationProductItems = data.items.map((item) => {
        const originalItem = product.items.find(
          (pItem) => pItem.id === item.id,
        );

        if (!originalItem) {
          throw new BadRequestException(
            `Item ${item.id} não encontrado no produto`,
          );
        }

        return {
          quotationProductId: quotationProduct.id,
          productItemId: originalItem.id,
          quotationId,
          productId: product.id,
          name: originalItem.name,
          unitKind: (item.unitKind || originalItem.unitKind || null) as any,
          width: item.width || 0,
          height: item.height || 0,
          length: item.length || 0,
          weight: item.weight || 0,
          volume: item.volume || 0,
          distance: item.distance || 0,
          duration: item.duration || 0,
          unitCost: item.unitCost || 0,
          salePrice: item.salePrice || 0,
          quantity:
            item.quantity || data.quantity * (item.originalQuantity || 1),
          originalQuantity: item.originalQuantity || item.quantity || 1,
          totalValue: item.totalValue || item.salePrice || 0,
        };
      });

      await this.prisma.quotationProductItem.createMany({
        data: quotationProductItems,
      });

      // Atualizar o valor total do orçamento sem recalcular os itens
      await this.recalculateQuotationTotalValue(quotationId);

      // Retorna o orçamento atualizado
      return this.prisma.quotation.findUnique({
        where: { id: quotationId },
        include: {
          quotationProduct: { include: { items: true } },
        },
      });
    } catch (error) {
      // A validação (4xx) volta para a tela; só a falha inesperada vai ao log
      if (!(error instanceof HttpException)) {
        this.logger.error('Error adding product to quotation:', error.stack);
      }
      throw error;
    }
  }

  /**
   * Atualiza um produto dentro do orçamento
   */
  async updateProductInQuotation(productId: string, data: UpdateItemDto) {
    try {
      const product = await this.prisma.quotationProduct.findUnique({
        where: { id: productId },
        include: {
          quotation: true,
          product: true,
          items: true,
          snapshot: { select: { quotationProductId: true } },
        },
      });

      if (!product) {
        throw new NotFoundException(`Produto não encontrado`);
      }

      // Os itens do corpo precisam ser deste produto do orçamento: antes,
      // o id de um item de outro orçamento (de outra empresa) era alterado
      const ownItemIds = new Set(product.items.map((item) => item.id));
      if (
        (data.items ?? []).some((item) => item.id && !ownItemIds.has(item.id))
      ) {
        throw new NotFoundException('Item não encontrado no produto.');
      }

      // O item sem produto do cadastro (material de venda direta, montado
      // na hora) não tem variação, composição escolhida nem as linhas de
      // medida do produto (Fase 4.4 e 4.5)
      const withoutProduct = !product.productId;
      if (
        withoutProduct &&
        (data.variationId !== undefined ||
          data.composition !== undefined ||
          (data.items ?? []).length > 0)
      ) {
        throw new BadRequestException(ITEM_WITHOUT_PRODUCT);
      }

      // Da aprovação em diante, com estoque, o retrato e as linhas ficam como
      // foram vendidos (ORC-10); sem estoque, a O.S. refaz a conta (PO, 14/10)
      const frozen =
        product.quotation.status === 'APPROVED' &&
        !(await this.lines.approvedEditable(product.quotation.companyId));

      const variationId =
        data.variationId !== undefined && !frozen
          ? await this.variationFor(product.productId, data.variationId, false)
          : product.variationId;

      // A composição escolhida é refeita com a medida nova: a venda ainda
      // não aconteceu (AB-4 vale depois)
      const measureChanged =
        data.quantity !== undefined ||
        (data.items ?? []).some(
          (item) => item.width !== undefined || item.height !== undefined,
        );
      const storedChoices = product.composition as SaleChoicesDto | null;
      const choices = data.composition ?? storedChoices ?? undefined;
      const refresh =
        !frozen &&
        !withoutProduct &&
        (data.composition !== undefined ||
          data.variationId !== undefined ||
          (measureChanged && !!(product.composition || product.snapshot)));
      let composed: Awaited<ReturnType<typeof this.compositionFor>> = null;
      if (refresh) {
        const current = product.items[0];
        const incoming = (data.items ?? []).find(
          (item) => !item.id || item.id === current?.id,
        );
        try {
          composed = await this.compositionFor(
            product.product.companyId ?? product.quotation.companyId,
            product.productId,
            variationId,
            data.quantity ?? product.quantity,
            [
              {
                width: incoming?.width ?? current?.width,
                height: incoming?.height ?? current?.height,
              },
            ],
            choices,
          );
        } catch (error) {
          // Só a escolha enviada agora recusa; a guardada que deixou de
          // valer (a composição mudou) mantém o retrato anterior
          if (data.composition !== undefined) throw error;
          this.logger.warn(
            `Retrato do item ${productId} não refeito: ${error.message}`,
          );
        }
      }

      // Atualiza o produto dentro do orçamento com valores do frontend
      const updatedQuotationProduct = await this.prisma.quotationProduct.update(
        {
          where: { id: productId },
          data: {
            ...(data.description !== undefined && {
              description: data.description,
            }),
            ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
            ...(data.imageSize !== undefined && { imageSize: data.imageSize }),
            ...(data.notes !== undefined && { notes: data.notes }),
            ...(data.discount !== undefined && { discount: data.discount }),
            ...(data.discountType && { discountType: data.discountType }),
            ...(data.technicalDescription !== undefined && {
              technicalDescription: data.technicalDescription,
            }),
            ...(data.quantity && {
              quantity: data.quantity,
            }),
            ...(data.totalValue !== undefined && {
              totalValue: data.totalValue,
            }),
            ...(data.finalValue !== undefined && {
              finalValue: data.finalValue,
            }),
            ...(data.addition !== undefined && { addition: data.addition }),
            ...(data.variationId !== undefined && !frozen && { variationId }),
            ...(composed && {
              composition: asJson(composed.composition),
              snapshot: {
                upsert: {
                  create: { data: asJson(composed.snapshot) },
                  update: {
                    data: asJson(composed.snapshot),
                    computedAt: new Date(),
                  },
                },
              },
            }),
          },
        },
      );

      // Se apenas discount ou discountType foram atualizados (sem itens), recalcular finalValue
      if (
        (data.discount !== undefined || data.discountType !== undefined) &&
        !data.items &&
        !data.quantity
      ) {
        const currentProduct = await this.prisma.quotationProduct.findUnique({
          where: { id: productId },
        });

        if (currentProduct) {
          const currentTotalValue = currentProduct.totalValue || 0;
          const newFinalValue = calculateFinalValue(
            currentTotalValue,
            currentProduct.discount,
            currentProduct.discountType,
          );

          await this.prisma.quotationProduct.update({
            where: { id: productId },
            data: {
              finalValue: newFinalValue,
            },
          });
        }
      }

      // Processar itens: atualizar com valores calculados do frontend
      if (data.items) {
        for (const item of data.items) {
          if (item.id) {
            let calculatedTotalValue = item.totalValue;
            if (item.salePrice !== undefined) {
              calculatedTotalValue = item.salePrice;
            }

            await this.prisma.quotationProductItem.update({
              where: { id: item.id },
              data: {
                ...(item.quantity !== undefined && {
                  quantity: item.quantity,
                }),
                ...(item.originalQuantity !== undefined && {
                  originalQuantity: item.originalQuantity,
                }),
                ...(item.width !== undefined && { width: item.width }),
                ...(item.height !== undefined && { height: item.height }),
                ...(item.length !== undefined && { length: item.length }),
                ...(item.weight !== undefined && { weight: item.weight }),
                ...(item.volume !== undefined && { volume: item.volume }),
                ...(item.distance !== undefined && { distance: item.distance }),
                ...(item.duration !== undefined && { duration: item.duration }),
                ...(item.unitCost !== undefined && { unitCost: item.unitCost }),
                ...(item.salePrice !== undefined && {
                  salePrice: item.salePrice,
                }),
                totalValue:
                  calculatedTotalValue !== undefined
                    ? calculatedTotalValue
                    : item.totalValue,
              },
            });
          } else {
            // Criação de novo item no produto do orçamento
            // Busca o productItem original pelo índice ou cria com dados fornecidos
            const existingItemIds = product.items.map((i) => i.productItemId);
            const originalProductItems = (product as any).product?.items || [];
            // Encontra um item original que ainda não está vinculado
            const availableItem = originalProductItems.find(
              (oi: any) => !existingItemIds.includes(oi.id),
            );

            await this.prisma.quotationProductItem.create({
              data: {
                quotationProductId: productId,
                quotationId: product.quotationId,
                productId: product.productId,
                productItemId:
                  availableItem?.id || product.items[0]?.productItemId,
                name: availableItem?.name || '',
                unitKind: (item.unitKind || null) as any,
                width: item.width || 0,
                height: item.height || 0,
                length: item.length || 0,
                weight: item.weight || 0,
                volume: item.volume || 0,
                distance: item.distance || 0,
                duration: item.duration || 0,
                unitCost: item.unitCost || 0,
                salePrice: item.salePrice || 0,
                quantity: item.quantity || 1,
                originalQuantity: item.originalQuantity || item.quantity || 1,
                totalValue: item.totalValue || item.salePrice || 0,
              },
            });
          }
        }

        // Após atualizar os itens, recalcular totalValue e finalValue do produto
        const updatedItems = await this.prisma.quotationProductItem.findMany({
          where: { quotationProductId: productId },
        });

        const productTotalValue = updatedItems.reduce(
          (acc, item) => acc + (item.totalValue || 0),
          0,
        );

        const productFinalValue = calculateFinalValue(
          productTotalValue,
          product.discount,
          product.discountType,
        );

        await this.prisma.quotationProduct.update({
          where: { id: productId },
          data: {
            totalValue: productTotalValue,
            finalValue: productFinalValue,
          },
        });
      }

      // O item sem produto refaz o valor pela quantidade: o material pelo
      // preço por unidade da venda, o montado pela proporção
      if (data.quantity && withoutProduct) {
        const totalValue = product.unitPrice
          ? Math.round(product.unitPrice * data.quantity)
          : Math.round(
              ((product.totalValue || 0) / (product.quantity || 1)) *
                data.quantity,
            );
        await this.prisma.quotationProduct.update({
          where: { id: productId },
          data: {
            totalValue,
            finalValue: calculateFinalValue(
              totalValue,
              data.discount ?? product.discount,
              data.discountType ?? product.discountType,
            ),
          },
        });
      }

      // Se mudou a quantidade do produto, atualizar quantidade e totalValue dos itens proporcionalmente
      if (data.quantity && !data.items && !withoutProduct) {
        const items = await this.prisma.quotationProductItem.findMany({
          where: {
            quotationProductId: productId,
          },
        });
        for (const item of items) {
          const newQuantity = data.quantity * item.originalQuantity;
          const newTotalValue = item.salePrice * newQuantity;

          await this.prisma.quotationProductItem.update({
            where: { id: item.id },
            data: {
              quantity: newQuantity,
              totalValue: newTotalValue,
            },
          });
        }

        // Recalcular totalValue e finalValue do produto após atualizar os items
        const updatedItems = await this.prisma.quotationProductItem.findMany({
          where: { quotationProductId: productId },
        });

        const productTotalValue = updatedItems.reduce(
          (acc, item) => acc + (item.totalValue || 0),
          0,
        );

        const productFinalValue = calculateFinalValue(
          productTotalValue,
          product.discount,
          product.discountType,
        );

        await this.prisma.quotationProduct.update({
          where: { id: productId },
          data: {
            totalValue: productTotalValue,
            finalValue: productFinalValue,
          },
        });
      }

      // Medida nova: as linhas que acompanham a base são refeitas e as de
      // medida própria ficam (05/10/2026)
      const linesRecalculated =
        measureChanged && !frozen ? await this.lines.recalculate(productId) : 0;

      // O acréscimo e as linhas entram por fora do desconto (ALT-25, ORC-5).
      // Sem eles, o valor fica como as contas acima deixaram
      const addition = data.addition ?? product.addition;
      if (
        data.addition !== undefined ||
        addition ||
        product.linesTotal ||
        linesRecalculated
      ) {
        await this.lines.refreshItem(productId);
      }

      // Atualizar o valor total do orçamento sem recalcular os itens
      await this.recalculateQuotationTotalValue(product.quotationId);

      // As tarefas de produção acompanham a O.S. alterada (ELITE)
      await this.lines.afterItemChange(productId);

      // O retrato com custo nunca volta na resposta (ORC-7)
      return { ...updatedQuotationProduct, linesRecalculated };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Error updating product in quotation:', error.stack);
      throw new BadRequestException(
        'Falha ao atualizar produto no orçamento',
        error.message,
      );
    }
  }

  /**
   * Duplica um produto dentro do orçamento
   */
  async duplicateProductInQuotation(productId: string): Promise<any> {
    const originalQuotationProduct =
      await this.prisma.quotationProduct.findFirst({
        where: { id: productId },
        include: {
          quotation: true,
          items: true,
          snapshot: { select: { data: true } },
        },
      });

    if (!originalQuotationProduct) {
      throw new NotFoundException(
        `Produto com ID ${productId} não encontrado no orçamento`,
      );
    }

    const duplicatedQuotationProduct =
      await this.prisma.quotationProduct.create({
        data: {
          quotationId: originalQuotationProduct.quotationId,
          productId: originalQuotationProduct.productId,
          quantity: originalQuotationProduct.quantity,
          description: originalQuotationProduct.description,
          technicalDescription: originalQuotationProduct.technicalDescription,
          imageUrl: originalQuotationProduct.imageUrl,
          imageSize: originalQuotationProduct.imageSize,
          notes: originalQuotationProduct.notes,
          totalValue: originalQuotationProduct.totalValue,
          finalValue: originalQuotationProduct.finalValue,
          discount: originalQuotationProduct.discount,
          discountType: originalQuotationProduct.discountType,
          allowEditDescription: originalQuotationProduct.allowEditDescription,
          allowEditValues: originalQuotationProduct.allowEditValues,
          origin: originalQuotationProduct.origin,
          variationId: originalQuotationProduct.variationId,
          // O material de venda direta vai junto (ORG-1)
          materialId: originalQuotationProduct.materialId,
          materialVariationId: originalQuotationProduct.materialVariationId,
          // O item montado ganha uma cópia do rascunho (ORC-11)
          draftId:
            originalQuotationProduct.draftId && this.composed
              ? await this.composed.cloneDraft(
                  originalQuotationProduct.draftId,
                  originalQuotationProduct.quotationId,
                )
              : null,
          unitPrice: originalQuotationProduct.unitPrice,
          addition: originalQuotationProduct.addition,
          linesTotal: originalQuotationProduct.linesTotal,
          composition: originalQuotationProduct.composition ?? Prisma.DbNull,
          ...(originalQuotationProduct.snapshot && {
            snapshot: {
              create: {
                data: originalQuotationProduct.snapshot
                  .data as Prisma.InputJsonValue,
              },
            },
          }),
        },
      });

    const duplicatedItems = originalQuotationProduct.items.map((item) => ({
      quotationId: item.quotationId,
      productId: item.productId,
      quotationProductId: duplicatedQuotationProduct.id,
      productItemId: item.productItemId,
      name: item.name,
      unitKind: item.unitKind as any,
      width: item.width,
      height: item.height,
      length: item.length,
      weight: item.weight,
      volume: item.volume,
      distance: item.distance,
      duration: item.duration,
      unitCost: item.unitCost,
      salePrice: item.salePrice,
      quantity: item.quantity,
      originalQuantity: item.originalQuantity,
      totalValue: item.totalValue,
    }));

    await this.prisma.quotationProductItem.createMany({
      data: duplicatedItems,
    });
    // As linhas acrescentadas vão junto, como estavam (ORC-5)
    await copyItemLines(
      this.prisma,
      originalQuotationProduct.id,
      duplicatedQuotationProduct.id,
    );

    await this.recalculateQuotationTotalValue(
      originalQuotationProduct.quotationId,
    );

    return this.prisma.quotation.findUnique({
      where: { id: originalQuotationProduct.quotationId },
      include: {
        quotationProduct: { include: { items: true } },
      },
    });
  }

  /**
   * Remove um produto do orçamento
   */
  async removeProductFromQuotation(productId: string) {
    try {
      const quotationProduct = await this.prisma.quotationProduct.findUnique({
        where: { id: productId },
        include: {
          items: true,
        },
      });

      if (!quotationProduct) {
        throw new NotFoundException(
          `Produto ${productId} não encontrado no orçamento.`,
        );
      }

      const productItemIds = quotationProduct.items?.map((item) => item.id);

      if (productItemIds.length > 0) {
        await this.prisma.quotationProductItem.deleteMany({
          where: {
            id: {
              in: productItemIds,
            },
          },
        });
      }

      await this.prisma.quotationProduct.delete({
        where: { id: productId },
      });

      await this.recalculateQuotationTotalValue(quotationProduct.quotationId);
      return {
        message: 'Produto removido com sucesso do orçamento',
        deletedItems: productItemIds.length,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(
            `Produto no orçamento não encontrado. Talvez ele já tenha sido removido.`,
          );
        }
      }
      throw new BadRequestException(
        'Erro ao remover o produto do orçamento',
        error.message,
      );
    }
  }

  /**
   * Recalcula o valor total de um produto do orçamento
   */
  async recalculateQuotationProductsTotalValue(quotationProductId: string) {
    const quotationProduct = await this.prisma.quotationProduct.findFirst({
      where: { id: quotationProductId },
      include: {
        items: true,
      },
    });

    if (!quotationProduct) return;

    const totalValue = quotationProduct.items.reduce(
      (acc, item) => acc + (item.totalValue || 0),
      0,
    );

    const finalValue = itemFinalValue(
      totalValue,
      quotationProduct.discount,
      quotationProduct.discountType,
      quotationProduct.addition,
      quotationProduct.linesTotal,
    );

    await this.prisma.quotationProduct.update({
      where: { id: quotationProductId },
      data: {
        totalValue,
        finalValue,
      },
    });

    await this.recalculateQuotationTotalValue(quotationProduct.quotationId);
  }

  /**
   * Recalcula o valor total do orçamento
   */
  async recalculateQuotationTotalValue(quotationId: string) {
    await recalculateQuotationTotal(this.prisma, quotationId);
  }
}
