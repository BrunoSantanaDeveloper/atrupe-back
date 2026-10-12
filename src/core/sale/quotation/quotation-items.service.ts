import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { Prisma } from '@prisma/client';
import { ProductSaleService } from '../../assembly/product-sale.service';
import { SaleChoicesDto } from '../../assembly/dto/sale.dto';
import { AddItemDto } from './dto/create-quotation.dto';
import { UpdateItemDto } from './dto/update-quotation.dto';
import { calculateFinalValue, DEFAULT_IMAGE_SIZE } from './quotation.utils';

/** O valor do item: o desconto sobre o total e o acréscimo por fora (ALT-25). */
export const itemFinalValue = (
  totalValue: number,
  discount: number | null,
  discountType: string | null,
  addition: number | null | undefined,
) => calculateFinalValue(totalValue, discount, discountType) + (addition || 0);

// As escolhas vêm de classes de DTO: no banco vão como JSON simples
const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type ItemMeasureSource = {
  width?: number | null;
  height?: number | null;
};

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

      const variationId =
        data.variationId !== undefined
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
        data.composition !== undefined ||
        data.variationId !== undefined ||
        (measureChanged && !!(product.composition || product.snapshot));
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
            ...(data.variationId !== undefined && { variationId }),
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

      // Se mudou a quantidade do produto, atualizar quantidade e totalValue dos itens proporcionalmente
      if (data.quantity && !data.items) {
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

      // O acréscimo entra por fora do desconto (ALT-25). Sem acréscimo, o
      // valor fica como as contas acima deixaram
      const addition = data.addition ?? product.addition;
      if (data.addition !== undefined || addition) {
        const current = await this.prisma.quotationProduct.findUnique({
          where: { id: productId },
        });
        if (current) {
          await this.prisma.quotationProduct.update({
            where: { id: productId },
            data: {
              finalValue: itemFinalValue(
                current.totalValue || 0,
                current.discount,
                current.discountType,
                current.addition,
              ),
            },
          });
        }
      }

      // Atualizar o valor total do orçamento sem recalcular os itens
      await this.recalculateQuotationTotalValue(product.quotationId);

      return updatedQuotationProduct;
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
          addition: originalQuotationProduct.addition,
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
    const quotationProducts = await this.prisma.quotationProduct.findMany({
      where: { quotationId },
      include: {
        items: true,
      },
    });

    const totalValue = quotationProducts.reduce((total, product) => {
      return total + product.finalValue;
    }, 0);

    await this.prisma.quotation.update({
      where: { id: quotationId },
      data: { totalValue },
    });

    await this.prisma.quotationPayment.update({
      where: {
        quotationId: quotationId,
      },
      data: { totalValue },
    });
  }
}
