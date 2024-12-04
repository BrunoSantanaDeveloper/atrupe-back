import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddItemDto, CreateQuotationDto } from './dto/create-quotation.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterQuotationDto } from './dto/filter.dto';
import { Order, Prisma, Quotation, QuotationStatus } from '@prisma/client';
import { UpdateItemDto, UpdateQuotationDto } from './dto/update-quotation.dto';

import { OrderService } from '../order/order.service';
import {
  DuplicateQuotationDto,
  DuplicateQuotationProductDto,
  DuplicateQuotationProductItemDto,
} from './dto/duplicate-quotation.dto';
import { QuotationContactType } from './entities/quotation.entity';
import { add, endOfDay } from 'date-fns';

export interface QuotationGroup {
  date: string;
  quotations: Quotation[];
}

@Injectable()
export class QuotationService {
  constructor(
    private prisma: PrismaService,
    private orderService: OrderService,
  ) {}
  async create(createQuotationDto: CreateQuotationDto): Promise<Quotation> {
    const {
      description,
      contactType = 'DIRECT', // Valor padrão
      companyId,
      sellerId,
      clientId,
      seriesId,
    } = createQuotationDto;

    try {
      if (!seriesId) {
        throw new BadRequestException(
          `Não é possível criar um orçamento sem uma série`,
        );
      }
      const series = await this.prisma.saleSeries.findUnique({
        where: { id: seriesId },
      });
      if (!series) {
        throw new NotFoundException(`Serie não encontrada`);
      }
      // Criação do orçamento no banco
      const newQuotation = await this.prisma.quotation.create({
        data: {
          description,
          contactType,
          companyId,
          sellerId,
          clientId,
          seriesId: seriesId || undefined,
        },
      });

      await this.prisma.saleSeries.update({
        where: {
          id: seriesId,
        },
        data: {
          currentBudgetNumber: { increment: 1 },
        },
      });

      await this.prisma.deliveryInfo.create({
        data: {
          quotation: {
            connect: {
              id: newQuotation.id,
            },
          },
        },
      });

      await this.prisma.quotationPayment.create({
        data: {
          quotation: {
            connect: { id: newQuotation.id },
          },
          billing: series.billing,
          totalValue: 0,
        },
      });
      return newQuotation;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error; // Propaga o erro caso a série não seja encontrada
      }
      // Adiciona o erro original ao lançar uma exceção com uma mensagem mais detalhada
      throw new BadRequestException(
        `Erro ao criar orçamento: ${error.message}`,
      );
    }
  }

  async addProductToQuotation(quotationId: string, data: AddItemDto) {
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
      include: { items: true }, // Inclui os itens do produto
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    // Verifica se o front enviou propriedades editáveis e realiza validações
    const hasEditableFields =
      data.technicalDescription !== undefined ||
      data.items.some(
        (item) => item.unitCost !== undefined || item.salePrice !== undefined,
      );

    if (
      data.technicalDescription !== undefined &&
      !product.allowEditDescription &&
      data.technicalDescription !== product.technicalDescription
    ) {
      throw new BadRequestException(
        `Descrição técnica não pode ser editada para o produto ${product.name}`,
      );
    }

    if (
      hasEditableFields &&
      !product.allowEditValues &&
      data.items.some((item) => {
        const originalItem = product.items.find(
          (pItem) => pItem.id === item.id,
        );
        if (!originalItem) {
          throw new BadRequestException(
            `Item ${item.id} não encontrado no produto`,
          );
        }
        return (
          (item.unitCost !== undefined &&
            item.unitCost !== originalItem.unitCost) ||
          (item.salePrice !== undefined &&
            item.salePrice !== originalItem.salePrice)
        );
      })
    ) {
      throw new BadRequestException(
        `Valores não podem ser editados para o produto ${product.name}`,
      );
    }

    // Calcula o valor total do produto
    const totalValue = data.items.reduce((total, item) => {
      const originalItem = product.items.find((pItem) => pItem.id === item.id);
      if (!originalItem) {
        throw new BadRequestException(
          `Item ${item.id} não encontrado no produto`,
        );
      }
      return (
        total + item.quantity * (item.salePrice || originalItem.salePrice || 0)
      );
    }, 0);

    // Cria o QuotationProduct com ID único
    const quotationProduct = await this.prisma.quotationProduct.create({
      data: {
        quotationId,
        productId: product.id,
        quantity: data.quantity,
        description: data.description || undefined,
        technicalDescription:
          data.technicalDescription || product.technicalDescription,
        imageUrl: data.imageUrl || product.imageUrl,
        totalValue, // Valor total inicial
        allowEditDescription: product.allowEditDescription,
        allowEditValues: product.allowEditValues,
      },
    });

    // Cria os QuotationProductItems associados ao QuotationProduct
    const quotationProductItems = data.items.map((item) => {
      const originalItem = product.items.find((pItem) => pItem.id === item.id);
      if (!originalItem) {
        throw new BadRequestException(
          `Item ${item.id} não encontrado no produto`,
        );
      }

      return {
        quotationProductId: quotationProduct.id, // ID único do QuotationProduct
        productItemId: originalItem.id,
        quotationId,
        productId: product.id,
        name: originalItem.name,
        unitOfMeasureId: item.unitOfMeasureId,
        width: item.width || originalItem.width,
        height: item.height || originalItem.height,
        length: item.length || originalItem.length,
        weight: item.weight || originalItem.weight,
        volume: item.volume || originalItem.volume,
        distance: item.distance || originalItem.distance,
        duration: item.duration || originalItem.duration,
        unitCost: item.unitCost || originalItem.unitCost,
        salePrice: item.salePrice || originalItem.salePrice,
        quantity: item.quantity,
        totalValue:
          item.quantity * (item.salePrice || originalItem.salePrice || 0),
      };
    });

    await this.prisma.quotationProductItem.createMany({
      data: quotationProductItems,
    });

    // Recalcula o valor total do orçamento
    await this.recalculateQuotationTotalValue(quotationId);

    // Retorna o orçamento atualizado
    return this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: { include: { items: true } },
      },
    });
  }

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

      // Validação: technicalDescription e campos editáveis
      const hasEditableFields =
        data.technicalDescription !== undefined ||
        (data.items?.some(
          (item) => item.unitCost !== undefined || item.salePrice !== undefined,
        ) ??
          false);

      if (
        data.technicalDescription !== undefined &&
        !product.allowEditDescription &&
        data.technicalDescription !== product.technicalDescription
      ) {
        throw new BadRequestException(
          `Descrição técnica não pode ser editada para o produto ${product.product.name}`,
        );
      }

      if (
        hasEditableFields &&
        !product.allowEditValues &&
        (data.items?.some((item) => {
          const originalItem = product.items.find(
            (pItem) => pItem.id === item.id,
          );
          if (!originalItem) {
            throw new BadRequestException(
              `Item ${item.id} não encontrado no produto`,
            );
          }
          return (
            (item.unitCost !== undefined &&
              item.unitCost !== originalItem.unitCost) ||
            (item.salePrice !== undefined &&
              item.salePrice !== originalItem.salePrice)
          );
        }) ??
          false)
      ) {
        throw new BadRequestException(
          `Valores não podem ser editados para o produto ${product.product.name}`,
        );
      }

      // Atualiza o produto dentro do orçamento
      const updatedQuotationProduct = await this.prisma.quotationProduct.update(
        {
          where: { id: productId },
          data: {
            ...(data.description && { description: data.description }),
            ...(data.imageUrl && { imageUrl: data.imageUrl }),
            ...(data.notes && { notes: data.notes }),
            ...(data.discount && { discount: data.discount }),
            ...(data.discountType && { discountType: data.discountType }),
            ...(data.technicalDescription && {
              technicalDescription: data.technicalDescription,
            }),
            ...(data.quantity && {
              quantity: data.quantity,
              totalValue:
                data.quantity *
                product.items.reduce(
                  (acc, item) => acc + (item.salePrice || 0),
                  0,
                ),
            }),
            ...(data.items && {
              items: {
                update: data.items.map((item) => ({
                  where: {
                    id: item.id,
                  },
                  data: {
                    ...(item.unitOfMeasureId && {
                      unitOfMeasureId: item.unitOfMeasureId,
                    }),
                    ...(item.quantity && {
                      quantity: item.quantity,
                      totalValue: item.quantity * item.salePrice,
                    }),
                    ...(item.width && { width: item.width }),
                    ...(item.height && { height: item.height }),
                    ...(item.length && { length: item.length }),
                    ...(item.weight && { weight: item.weight }),
                    ...(item.volume && { volume: item.volume }),
                    ...(item.distance && { distance: item.distance }),
                    ...(item.duration && { duration: item.duration }),
                    ...(item.unitCost && { unitCost: item.unitCost }),
                    ...(item.salePrice && { salePrice: item.salePrice }),
                    ...(item.quantity &&
                      item.salePrice && {
                        totalValue: item.quantity * item.salePrice,
                      }),
                  },
                })),
              },
            }),
          },
        },
      );

      await this.recalculateQuotationTotalValue(product.quotationId);
      return updatedQuotationProduct;
    } catch (error) {
      throw new BadRequestException(
        'Failed to update product in quotation',
        error.message,
      );
    }
  }

  async duplicateProductInQuotation(productId: string): Promise<any> {
    // Busca o QuotationProduct original
    const originalQuotationProduct =
      await this.prisma.quotationProduct.findFirst({
        where: { id: productId },
        include: { quotation: true, items: true }, // Inclui os itens do produto
      });

    if (!originalQuotationProduct) {
      throw new NotFoundException(
        `Produto com ID ${productId} não encontrado no orçamento ${originalQuotationProduct.quotationId}`,
      );
    }

    // Cria um novo registro para o QuotationProduct duplicado
    const duplicatedQuotationProduct =
      await this.prisma.quotationProduct.create({
        data: {
          quotationId: originalQuotationProduct.quotationId,
          productId: originalQuotationProduct.productId,
          quantity: originalQuotationProduct.quantity,
          description: originalQuotationProduct.description,
          technicalDescription: originalQuotationProduct.technicalDescription,
          imageUrl: originalQuotationProduct.imageUrl,
          totalValue: originalQuotationProduct.totalValue,
          allowEditDescription: originalQuotationProduct.allowEditDescription,
          allowEditValues: originalQuotationProduct.allowEditValues,
        },
      });

    // Duplicar os itens do QuotationProduct
    const duplicatedItems = originalQuotationProduct.items.map((item) => ({
      quotationId: item.quotationId,
      productId: item.productId,
      quotationProductId: duplicatedQuotationProduct.id,
      productItemId: item.productItemId,
      name: item.name,
      unitOfMeasureId: item.unitOfMeasureId,
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
      totalValue: item.totalValue,
    }));

    await this.prisma.quotationProductItem.createMany({
      data: duplicatedItems,
    });

    // Atualizar o valor total do orçamento
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
          `Produto ${productId} não encontrado no orçamento ${quotationProduct.quotationId}.`,
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

  private async recalculateQuotationTotalValue(quotationId: string) {
    const quotationProducts = await this.prisma.quotationProduct.findMany({
      where: { quotationId },
      include: {
        items: true,
      },
    });

    const totalValue = quotationProducts.reduce((total, product) => {
      const productTotal = product.items.reduce((itemTotal, item) => {
        return itemTotal + item.quantity * (item.salePrice || 0);
      }, 0);
      return total + productTotal;
    }, 0);
    console.log(totalValue);
    await this.prisma.quotation.update({
      where: { id: quotationId },
      data: { totalValue },
    });
  }
  async findAllQuantity(companyId: string) {
    const allStatuses: QuotationStatus[] = [
      'OPEN',
      'REJECTED',
      'DONE',
      'OVERDUE',
    ];

    const result = await this.prisma.quotation.groupBy({
      by: ['status'],
      where: { companyId, status: { in: allStatuses } },
      _count: true,
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in QuotationStatus]: number },
    );

    result.forEach((cur) => {
      statusCount[cur.status] = cur._count;
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      TOTAL: total,
    };
  }
  async findAll(dto: FilterQuotationDto) {
    try {
      let where: any = {
        status: { not: QuotationStatus.APPROVED },
      };

      if (dto.companyId) {
        where = { ...where, companyId: dto.companyId };
      }

      if (dto.search) {
        where = {
          ...where,
          name: { contains: dto.search, mode: 'insensitive' },
        };
      }

      if (dto.status) {
        where = { ...where, status: dto.status };
      }

      if (dto.sellerId) {
        where = { ...where, sellerId: dto.sellerId };
      }

      if (dto.serieId) {
        where = { ...where, seriesId: dto.serieId };
      }

      if (dto.clientId) {
        where = { ...where, clientId: dto.clientId };
      }

      if (dto.date) {
        const date = add(new Date(dto.date), { days: 1 });
        console.log(date);
        where = {
          ...where,
          createdAt: {
            lte: endOfDay(date),
          },
        };
      }
      const [quotations, total] = await Promise.all([
        this.prisma.quotation.findMany({
          where,
          include: {
            tag: true,
            series: true,
            client: true,
          },
          take: Number(dto.limit),
          skip: (Number(dto.page) - 1) * Number(dto.limit),
          orderBy: {
            createdAt: 'desc',
          },
        }),
        this.prisma.quotation.count({ where }),
      ]);

      const grouped: Record<string, QuotationGroup> = quotations.reduce(
        (acc, quotation) => {
          const date = quotation.createdAt.toISOString().split('T')[0];
          if (!acc[date]) {
            acc[date] = {
              date: date,
              quotations: [],
            };
          }
          acc[date].quotations.push({
            id: quotation.id,
            description: quotation.description,
            status: quotation.status,
            dueDate: quotation.dueDate,
            totalValue: quotation.totalValue,
            tag: quotation.tag
              ? {
                  id: quotation.tag.id,
                  text: quotation.tag.title,
                  color: quotation.tag.color,
                }
              : null,
            quickSale: quotation.quickSale || false, // Adiciona o campo quickSale
            serie: quotation.series
              ? {
                  id: quotation.series.id,
                  name: quotation.series.title,
                  code: quotation.series.code,
                  quotation: quotation.series.currentBudgetNumber,
                }
              : null,
            client: quotation.client
              ? {
                  id: quotation.client.id,
                  name: quotation.client.name,
                  email: quotation.client.email,
                }
              : null,
          });
          return acc;
        },
        {},
      );

      return {
        total,
        data: Object.values(grouped).sort((a, b) =>
          b.date.localeCompare(a.date),
        ),
      };
    } catch (error) {
      console.error('Error fetching quotations:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async count() {
    return this.prisma.quotation.count();
  }

  async findOne(id: string) {
    try {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id },
        include: {
          series: {
            select: {
              id: true,
              title: true,
              code: true,
              currentBudgetNumber: true,
            },
          },
          client: {
            select: {
              id: true,
              type: true,
              name: true,
              status: true,
              cnpj: true,
              cpf: true,
              email: true,
              phone: true,
            },
          },
          seller: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          company: {
            select: {
              id: true,
              name: true,
              cnpj: true,
            },
          },
          deliveryInfo: {
            select: {
              deliveryType: {
                select: {
                  id: true,
                  name: true,
                },
              },
              daysAfterApproval: true, // Prazo após aprovação (dias)
              estimatedDate: true,
              cost: true,
              value: true,
              notes: true,
              supplier: true,
            },
          },
          quotationPayment: {
            select: {
              id: true,
              billing: true,
              discount: true,
              downPayment: true,
              paymentMethod: {
                select: {
                  id: true,
                  name: true, // Forma de pagamento
                },
              },
              paymentCondition: {
                select: {
                  id: true,
                  name: true, // Condição de pagamento
                },
              },
              totalValue: true,
              finalValue: true,
              description: true,
              commission: {
                select: {
                  type: true, // Tipo de comissão: adição ou subtração
                  supplier: {
                    select: {
                      id: true,
                      name: true, // Nome do fornecedor
                    },
                  },
                  transferMethod: true,
                  commissionValue: true,
                  totalCommission: true,
                },
              },
            },
          },
          quotationProduct: {
            select: {
              id: true,
              notes: true,
              imageUrl: true,
              discount: true,
              discountType: true,
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
              productId: true,
              description: true, // Nome do produto
              quantity: true,
              totalValue: true,
              items: {
                select: {
                  id: true,
                  productItemId: true,
                  name: true,
                  unitOfMeasure: true,
                  quantity: true,
                  unitCost: true,
                  totalValue: true,
                },
              },
            },
          },
        },
      });

      return {
        id: quotation.id,
        createdAt: quotation.createdAt,
        updatedAt: quotation.updatedAt,
        dueDate: quotation.dueDate,
        description: quotation.description,
        status: quotation.status,
        totalValue: quotation.totalValue,
        quickSale: quotation.quickSale || false, // Se não for informado, assume-se como 'false'
        serie: quotation.series
          ? {
              id: quotation.series.id,
              name: quotation.series.title,
              code: quotation.series.code,
              quotation: quotation.series.currentBudgetNumber,
            }
          : null,
        seller: quotation.seller
          ? {
              id: quotation.seller.user.id,
              name: quotation.seller.user.name,
            }
          : null,
        company: quotation.company
          ? {
              id: quotation.company.id,
              name: quotation.company.name,
              cnpj: quotation.company.cnpj,
            }
          : null,
        client: quotation.client
          ? {
              id: quotation.client.id,
              type: quotation.client.type,
              name: quotation.client.name,
              status: quotation.client.status,
              cnpj: quotation.client.cnpj,
              cpf: quotation.client.cpf,
              email: quotation.client.email,
              phoneNumber: quotation.client.phone,
            }
          : null,
        deliveryInfo: quotation.deliveryInfo
          ? {
              type: quotation.deliveryInfo.deliveryType
                ? {
                    id: quotation.deliveryInfo.deliveryType.id,
                    name: quotation.deliveryInfo.deliveryType.name,
                  }
                : null,
              timeFrame: quotation.deliveryInfo.daysAfterApproval,
              estimateDate: quotation.deliveryInfo.estimatedDate,
              cost: quotation.deliveryInfo.cost,
              value: quotation.deliveryInfo.value,
              notes: quotation.deliveryInfo.notes,
              supplier: quotation.deliveryInfo.supplier
                ? {
                    id: quotation.deliveryInfo.supplier.id,
                    name: quotation.deliveryInfo.supplier.name,
                  }
                : null,
            }
          : null,
        paymentConditions: quotation.quotationPayment
          ? {
              id: quotation.quotationPayment.id,
              billing: quotation.quotationPayment.billing,
              discount: quotation.quotationPayment.discount,
              downPayment: quotation.quotationPayment.downPayment,
              paymentMethod: quotation.quotationPayment.paymentMethod
                ? {
                    id: quotation.quotationPayment.paymentMethod.id,
                    name: quotation.quotationPayment.paymentMethod.name,
                  }
                : null,
              paymentCondition: quotation.quotationPayment.paymentCondition
                ? {
                    id: quotation.quotationPayment.paymentCondition.id,
                    name: quotation.quotationPayment.paymentCondition.name,
                  }
                : null,
              totalValue: quotation.quotationPayment.totalValue,
              finalValue: quotation.quotationPayment.finalValue,
              description: quotation.quotationPayment.description,
              commission: quotation.quotationPayment.commission
                ? {
                    type: quotation.quotationPayment.commission.type,
                    supplier: {
                      id: quotation.quotationPayment.commission.supplier.id,
                      name: quotation.quotationPayment.commission.supplier.name,
                    },
                    transferMethod:
                      quotation.quotationPayment.commission.transferMethod,
                    commissionValue:
                      quotation.quotationPayment.commission.commissionValue,
                    totalCommission:
                      quotation.quotationPayment.commission.totalCommission,
                  }
                : null,
            }
          : null,
        quotationItems: quotation.quotationProduct.map((qp) => ({
          id: qp.id,
          description: qp.description,
          notes: qp.notes,
          discountType: qp.discountType,
          discount: qp.discount,
          unitValue: qp.items.reduce(
            (total, item) => total + item.quantity * item.unitCost,
            0,
          ),
          finalValue: (() => {
            const unitValue = qp.items.reduce(
              (total, item) => total + item.quantity * item.unitCost,
              0,
            );
            const totalValue = qp.quantity * unitValue;
            if (qp.discountType === 'VALUE') {
              return totalValue - qp.discount;
            } else if (qp.discountType === 'PERCENT') {
              return totalValue - totalValue * (qp.discount / 100);
            } else {
              return totalValue;
            }
          })(),
          image: {
            url: qp.imageUrl,
            original: true, // Marcar como original ou não
          },
          product: {
            originalProductId: qp.productId,
            name: qp.product.name,
            quantity: qp.quantity,
            unitValue: qp.items.reduce(
              (total, item) => total + item.quantity * item.unitCost,
              0,
            ),
            finalValue:
              qp.quantity *
              qp.items.reduce(
                (total, item) => total + item.quantity * item.unitCost,
                0,
              ),
            compositions: qp.items.map((item) => ({
              id: item.id,
              originalCompositionId: item.productItemId,
              name: item.name,
              unitOfMeasure: item.unitOfMeasure,
              quantity: item.quantity,
              unitValue: item.unitCost,
              totalValue: item.quantity * item.unitCost,
            })),
          },
        })),
      };
    } catch (error) {
      console.log(error);
    }
  }

  async duplicate(
    quotationId: string,
    duplicateDto: DuplicateQuotationDto,
  ): Promise<Quotation> {
    // Buscar o orçamento original, incluindo os produtos e itens
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: {
          include: {
            items: true, // Inclui os itens dos produtos
          },
        },
      },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }

    // Criar o DTO para o novo orçamento com as possíveis alterações
    const createDto: CreateQuotationDto = {
      description:
        duplicateDto.description || `${quotation.description} (Cópia)`, // Modifica a descrição, se fornecida
      clientId: duplicateDto.clientId || quotation.clientId, // Mantém o clientId original, a menos que fornecido
      contactType: quotation.contactType as QuotationContactType, // Mantém o contactType original
      totalValue: quotation.totalValue, // Mantém o totalValue original
      sellerId: quotation.sellerId, // Mantém o sellerId original
      seriesId: quotation.seriesId, // Mantém o seriesId original
      companyId: quotation.companyId, // Mantém o companyId original
    };

    // Criar o novo orçamento
    const newQuotation = await this.prisma.quotation.create({
      data: createDto,
    });

    // Criar os produtos e itens duplicados
    for (const product of quotation.quotationProduct) {
      // Criar o produto duplicado
      const productDto: DuplicateQuotationProductDto = {
        description: product.description,
        quantity: product.quantity,
        technicalDescription: product.technicalDescription,
        imageUrl: product.imageUrl,
        totalValue: product.totalValue,
        allowEditDescription: product.allowEditDescription,
        allowEditValues: product.allowEditValues,
        quotationId: newQuotation.id,
        productId: product.productId,
        discount: product.discount,
        discountType: product.discountType,
      };

      const newProduct = await this.prisma.quotationProduct.create({
        data: productDto,
      });

      // Criar os itens do produto duplicado
      for (const item of product.items) {
        const itemDto: DuplicateQuotationProductItemDto = {
          quotationId: newQuotation.id, // Certifique-se de que `quotationId` está disponível no contexto
          productId: newProduct.productId, // Certifique-se de que `productId` está disponível no contexto
          productItemId: item.productItemId, // Use o id do item específico
          quotationProductId: newProduct.id,
          name: item.name,
          quantity: item.quantity,
          unitOfMeasureId: item.unitOfMeasureId,
          width: item.width,
          height: item.height,
          length: item.length,
          weight: item.weight,
          volume: item.volume,
          distance: item.distance,
          duration: item.duration,
          unitCost: item.unitCost,
          salePrice: item.salePrice,
          totalValue: item.totalValue,
        };

        try {
          await this.prisma.quotationProductItem.create({
            data: itemDto,
          });
        } catch (error) {
          console.error(
            'Error creating quotation product item:',
            error.message,
          );
          throw new HttpException(
            'Internal server error',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }
    }

    return newQuotation; // Retorna o novo orçamento criado
  }

  async approve(quotationId: string): Promise<Order> {
    const quotation = await this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.APPROVED,
        approvedAt: new Date(),
      },
    });

    // Criar um pedido com base na cotação aprovada
    return await this.orderService.create({
      quotationId: quotation.id,
    });
  }

  async reject(quotationId: string): Promise<Quotation> {
    return this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.REJECTED,
      },
    });
  }

  async finish(quotationId: string): Promise<Quotation> {
    return this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.DONE,
      },
    });
  }

  async open(quotationId: string): Promise<Quotation> {
    return this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.OPEN,
      },
    });
  }

  async update(id: string, updateQuotationDto: UpdateQuotationDto) {
    const existingQuotation = await this.prisma.quotation.findUnique({
      where: { id },
    });

    if (!existingQuotation) {
      throw new NotFoundException(`Quotation with ID '${id}' not found.`);
    }

    // Realize a atualização com os dados fornecidos
    return this.prisma.quotation.update({
      where: { id },
      data: updateQuotationDto,
    });
  }

  remove(id: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
