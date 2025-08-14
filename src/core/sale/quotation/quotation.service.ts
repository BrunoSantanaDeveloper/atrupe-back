import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
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
import { add, endOfDay } from 'date-fns';
import { CancelOrderDto } from '../order/dto/create-order.dto';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { DeliveryScheduleService } from '../delivery-schedule/delivery-schedule.service';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';

export interface QuotationGroup {
  date: string;
  quotations: Quotation[];
}

@Injectable()
export class QuotationService {
  constructor(
    private prisma: PrismaService,
    private orderService: OrderService,
    private deliveryScheduleService: DeliveryScheduleService,
  ) {}

  async create(createQuotationDto: CreateQuotationDto): Promise<Quotation> {
    const {
      description,
      contactType,
      companyId,
      sellerId,
      clientId,
      contactId,
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
      const mainCompany = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          principalCompanyId: true,
        },
      });

      // Validação do contactId se informado
      if (contactId && clientId) {
        const contact = await this.prisma.contact.findFirst({
          where: {
            id: contactId,
            clientId: clientId,
          },
        });
        if (!contact) {
          throw new BadRequestException(
            `Contato não encontrado ou não pertence ao cliente informado`,
          );
        }
      }

      // Criação do orçamento no banco
      const newQuotation = await this.prisma.quotation.create({
        data: {
          description,
          contactType,
          dueDate: add(new Date(), { days: series.proposalValidity }),
          companyId: mainCompany.principalCompanyId
            ? mainCompany.principalCompanyId
            : mainCompany.id,
          subCompanyId: mainCompany.id,
          sellerId,
          clientId,
          contactId,
          seriesId: seriesId || undefined,
          quotationNumber: series.currentBudgetNumber + 1,
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
          daysAfterApproval: series.deliveryDeadline,
          estimatedDate: add(new Date(), { days: series.deliveryDeadline }),
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
      console.log(error);
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
        include: { items: true }, // Inclui os itens do produto
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
          unitKind: item.unitKind as any,
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
          totalValue: item.totalValue || item.salePrice || 0, // Usar valor calculado do frontend
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

      // Atualiza o produto dentro do orçamento com valores do frontend
      const updatedQuotationProduct = await this.prisma.quotationProduct.update(
        {
          where: { id: productId },
          data: {
            ...(data.description !== undefined && {
              description: data.description,
            }),
            ...(data.imageUrl && { imageUrl: data.imageUrl }),
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

      // Processar itens: atualizar com valores calculados do frontend
      if (data.items) {
        for (const item of data.items) {
          if (item.id) {
            // Atualizar item existente com valores do frontend
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
                ...(item.totalValue !== undefined && {
                  totalValue: item.totalValue,
                }),
              },
            });
          } else {
            // Criar novo item (quando id é null) - Por enquanto não suportado
            throw new BadRequestException(
              `Criação de novos itens ainda não implementada`,
            );
          }
        }
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
          // Recalcular totalValue baseado na nova quantidade - totalValue é baseado no salePrice
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

        // Calcular o finalValue aplicando desconto
        const productFinalValue =
          product.discountType === 'VALUE'
            ? productTotalValue - (product.discount || 0)
            : product.discountType === 'PERCENT'
              ? productTotalValue -
                productTotalValue * ((product.discount || 0) / 100)
              : productTotalValue;

        // Atualizar o produto com os valores recalculados
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

  async duplicateProductInQuotation(productId: string): Promise<any> {
    // Busca o QuotationProduct original
    const originalQuotationProduct =
      await this.prisma.quotationProduct.findFirst({
        where: { id: productId },
        include: { quotation: true, items: true }, // Inclui os itens do produto
      });

    if (!originalQuotationProduct) {
      throw new NotFoundException(
        `Produto com ID ${productId} não encontrado no orçamento`,
      );
    }

    // Cria um novo registro para o QuotationProduct duplicado com todos os campos
    const duplicatedQuotationProduct =
      await this.prisma.quotationProduct.create({
        data: {
          quotationId: originalQuotationProduct.quotationId,
          productId: originalQuotationProduct.productId,
          quantity: originalQuotationProduct.quantity,
          description: originalQuotationProduct.description,
          technicalDescription: originalQuotationProduct.technicalDescription,
          imageUrl: originalQuotationProduct.imageUrl,
          notes: originalQuotationProduct.notes,
          totalValue: originalQuotationProduct.totalValue,
          finalValue: originalQuotationProduct.finalValue,
          discount: originalQuotationProduct.discount,
          discountType: originalQuotationProduct.discountType,
          allowEditDescription: originalQuotationProduct.allowEditDescription,
          allowEditValues: originalQuotationProduct.allowEditValues,
        },
      });

    // Duplicar os itens do QuotationProduct com todos os valores já calculados
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
      totalValue: item.totalValue, // Usa valor já calculado
    }));

    await this.prisma.quotationProductItem.createMany({
      data: duplicatedItems,
    });

    // Atualizar apenas o valor total do orçamento (sem recalcular os itens)
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
  async test() {
    return await this.recalculateQuotationProductsTotalValue(
      '3299fcd5-8d1b-492c-8d20-29374b4eafbe',
    );
  }
  private async recalculateQuotationProductsTotalValue(quotationId: string) {
    // Obter o produto para recalcular apenas o valor final com desconto
    const quotationProduct = await this.prisma.quotationProduct.findFirst({
      where: { id: quotationId },
      include: {
        items: true,
      },
    });

    if (!quotationProduct) return;

    // Calcular totalValue somando os valores dos itens (já calculados no frontend)
    const totalValue = quotationProduct.items.reduce(
      (acc, item) => acc + (item.totalValue || 0),
      0,
    );

    // Calcular o finalValue aplicando desconto
    const finalValue =
      quotationProduct.discountType === 'VALUE'
        ? totalValue - (quotationProduct.discount || 0)
        : quotationProduct.discountType === 'PERCENT'
          ? totalValue - totalValue * ((quotationProduct.discount || 0) / 100)
          : totalValue;

    // Atualizar o produto com os valores finais
    await this.prisma.quotationProduct.update({
      where: { id: quotationId },
      data: {
        totalValue,
        finalValue,
      },
    });

    await this.recalculateQuotationTotalValue(quotationProduct.quotationId);
  }

  private async recalculateQuotationTotalValue(quotationId: string) {
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
    // const quotationPayment = await this.prisma.quotationPayment.findFirst({
    //   where: {
    //     quotationId: quotationId,
    //   },
    // });
    await this.prisma.quotationPayment.update({
      where: {
        quotationId: quotationId,
      },
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
      let where: Prisma.QuotationWhereInput = {
        status: { not: QuotationStatus.APPROVED },
      };

      if (dto.companyId) {
        where = {
          ...where,
          OR: [
            { companyId: dto.companyId },
            { subCompany: { id: dto.companyId } },
            { subCompany: { principalCompanyId: dto.companyId } },
          ],
        };
      }

      if (dto.search) {
        where = {
          ...where,
          seller: {
            name: {
              contains: dto.search,
              mode: 'insensitive',
            },
          },
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
        where = {
          ...where,
          finishedAt: {
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
            finishedAt: quotation.finishedAt,
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
                  quotation: quotation.quotationNumber,
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
          order: {
            select: {
              id: true,
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
          contact: {
            select: {
              id: true,
              name: true,
            },
          },
          subCompany: {
            select: {
              id: true,
              name: true,
              cnpj: true,
            },
          },
          deliveryInfo: {
            select: {
              id: true,
              deliveryType: true,
              daysAfterApproval: true, // Prazo após aprovação (dias)
              estimatedDate: true,
              cost: true,
              value: true,
              notes: true,
              supplier: true,
              modality: true,
              clientAddressId: true,
              clientAddress: {
                select: {
                  id: true,
                  street: true,
                  number: true,
                  complement: true,
                  neighborhood: true,
                  city: true,
                  state: true,
                  zipcode: true,
                  type: true,
                },
              },
            },
          },
          quotationPayment: {
            select: {
              id: true,
              type: true,
              billing: true,
              discountValue: true,
              discountType: true,
              discountTotal: true,
              downPayment: true,
              downPaymentConditionId: true,
              downPaymentDueDate: true,
              downPaymentAdditionalFee: true,
              installmentQty: true,
              minInstallmentQty: true,
              maxInstallmentQty: true,
              mainAdditionalFee: true,
              additionalFeeType: true,

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
                  commissionType: true,
                },
              },
              quotationInstallment: {
                include: {
                  paymentMethod: true,
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
              technicalDescription: true,
              discountType: true,
              finalValue: true,
              allowEditDescription: true,
              allowEditValues: true,

              product: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
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
                  unitKind: true,
                  salePrice: true,
                  quantity: true,
                  originalQuantity: true,
                  unitCost: true,
                  totalValue: true,
                  weight: true,
                  width: true,
                  height: true,
                  duration: true,
                  length: true,
                  distance: true,
                  volume: true,
                },
                orderBy: {
                  createdAt: 'asc',
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });

      return {
        id: quotation.id,
        orderId: quotation.order?.id ?? null,
        createdAt: quotation.createdAt,
        updatedAt: quotation.updatedAt,
        dueDate: quotation.dueDate,
        finishedAt: quotation.finishedAt,
        description: quotation.description,
        status: quotation.status,
        totalValue: quotation.totalValue,
        contactType: quotation.contactType,
        quickSale: quotation.quickSale || false, // Se não for informado, assume-se como 'false'
        serie: quotation.series
          ? {
              id: quotation.series.id,
              name: quotation.series.title,
              code: quotation.series.code,
              quotation: quotation.quotationNumber,
            }
          : null,
        seller: quotation.seller
          ? {
              id: quotation.seller.id,
              name: quotation.seller.name ?? quotation.seller.user.name,
            }
          : null,
        contact: quotation.contact
          ? {
              id: quotation.contact.id,
              name: quotation.contact.name,
            }
          : null,
        company: quotation.subCompany
          ? {
              id: quotation.subCompany.id,
              name: quotation.subCompany.name,
              cnpj: quotation.subCompany.cnpj,
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
              id: quotation.deliveryInfo.id,
              type: quotation.deliveryInfo.deliveryType,
              timeFrame: quotation.deliveryInfo.daysAfterApproval,
              estimateDate: quotation.deliveryInfo.estimatedDate,
              cost: quotation.deliveryInfo.cost,
              value: quotation.deliveryInfo.value,
              notes: quotation.deliveryInfo.notes,
              modality: quotation.deliveryInfo.modality,
              clientAddressId: quotation.deliveryInfo.clientAddressId,
              clientAddress: quotation.deliveryInfo.clientAddress
                ? {
                    id: quotation.deliveryInfo.clientAddress.id,
                    street: quotation.deliveryInfo.clientAddress.street,
                    number: quotation.deliveryInfo.clientAddress.number,
                    complement: quotation.deliveryInfo.clientAddress.complement,
                    neighborhood:
                      quotation.deliveryInfo.clientAddress.neighborhood,
                    city: quotation.deliveryInfo.clientAddress.city,
                    state: quotation.deliveryInfo.clientAddress.state,
                    zipcode: quotation.deliveryInfo.clientAddress.zipcode,
                    type: quotation.deliveryInfo.clientAddress.type,
                  }
                : null,
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
              type: quotation.quotationPayment.type,
              billing: quotation.quotationPayment.billing,
              discount: {
                discountValue: quotation.quotationPayment.discountValue || 0,
                discountType:
                  quotation.quotationPayment.discountType || 'VALUE',
                discountTotal: quotation.quotationPayment.discountTotal || 0,
              },
              installmentQty: quotation.quotationPayment.installmentQty,
              minInstallmentQty: quotation.quotationPayment.minInstallmentQty,
              maxInstallmentQty: quotation.quotationPayment.maxInstallmentQty,
              mainAdditionalFee: quotation.quotationPayment.mainAdditionalFee,
              additionalFeeType: quotation.quotationPayment.additionalFeeType,
              hasDownPayment: quotation.quotationPayment.downPayment > 0,
              downPayment:
                quotation.quotationPayment.downPayment > 0
                  ? {
                      amount: quotation.quotationPayment.downPayment,
                      dueDate: quotation.quotationPayment.downPaymentDueDate,
                      additionalFee:
                        quotation.quotationPayment.downPaymentAdditionalFee,
                      paymentConditionId:
                        quotation.quotationPayment.downPaymentConditionId,
                    }
                  : null,

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
                    commissionType:
                      quotation.quotationPayment.commission.commissionType,
                    totalCommission:
                      quotation.quotationPayment.commission.commissionType ===
                      'VALUE'
                        ? quotation.quotationPayment.commission.totalCommission
                        : (quotation.quotationPayment.discountType === 'VALUE'
                            ? quotation.totalValue -
                              quotation.quotationPayment.discountValue
                            : quotation.totalValue *
                              (quotation.quotationPayment.discountValue /
                                100)) *
                          (quotation.quotationPayment.commission
                            .commissionValue /
                            100),
                  }
                : null,
              installments:
                quotation.quotationPayment.quotationInstallment.length > 0
                  ? quotation.quotationPayment.quotationInstallment.map(
                      (installment, index) => ({
                        id: installment.id,
                        installmentNumber: index + 1,
                        dueDate: installment.dueDate,
                        paymentMethodId: installment.paymentMethodId,
                        additionalFee: installment.additionalFee,
                        amount: installment.value,
                      }),
                    )
                  : null,
            }
          : null,
        quotationItems: quotation.quotationProduct.map((qp) => ({
          id: qp.id,
          description: qp.description,
          allowEditDescription: qp.allowEditDescription,
          allowEditValues: qp.allowEditValues,
          technicalDescription: qp.technicalDescription,
          notes: qp.notes,
          discountType: qp.discountType,
          discount: qp.discount,
          unitValue: (() => {
            // Usar valores já calculados do banco ao invés de recalcular
            const unitValue = qp.items.reduce((total, item) => {
              return total + (item.unitCost || 0);
            }, 0);
            return unitValue;
          })(),
          totalValue: qp.items.reduce(
            (total, item) => total + item.totalValue,
            0,
          ),
          finalValue: qp.finalValue,
          image: (() => {
            if (qp.imageUrl) {
              return { url: qp.imageUrl, original: false };
            } else {
              return { url: qp.product.imageUrl, original: true };
            }
          })(),
          product: {
            originalProductId: qp.productId,
            name: qp.product.name,
            quantity: qp.quantity,
            unitValue: (() => {
              // Usar valores já calculados do banco ao invés de recalcular
              const unitValue = qp.items.reduce((total, item) => {
                return total + (item.unitCost || 0);
              }, 0);
              return unitValue;
            })(),
            finalValue: qp.items.reduce(
              (total, item) => total + item.totalValue,
              0,
            ),
            compositions: qp.items.map((item) => ({
              id: item.id,
              originalCompositionId: item.productItemId,
              name: item.name,
              unitOfMeasure: item.unitOfMeasure,
              quantity: item.quantity,
              originalQuantity: item.originalQuantity,
              unitValue: item.unitCost || 0, // CORRIGIDO: usar unitCost ao invés de salePrice
              totalValue: item.totalValue,
              weight: item.weight,
              width: item.width,
              height: item.height,
              duration: item.duration,
              length: item.length,
              distance: item.distance,
              volume: item.volume,
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
        deliveryInfo: true,
        quotationPayment: true,
      },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }

    const serie = await this.prisma.saleSeries.findUnique({
      where: { id: quotation.seriesId },
      select: {
        id: true,
        currentBudgetNumber: true,
      },
    });

    // Criar o DTO para o novo orçamento com as possíveis alterações
    const createDto: CreateQuotationDto = {
      description:
        duplicateDto.description || `${quotation.description} (Cópia)`, // Modifica a descrição, se fornecida
      clientId: duplicateDto.clientId || quotation.clientId, // Mantém o clientId original, a menos que fornecido
      contactId: duplicateDto.contactId || quotation.contactId, // Mantém o contactId original, a menos que fornecido
      contactType: quotation.contactType, // Mantém o contactType original
      totalValue: quotation.totalValue, // Mantém o totalValue original
      sellerId: quotation.sellerId, // Mantém o sellerId original
      seriesId: quotation.seriesId, // Mantém o seriesId original
      companyId: quotation.companyId,
      subCompanyId: quotation.subCompanyId,
      quotationNumber: serie.currentBudgetNumber + 1,
    };

    // Criar o novo orçamento
    const newQuotation = await this.prisma.quotation.create({
      data: createDto,
    });

    await this.prisma.saleSeries.update({
      where: {
        id: serie.id,
      },
      data: {
        currentBudgetNumber: { increment: 1 },
      },
    });

    try {
      await this.prisma.deliveryInfo.create({
        data: {
          quotationId: newQuotation.id,
          deliveryType: quotation.deliveryInfo.deliveryType,
          daysAfterApproval: quotation.deliveryInfo.daysAfterApproval,
          estimatedDate: quotation.deliveryInfo.estimatedDate,
          modality: quotation.deliveryInfo.modality,
          supplierId: quotation.deliveryInfo.supplierId,
        },
      });

      const newQuo = await this.prisma.quotationPayment.create({
        data: {
          quotationId: newQuotation.id,
          paymentMethodId: quotation.quotationPayment.paymentMethodId,
          paymentConditionId: quotation.quotationPayment.paymentConditionId,
          totalValue: quotation.quotationPayment.totalValue,
          finalValue: quotation.quotationPayment.finalValue,
        },
      });
      console.log('criação do quotation payment: ' + newQuo);
    } catch (error) {
      console.error(error);
    }
    // Criar os produtos e itens duplicados
    for (const product of quotation.quotationProduct) {
      // Criar o produto duplicado com todos os campos
      const productDto: DuplicateQuotationProductDto = {
        description: product.description,
        quantity: product.quantity,
        technicalDescription: product.technicalDescription,
        imageUrl: product.imageUrl,
        notes: product.notes,
        totalValue: product.totalValue,
        finalValue: product.finalValue,
        discount: product.discount,
        discountType: product.discountType,
        allowEditDescription: product.allowEditDescription,
        allowEditValues: product.allowEditValues,
        quotationId: newQuotation.id,
        productId: product.productId,
      };

      const newProduct = await this.prisma.quotationProduct.create({
        data: productDto,
      });

      // Criar os itens do produto duplicado com valores já calculados
      for (const item of product.items) {
        const itemDto: DuplicateQuotationProductItemDto = {
          quotationId: newQuotation.id,
          productId: newProduct.productId,
          productItemId: item.productItemId,
          quotationProductId: newProduct.id,
          name: item.name,
          quantity: item.quantity,
          originalQuantity: item.originalQuantity, // Incluir originalQuantity
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
          totalValue: item.totalValue, // Usar valor já calculado
        };

        try {
          await this.prisma.quotationProductItem.create({
            data: itemDto as any,
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

    // Recalcular apenas o total do orçamento uma vez no final
    await this.recalculateQuotationTotalValue(newQuotation.id);

    return newQuotation; // Retorna o novo orçamento criado
  }

  async approve(quotationId: string): Promise<Order> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        companyId: true,
      },
    });
    if (!quotation) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }

    const companyId = quotation.companyId;
    let isTrial = false;
    try {
      const companyData = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          trialEndsAt: true,
          Subscription: {
            where: {
              status: 'ACTIVE',
            },
            take: 1, // garante que só pega uma assinatura
            select: {
              plan: {
                select: {
                  planType: true,
                },
              },
            },
          },
        },
      });
      const subscription = companyData.Subscription?.[0];

      if (companyData.trialEndsAt && companyData.trialEndsAt > new Date()) {
        isTrial = true;
      }

      if (subscription?.plan?.planType === 'START') {
        isTrial = true;
      }
    } catch (error) {
      console.error('Error finding company:', error);
    }

    return await this.prisma
      .$transaction(
        async (prisma) => {
          // Atualizar a cotação como aprovada
          const quotation = await prisma.quotation.update({
            where: { id: quotationId },
            data: {
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            },
            include: {
              deliveryInfo: {
                select: {
                  id: true,
                  estimatedDate: true,
                },
              },
              quotationPayment: {
                select: {
                  billing: true,
                },
              },
            },
          });

          if (!quotation.deliveryInfo) {
            throw new Error('Informações de entrega ausentes na cotação.');
          }

          // Verificar se já existe um pedido para esta cotação
          let order = await prisma.order.findUnique({
            where: { quotationId: quotation.id },
          });

          // Se não existir, criar o pedido
          if (!order) {
            order = await prisma.order.create({
              data: {
                quotationId: quotation.id,
              },
            });
          }
          const deliveryStatus = isTrial ? 'DELIVERING' : 'IN_PRODUCTION';
          // Criar o agendamento de entrega diretamente no Prisma
          await prisma.deliverySchedule.create({
            data: {
              company: {
                connect: { id: quotation.companyId },
              },
              quotation: {
                connect: { id: quotation.id },
              },
              order: {
                connect: { id: order.id },
              },
              deliveryInfo: {
                connect: { id: quotation.deliveryInfo.id },
              },
              scheduledDate: quotation.deliveryInfo.estimatedDate
                ? quotation.deliveryInfo.estimatedDate
                : new Date(),
              status: deliveryStatus,
            },
          });

          return order;
        },
        {
          timeout: 15000, // Aumentar timeout para 15 segundos
        },
      )
      .then(async (order) => {
        // Executar faturamento FORA da transação principal se necessário
        const quotationWithPayment = await this.prisma.quotation.findUnique({
          where: { id: quotationId },
          select: {
            quotationPayment: {
              select: {
                billing: true,
              },
            },
          },
        });

        if (quotationWithPayment?.quotationPayment.billing === 'ON_ORDER') {
          await this.deliveryScheduleService.bill(quotationId);
        }

        // Criar etapas de produção FORA da transação principal
        await this.createProductionStages(order.quotationId, isTrial);
        return order;
      })
      .catch((error) => {
        console.error('Error creating order:', error);
        throw error;
      });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createProductionStages(quotationId: string, isTrial: boolean) {
    try {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: quotationId },
        include: {
          quotationProduct: true,
          deliveryInfo: {
            include: {
              deliverySchedule: true,
            },
          },
        },
      });
      if (!quotation) {
        console.error('Orçamento não encontrado.');
        return;
      }

      const quotationProductsIds = quotation.quotationProduct.map(
        (product) => product.productId,
      );

      const products = await this.prisma.product.findMany({
        where: {
          id: {
            in: quotationProductsIds,
          },
          productionStages: {
            not: null,
          },
        },
        select: {
          id: true,
          productionStages: true,
        },
      });

      // Construir as etapas de produção
      const allStages = products.flatMap((product) => {
        // Verificar e converter productionStages em JSON manipulável
        const stages =
          typeof product.productionStages === 'string'
            ? JSON.parse(product.productionStages)
            : product.productionStages;

        // Retornar somente etapas ativas
        return stages.filter((stage: any) => stage.isActive);
      });

      // Remover duplicatas, mantendo a ordem
      const uniqueStages = Array.from(
        new Map(allStages.map((stage) => [stage.id, stage])).values(),
      );

      const productionStages = uniqueStages.map((stage, index) => ({
        stageId: stage.id,
        order: index + 1, // Definir a ordem
        prevStatus: null,
        scheduleId: quotation.deliveryInfo?.deliverySchedule?.id, // Vincular à agenda de entrega
      }));

      if (quotation.deliveryInfo?.deliveryType === 'CARRIER') {
        const systemStage = await this.prisma.companySector.findFirst({
          where: {
            isSystem: true,
            companyId: quotation.companyId,
            name: 'Entrega',
          },
          select: {
            id: true,
            name: true,
            icon: true,
          },
        });
        if (systemStage) {
          //adicionar as etapas fixas no fim do array
          productionStages.push({
            stageId: systemStage.id,
            order: productionStages.length + 1,
            prevStatus: null,
            scheduleId: quotation.deliveryInfo?.deliverySchedule?.id,
          });
        }
      }
      if (quotation.deliveryInfo?.deliveryType === 'PICKUP') {
        const systemStage = await this.prisma.companySector.findFirst({
          where: {
            isSystem: true,
            companyId: quotation.companyId,
            name: 'Cliente Retira',
          },
          select: {
            id: true,
            name: true,
            icon: true,
          },
        });
        if (systemStage) {
          productionStages.push({
            stageId: systemStage.id,
            order: productionStages.length + 1,
            prevStatus: null,
            scheduleId: quotation.deliveryInfo?.deliverySchedule?.id,
          });
        }
      }

      if (productionStages.length > 0) {
        await this.prisma.productionStage.createMany({
          data: productionStages,
        });
        console.log('Etapas de produção criadas com sucesso!');
      }
    } catch (error) {
      console.error('Erro ao criar etapas de produção:', error);
    }
  }

  async reject(quotationId: string, dto: CancelOrderDto): Promise<Quotation> {
    if (!dto.reasonId) {
      return await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.REJECTED,
        },
      });
    }

    try {
      // Verifica se o motivo do cancelamento existe
      const reason = await this.prisma.reasons.findFirst({
        where: { id: dto.reasonId },
      });

      if (!reason) {
        throw new NotFoundException('Motivo de cancelamento não encontrado.');
      }

      // Atualiza o pedido para status cancelado
      return await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.REJECTED,
          reasonId: dto.reasonId,
        },
      });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        throw new BadRequestException(
          'Erro na base de dados ao cancelar a ordem.',
        );
      }
      console.error(error); // Log para depuração
      throw new BadRequestException('Erro interno ao cancelar a ordem.');
    }
  }

  async finish(quotationId: string): Promise<Quotation> {
    //checkout do orçamento
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        seller: {
          select: {
            sellerProfile: {
              select: {
                id: true,
                maxDiscount: true,
                minValue: true,
              },
            },
          },
        },
        quotationPayment: {
          select: {
            billing: true,
            quotationInstallment: true,
          },
        },
      },
    });
    // console.log('quotation: ', quotation);
    // const totalInstallmentsValue =
    //   quotation.quotationPayment.quotationInstallment.reduce(
    //     (sum, installment) => sum + installment.value,
    //     0,
    //   );

    // console.log('total do orçamento: ', quotation.totalValue);
    // console.log('soma das parcelas: ', totalInstallmentsValue);
    // // Verifica se a soma dos valores das parcelas corresponde ao total do orçamento
    // if (totalInstallmentsValue !== quotation.totalValue) {
    //   throw new BadRequestException(
    //     'Houve modificações nos itens do orçamento, verifique as condições de pagamento.',
    //   );
    // }

    if (
      quotation.quotationPayment.quotationInstallment.length === 0 &&
      quotation.quotationPayment.billing !== 'NO_INVOICE'
    ) {
      throw new BadRequestException('O orçamento não possui parcelas.');
    }
    if (!quotation || !quotation.seller || !quotation.seller.sellerProfile) {
      throw new BadRequestException('Informações do vendedor não encontradas.');
    }
    const minValue = quotation.seller.sellerProfile.minValue;
    // const maxDiscount = quotation.seller.sellerProfile.maxDiscount;
    if (quotation.totalValue < minValue) {
      throw new BadRequestException(
        'O valor total do orçamento deve ser maior que o valor mínimo de venda do vendedor.',
      );
    }

    // if (quotation.totalValue > maxDiscount) {
    //   throw new BadRequestException(
    //     'O valor total do orçamento deve ser menor que o valor máximo de desconto.',
    //   );
    // }
    try {
      return this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.DONE,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Erro ao atualizar o status do orçamento.');
    }
  }

  async open(quotationId: string): Promise<Quotation> {
    return this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.OPEN,
        reasonId: null,
        finishedAt: null,
      },
    });
  }

  async update(id: string, updateQuotationDto: UpdateQuotationDto) {
    //TODO: AJUSTAR CASO MUDAR DE EMPRESA NO UPDATE
    try {
      const existingQuotation = await this.prisma.quotation.findUnique({
        where: { id },
      });

      if (!existingQuotation) {
        throw new NotFoundException(`Quotation with ID '${id}' not found.`);
      }

      // Realize a atualização com os dados fornecidos
      return await this.prisma.quotation.update({
        where: { id },
        data: updateQuotationDto,
      });
    } catch (error) {}
  }

  remove(id: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getQuotationPdfData(id: string) {
    try {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id },
        include: {
          company: {
            select: {
              name: true,
              cnpj: true,
              email: true,
              siteUrl: true,
              logoUrl: true,
              textBeforeItems: true,
              textAfterItems: true,
              instagram: true,
              facebook: true,
              linkedin: true,
              address: {
                where: { type: 'Principal' },
                select: {
                  street: true,
                  number: true,
                  complement: true,
                  neighborhood: true,
                  city: true,
                  state: true,
                  zipcode: true,
                },
              },
            },
          },
          order: true,
          client: {
            select: {
              name: true,
              type: true,
              cpf: true,
              cnpj: true,
              phone: true,
              email: true,
              notes: true,
              financialNotes: true,
              address: {
                where: { type: 'Principal' },
                select: {
                  street: true,
                  number: true,
                  complement: true,
                  neighborhood: true,
                  city: true,
                  state: true,
                  zipcode: true,
                },
              },
              contacts: {
                select: {
                  name: true,
                  phone: true,
                  email: true,
                  notes: true,
                },
              },
            },
          },
          seller: {
            select: {
              name: true,
              signatureUrl: true,
            },
          },
          series: {
            select: {
              code: true,
              title: true,
            },
          },
          quotationProduct: {
            include: {
              product: {
                select: {
                  name: true,
                  imageUrl: true,
                  technicalDescription: true,
                },
              },
              items: {
                include: {
                  productItem: {
                    select: {
                      name: true,
                    },
                  },
                  unitOfMeasure: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
          deliveryInfo: {
            include: {
              supplier: {
                select: {
                  name: true,
                  cnpj: true,
                  notes: true,
                  financialNotes: true,
                },
              },
            },
          },
          quotationPayment: {
            select: {
              id: true,
              type: true,
              billing: true,
              totalValue: true,
              finalValue: true,
              description: true,
              paymentCondition: {
                select: {
                  name: true,
                },
              },
              paymentMethod: {
                select: {
                  name: true,
                },
              },
              quotationInstallment: {
                include: {
                  paymentMethod: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!quotation) {
        throw new NotFoundException('Quotation not found');
      }

      // Format the data according to the PDF structure
      const pdfData = {
        company: {
          name: quotation.company.name,
          cnpj: quotation.company.cnpj,
          email: quotation.company.email,
          siteUrl: quotation.company.siteUrl,
          address: quotation.company.address[0]
            ? {
                street: quotation.company.address[0].street,
                number: quotation.company.address[0].number,
                complement: quotation.company.address[0].complement,
                neighborhood: quotation.company.address[0].neighborhood,
                city: quotation.company.address[0].city,
                state: quotation.company.address[0].state,
                zipCode: quotation.company.address[0].zipcode,
              }
            : null,
          logo: quotation.company.logoUrl,
          textBeforeItems: quotation.company.textBeforeItems,
          textAfterItems: quotation.company.textAfterItems,
          socialNetworks: {
            instagram: quotation.company.instagram,
            facebook: quotation.company.facebook,
            linkedin: quotation.company.linkedin,
          },
        },
        client: {
          name: quotation.client?.name,
          document: {
            type: quotation.client?.type === 'PERSON' ? 'CPF' : 'CNPJ',
            value:
              quotation.client?.type === 'PERSON'
                ? quotation.client?.cpf
                : quotation.client?.cnpj,
          },
          phone: quotation.client?.phone,
          email: quotation.client?.email,
          notes: quotation.client?.notes,
          financialNotes: quotation.client?.financialNotes,
          address: quotation.client?.address[0]
            ? {
                type: 'PRINCIPAL',
                street: quotation.client.address[0].street,
                number: quotation.client.address[0].number,
                complement: quotation.client.address[0].complement,
                neighborhood: quotation.client.address[0].neighborhood,
                city: quotation.client.address[0].city,
                state: quotation.client.address[0].state,
                zipCode: quotation.client.address[0].zipcode,
              }
            : null,
        },
        contact: quotation.client?.contacts[0]
          ? {
              name: quotation.client.contacts[0].name,
              phone: quotation.client.contacts[0].phone,
              email: quotation.client.contacts[0].email,
              notes: quotation.client.contacts[0].notes,
            }
          : null,
        quotation: {
          number: quotation.quotationNumber,
          seriesCode: quotation.series?.code,
          description: quotation.description,
          seller: {
            name: quotation.seller.name,
            signature: quotation.seller.signatureUrl,
          },
          createdAt: quotation.createdAt,
          dueDate: quotation.dueDate ? quotation.dueDate : null,
          approvedAt: quotation.approvedAt ? quotation.approvedAt : null,
          finishedAt: quotation.finishedAt ? quotation.finishedAt : null,
          status: quotation.status,
        },
        order: quotation.order
          ? {
              id: quotation.order?.id,
              createdAt: quotation.order?.createdAt,
              status: quotation.order?.status,
              approvedAt: quotation.approvedAt ? quotation.approvedAt : null,
            }
          : null,
        quotationItems: quotation.quotationProduct.map((qp) => ({
          id: qp.id,
          description: qp.description,
          allowEditDescription: qp.allowEditDescription,
          allowEditValues: qp.allowEditValues,
          technicalDescription: qp.technicalDescription,
          notes: qp.notes,
          discountType: qp.discountType,
          discount: qp.discount,
          unitValue: (() => {
            const unitValue = qp.items.reduce((total, item) => {
              return total + (item.unitCost || 0);
            }, 0);
            return unitValue;
          })(),
          totalValue: qp.items.reduce(
            (total, item) => total + item.totalValue,
            0,
          ),
          finalValue: qp.finalValue,
          image: (() => {
            if (qp.imageUrl) {
              return { url: qp.imageUrl, original: false };
            } else {
              return { url: qp.product.imageUrl, original: true };
            }
          })(),
          product: {
            originalProductId: qp.productId,
            name: qp.product.name,
            quantity: qp.quantity,
            unitValue: (() => {
              const unitValue = qp.items.reduce((total, item) => {
                return total + (item.unitCost || 0);
              }, 0);
              return unitValue;
            })(),
            finalValue: qp.items.reduce(
              (total, item) => total + item.totalValue,
              0,
            ),
            compositions: qp.items.map((item) => ({
              id: item.id,
              originalCompositionId: item.productItemId,
              name: item.name,
              unitOfMeasure: item.unitOfMeasure,
              quantity: item.quantity,
              originalQuantity: item.originalQuantity,
              unitValue: item.unitCost || 0,
              totalValue: item.totalValue,
              weight: item.weight,
              width: item.width,
              height: item.height,
              duration: item.duration,
              length: item.length,
              distance: item.distance,
              volume: item.volume,
            })),
          },
        })),
        delivery: quotation.deliveryInfo
          ? {
              supplier: quotation.deliveryInfo.supplier
                ? {
                    name: quotation.deliveryInfo.supplier.name,
                    cnpj: quotation.deliveryInfo.supplier.cnpj,
                    notes: quotation.deliveryInfo.supplier.notes,
                    financialNotes:
                      quotation.deliveryInfo.supplier.financialNotes,
                  }
                : null,
              daysAfterApproval: quotation.deliveryInfo.daysAfterApproval,
              freightCost: quotation.deliveryInfo.cost,
              freightPrice: quotation.deliveryInfo.value,
              notes: quotation.deliveryInfo.notes,
              clientAddress: quotation.client?.address[0]
                ? {
                    type: 'PRINCIPAL',
                    street: quotation.client.address[0].street,
                    number: quotation.client.address[0].number,
                    complement: quotation.client.address[0].complement,
                    neighborhood: quotation.client.address[0].neighborhood,
                    city: quotation.client.address[0].city,
                    state: quotation.client.address[0].state,
                    zipCode: quotation.client.address[0].zipcode,
                  }
                : null,
            }
          : null,
        payment: quotation.quotationPayment
          ? {
              condition: quotation.quotationPayment.paymentCondition?.name,
              method: quotation.quotationPayment.paymentMethod?.name,
              description: quotation.quotationPayment.description,
              totalInstallments:
                quotation.quotationPayment.quotationInstallment?.length || 0,
              installments: quotation.quotationPayment.quotationInstallment.map(
                (installment) => ({
                  number: installment.id,
                  dueDate: installment.dueDate,
                  value: installment.value,
                  paymentMethod: installment.paymentMethod?.name,
                }),
              ),
              availablePaymentMethods: await this.getAvailablePaymentMethods(
                quotation.companyId,
                quotation.clientId,
              ),
            }
          : null,
        total: {
          subtotal: quotation.totalValue,
          totalDiscount:
            quotation.totalValue -
            (quotation.quotationPayment?.finalValue || quotation.totalValue),
          finalTotal:
            quotation.quotationPayment?.finalValue || quotation.totalValue,
        },
      };

      return pdfData;
    } catch (error) {
      console.error('Error generating quotation PDF data:', error);
      throw new InternalServerErrorException(
        'Failed to generate quotation PDF data',
      );
    }
  }

  private async getAvailablePaymentMethods(
    companyId: string,
    clientId?: string,
  ): Promise<string[]> {
    try {
      // Buscar métodos de pagamento ativos da empresa para recebíveis
      const paymentMethods = await this.prisma.paymentMethod.findMany({
        where: {
          companyId,
          isActive: true,
          bankAccountCashControl: {
            some: {
              acceptIncomes: true,
              bankAccount: {
                isActive: true,
              },
            },
          },
        },
        include: {
          paymentCondition: {
            where: {
              companyId,
              isActive: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });

      if (!paymentMethods.length) {
        return [];
      }

      // Se temos cliente específico, filtrar por suas condições de pagamento
      if (clientId) {
        const client = await this.prisma.client.findUnique({
          where: { id: clientId },
          select: {
            type: true,
            status: true,
            maxValue: true,
            minValue: true,
            paymentConditions: {
              where: { isActive: true },
              include: {
                paymentCondition: {
                  include: {
                    paymentMethod: true,
                  },
                },
              },
            },
          },
        });

        if (!client) {
          return [];
        }

        // 1. Verificar se cliente tem condições específicas configuradas
        if (client.paymentConditions.length > 0) {
          // Cliente tem condições específicas no seu cadastro
          const clientPaymentMethods = new Map<
            string,
            { name: string; conditions: string[] }
          >();

          client.paymentConditions.forEach((cpc) => {
            // Verificar se a condição está ativa
            if (cpc.isActive) {
              const method = cpc.paymentCondition.paymentMethod;
              if (!clientPaymentMethods.has(method.id)) {
                clientPaymentMethods.set(method.id, {
                  name: method.name,
                  conditions: [],
                });
              }
              clientPaymentMethods
                .get(method.id)
                .conditions.push(cpc.paymentCondition.name);
            }
          });

          return Array.from(clientPaymentMethods.values()).map((method) => {
            const maxInstallments = method.conditions
              .map((condName) => {
                const match = condName.match(/(\d+)x/i);
                return match ? parseInt(match[1]) : 1;
              })
              .reduce((max, current) => Math.max(max, current), 1);

            if (maxInstallments > 1) {
              return `${method.name} até ${maxInstallments}x`;
            }
            return method.name;
          });
        }

        // Se cliente não tem condições específicas, retorna array vazio
        return [];
      }

      // Se não tem cliente específico, retorna array vazio
      return [];
    } catch (error) {
      console.error('Error getting available payment methods:', error);
      return [];
    }
  }

  async deleteImportedQuotations(
    companyId: string,
  ): Promise<{ success: boolean; message: string; deleted: number }> {
    try {
      // Find all quotations for the company
      const quotations = await this.prisma.quotation.findMany({
        where: { companyId },
        select: { id: true },
      });

      const quotationIds = quotations.map((q) => q.id);
      let deletedCount = 0;

      // Delete in a transaction to ensure data consistency
      await this.prisma.$transaction(async (prisma) => {
        // Delete quotation product items
        await prisma.quotationProductItem.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete quotation products
        await prisma.quotationProduct.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete quotation installments
        await prisma.quotationInstallment.deleteMany({
          where: {
            quotationPayment: {
              quotationId: {
                in: quotationIds,
              },
            },
          },
        });

        // Delete quotation payments
        await prisma.quotationPayment.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete delivery info
        await prisma.deliveryInfo.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete delivery schedules
        await prisma.deliverySchedule.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete production stages
        await prisma.productionStage.deleteMany({
          where: {
            schedule: {
              quotationId: {
                in: quotationIds,
              },
            },
          },
        });

        // Delete orders
        await prisma.order.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Finally, delete the quotations
        const result = await prisma.quotation.deleteMany({
          where: {
            id: {
              in: quotationIds,
            },
          },
        });

        deletedCount = result.count;
      });

      return {
        success: true,
        message: `Successfully deleted ${deletedCount} quotations and all related entities`,
        deleted: deletedCount,
      };
    } catch (error) {
      console.error('Error deleting imported quotations:', error);
      throw new BadRequestException(
        `Failed to delete imported quotations: ${error.message}`,
      );
    }
  }
  async importQuotationsFromCsv(
    filePath: string,
    companyId: string,
  ): Promise<{ success: boolean; message: string; imported: number }> {
    try {
      // Find the admin seller
      const adminSeller = await this.prisma.employee.findFirst({
        where: {
          companyId,
          role: {
            name: 'Admin',
          },
        },
      });

      if (!adminSeller) {
        throw new BadRequestException('Admin seller not found for the company');
      }

      // Get all payment methods for the company
      const paymentMethods = await this.prisma.paymentMethod.findMany({
        where: { companyId },
        take: 1,
      });

      if (paymentMethods.length === 0) {
        throw new BadRequestException(
          'No payment methods found for the company',
        );
      }

      const defaultPaymentMethod = paymentMethods[0];

      // Get all unit measures for the company
      // const unitMeasures = await this.prisma.defaultUnitOfMeasure.findMany({
      //   where: { isActive: true },
      // });

      // Map for unit measures
      const unitMeasureMap = {
        M2: 'M²',
        M: 'MT',
        LT: 'LT',
        UN: 'UN',
        KG: 'KG',
        KM: 'KM',
        HH: 'HH',
      };

      // Map for delivery types
      const deliveryTypeMap = {
        '1': 'PICKUP',
        '2': 'INSTALLATION',
        '3': 'CARRIER',
        '4': 'CARRIER',
      };

      // Map for quotation status
      const statusMap = {
        Digitação: 'OPEN',
        Fechado: 'DONE',
        Finalizado: 'DONE',
        Entrega: 'APPROVED',
      };

      let importedCount = 0;
      const quotationsToApprove: string[] = [];

      // Read and process the CSV file
      const rows: any[] = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(fastCsv.parse({ headers: true }))
          .on('data', (row) => rows.push(row))
          .on('end', resolve)
          .on('error', reject);
      });

      // Process each row
      for (const row of rows) {
        try {
          const series = await this.prisma.saleSeries.findFirst({
            where: {
              code: row.venda_serie,
              companyId,
            },
          });

          if (!series) {
            console.warn(`Series not found for code: ${row.venda_serie}`);
            continue;
          }

          let clientId = null;
          if (row.cliente_nome) {
            const client = await this.prisma.client.findFirst({
              where: {
                name: row.cliente_nome,
                companyId,
              },
            });
            if (client) {
              clientId = client.id;
            }
          }

          const createdAt = new Date(row.cadastro_dt);
          const dueDate = series.proposalValidity
            ? add(createdAt, { days: series.proposalValidity })
            : add(createdAt, { days: 7 });

          let status = 'OPEN';
          if (row.confsubstatus_descr) {
            status = statusMap[row.confsubstatus_descr] || 'CANCELED';
          }

          const quotation = await this.prisma.quotation.create({
            data: {
              companyId,
              sellerId: adminSeller.id,
              clientId,
              seriesId: series.id,
              quotationNumber: parseInt(row.venda_numero),
              description: row.referencia || '',
              status: status as QuotationStatus,
              dueDate,
              totalValue: parseFloat(row.venda_valor_total) * 100 || 0,
              finishedAt:
                row.venda_data_fechamento &&
                row.venda_data_fechamento !== '0000-00-00 00:00:00'
                  ? new Date(row.venda_data_fechamento)
                  : null,
              approvedAt:
                row.venda_data_aprovacao &&
                row.venda_data_aprovacao !== '0000-00-00 00:00:00'
                  ? new Date(row.venda_data_aprovacao)
                  : null,
              createdAt: createdAt,
            },
          });

          const deliveryType = deliveryTypeMap[row.fkidtipoentrega] || 'PICKUP';
          const daysAfterApproval = parseInt(row.dias_apos_aprovacao) || 0;

          let estimatedDate = null;
          if (row.entrega_prazo && row.entrega_prazo !== '0000-00-00') {
            estimatedDate = new Date(row.entrega_prazo);
          } else if (daysAfterApproval > 0) {
            estimatedDate = add(createdAt, { days: daysAfterApproval });
          }

          await this.prisma.deliveryInfo.create({
            data: {
              quotationId: quotation.id,
              deliveryType: deliveryType as any,
              daysAfterApproval,
              estimatedDate,
              cost: parseFloat(row.entrega_custo) * 100 || 0,
              value: parseFloat(row.entrega_valor) * 100 || 0,
            },
          });

          const quotationPayment = await this.prisma.quotationPayment.create({
            data: {
              quotationId: quotation.id,
              billing: series.billing,
              totalValue: parseFloat(row.venda_valor_final) * 100 || 0,
              finalValue:
                (parseFloat(row.venda_valor_final) -
                  parseFloat(row.venda_valor_desconto)) *
                  100 || 0,
              discountType: 'VALUE',
              discountValue: parseFloat(row.venda_valor_desconto) * 100 || 0,
              discountTotal: parseFloat(row.venda_valor_desconto) * 100 || 0,
              installmentQty: 1,
              minInstallmentQty: 1,
              maxInstallmentQty: 1,
            },
          });

          await this.prisma.quotationInstallment.create({
            data: {
              quotationPaymentId: quotationPayment.id,
              paymentMethodId: defaultPaymentMethod.id,
              dueDate: quotation.dueDate,
              value:
                (parseFloat(row.venda_valor_final) -
                  parseFloat(row.venda_valor_desconto)) *
                  100 || 0,
            },
          });

          if (row.vendaitem_referencia) {
            const product = await this.prisma.product.findFirst({
              where: {
                name: row.vendaitem_referencia,
                companyId,
              },
              include: {
                items: true,
              },
            });

            if (product) {
              const quotationProduct =
                await this.prisma.quotationProduct.create({
                  data: {
                    quotationId: quotation.id,
                    productId: product.id,
                    description: row.vendaitem_referencia,
                    totalValue: parseFloat(row.vendaitem_valor_item) * 100 || 0,
                    discount:
                      parseFloat(row.vendaitem_valor_desconto) * 100 || 0,
                    discountType: 'VALUE',
                    finalValue:
                      parseFloat(row.vendaitem_valor_final) * 100 || 0,
                    quantity: parseInt(row.vendaitem_quantidade) || 1,
                  },
                });

              // TODO: Verificar possibilidade de csv ter o tipo direto em vez do código
              // Mapear código da unidade para UnitKind
              const unitMeasureCode =
                unitMeasureMap[row.vendaitem_un_com] || row.vendaitem_un_com;

              let unitKind = null;
              switch (unitMeasureCode) {
                case 'M²':
                  unitKind = 'AREA';
                  break;
                case 'MT':
                case 'CM':
                case 'MM':
                  unitKind = 'LENGTH';
                  break;
                case 'UN':
                  unitKind = 'UNITY';
                  break;
                case 'KG':
                case 'GR':
                case 'MG':
                  unitKind = 'WEIGHT';
                  break;
                case 'KM':
                  unitKind = 'DISTANCE';
                  break;
                case 'HH':
                  unitKind = 'DURATION';
                  break;
                case 'LT':
                case 'ML':
                  unitKind = 'CAPACITY';
                  break;
              }

              if (unitKind) {
                await this.prisma.quotationProductItem.create({
                  data: {
                    quotationId: quotation.id,
                    productId: product.id,
                    quotationProductId: quotationProduct.id,
                    productItemId: product.items[0]?.id || null,
                    name: row.vendaitem_referencia,
                    quantity: parseInt(row.vendaitem_quantidade) || 1,
                    originalQuantity: parseInt(row.vendaitem_quantidade) || 1,
                    unitKind: unitKind as any,
                    width: parseFloat(row.vendaitem_dim_largura) || null,
                    length: parseFloat(row.vendaitem_dim_comprimento) || null,
                    unitCost: parseFloat(row.vendaitem_custo_total) * 100 || 0,
                    salePrice: parseFloat(row.vendaitem_valor_item) * 100 || 0,
                    totalValue:
                      parseFloat(row.vendaitem_valor_total) * 100 || 0,
                  },
                });
              }
            }
          }

          if (row.confstatus_descr === 'Ordem de Serviço') {
            quotationsToApprove.push(quotation.id);
          }

          importedCount++;
        } catch (error) {
          console.error(`Error processing row: ${JSON.stringify(row)}`, error);
        }
      }

      for (const quotationId of quotationsToApprove) {
        try {
          await this.approve(quotationId);
        } catch (error) {
          console.error(`Error approving quotation ${quotationId}:`, error);
        }
      }

      return {
        success: true,
        message: `Successfully imported ${importedCount} quotations`,
        imported: importedCount,
      };
    } catch (error) {
      console.error('Error importing quotations from CSV:', error);
      throw new BadRequestException(
        `Failed to import quotations: ${error.message}`,
      );
    }
  }
}
