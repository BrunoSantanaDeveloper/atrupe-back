import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { Prisma } from '@prisma/client';
import { AddItemDto } from './dto/create-quotation.dto';
import { UpdateItemDto } from './dto/update-quotation.dto';

/**
 * QuotationItemsService
 * Responsável por gerenciamento de produtos/itens do orçamento.
 */
@Injectable()
export class QuotationItemsService {
  constructor(private prisma: PrismaService) {}

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

      // Busca o produto e verifica se ele existe
      const product = await this.prisma.product.findUnique({
        where: { id: data.productId },
        include: { items: true },
      });
      if (!product) {
        throw new NotFoundException('Produto não encontrado');
      }

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
          imageSize: data.imageSize || 'small',
          totalValue: data.totalValue || totalValue,
          finalValue: data.finalValue || data.totalValue || totalValue,
          discount: data.discount || 0,
          discountType: data.discountType || 'VALUE',
          notes: data.notes || undefined,
          allowEditDescription: product.allowEditDescription,
          allowEditValues: product.allowEditValues,
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
      console.error(error);
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
        },
      });

      if (!product) {
        throw new NotFoundException(`Produto não encontrado`);
      }

      // Capturar valores originais para o histórico
      // const originalValues = {
      //   productName:
      //     data.description || product.description || product.product.name,
      //   totalValue: product.totalValue,
      //   finalValue: product.finalValue,
      //   discount: product.discount,
      //   discountType: product.discountType,
      //   quantity: product.quantity,
      //   items: product.items.map((item) => ({
      //     id: item.id,
      //     name: item.name,
      //     quantity: item.quantity,
      //     unitCost: item.unitCost,
      //     totalValue: item.totalValue,
      //   })),
      // };

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
            ...(data.technicalDescription && {
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
          let newFinalValue = currentTotalValue;

          if (currentProduct.discountType === 'VALUE') {
            newFinalValue = currentTotalValue - (currentProduct.discount || 0);
          } else if (currentProduct.discountType === 'PERCENT') {
            newFinalValue =
              currentTotalValue -
              currentTotalValue * ((currentProduct.discount || 0) / 100);
          }

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
            throw new BadRequestException(
              `Criação de novos itens ainda não implementada`,
            );
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

        const productFinalValue =
          product.discountType === 'VALUE'
            ? productTotalValue - (product.discount || 0)
            : product.discountType === 'PERCENT'
              ? productTotalValue -
                productTotalValue * ((product.discount || 0) / 100)
              : productTotalValue;

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

        const productFinalValue =
          product.discountType === 'VALUE'
            ? productTotalValue - (product.discount || 0)
            : product.discountType === 'PERCENT'
              ? productTotalValue -
                productTotalValue * ((product.discount || 0) / 100)
              : productTotalValue;

        await this.prisma.quotationProduct.update({
          where: { id: productId },
          data: {
            totalValue: productTotalValue,
            finalValue: productFinalValue,
          },
        });
      }

      // Atualizar o valor total do orçamento sem recalcular os itens
      await this.recalculateQuotationTotalValue(product.quotationId);

      return updatedQuotationProduct;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        'Failed to update product in quotation',
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
        include: { quotation: true, items: true },
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
   * Recalcula o valor total dos produtos de um orçamento
   */
  async recalculateQuotationProductsTotalValue(quotationId: string) {
    const quotationProduct = await this.prisma.quotationProduct.findFirst({
      where: { id: quotationId },
      include: {
        items: true,
      },
    });

    if (!quotationProduct) return;

    const totalValue = quotationProduct.items.reduce(
      (acc, item) => acc + (item.totalValue || 0),
      0,
    );

    const finalValue =
      quotationProduct.discountType === 'VALUE'
        ? totalValue - (quotationProduct.discount || 0)
        : quotationProduct.discountType === 'PERCENT'
          ? totalValue - totalValue * ((quotationProduct.discount || 0) / 100)
          : totalValue;

    await this.prisma.quotationProduct.update({
      where: { id: quotationId },
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
