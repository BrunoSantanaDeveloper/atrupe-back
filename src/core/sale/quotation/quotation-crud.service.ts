import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { Prisma, Quotation, QuotationStatus } from '@prisma/client';
import { add, endOfDay } from 'date-fns';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import {
  DuplicateQuotationDto,
  DuplicateQuotationProductDto,
  DuplicateQuotationProductItemDto,
} from './dto/duplicate-quotation.dto';
import { FilterQuotationDto } from './dto/filter.dto';

/**
 * QuotationCrudService
 * Responsável por operações CRUD básicas do orçamento.
 */
@Injectable()
export class QuotationCrudService {
  private readonly logger = new Logger(QuotationCrudService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Método auxiliar para buscar userId a partir de employeeId
   */
  async getUserIdFromEmployee(
    employeeId: string,
  ): Promise<{ userId: string; userName: string } | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        userId: true,
        name: true,
        user: { select: { name: true } },
      },
    });

    if (!employee?.userId) {
      return null;
    }

    return {
      userId: employee.userId,
      userName: employee.name || employee.user?.name || 'Usuário',
    };
  }

  /**
   * Cria um novo orçamento
   */
  async create(createQuotationDto: CreateQuotationDto): Promise<Quotation> {
    const {
      description,
      contactSourceId,
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
          contactSourceId,
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
          quotation: {
            connect: {
              id: newQuotation.id,
            },
          },
        },
      });

      const defaultPaymentCondition =
        await this.prisma.paymentCondition.findFirst({
          where: {
            companyId: createQuotationDto.companyId,
            isActive: true,
          },
        });

      if (!defaultPaymentCondition) {
        throw new Error('No payment condition found for company');
      }

      await this.prisma.quotationPayment.create({
        data: {
          quotation: {
            connect: { id: newQuotation.id },
          },
          billing: series.billing,
          totalValue: 0,
          paymentCondition: {
            connect: { id: defaultPaymentCondition.id },
          },
        },
      });

      return newQuotation;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Erro ao criar orçamento: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao criar orçamento: ${error.message}`,
      );
    }
  }

  /**
   * Busca contagem de orçamentos por status
   */
  async findAllQuantity(companyId: string, sellerId?: string) {
    const allStatuses: QuotationStatus[] = [
      'OPEN',
      'REJECTED',
      'DONE',
      'OVERDUE' as any,
    ];

    const where: any = { companyId, status: { in: allStatuses } };
    if (sellerId) {
      where.sellerId = sellerId;
    }

    const quotations = await this.prisma.quotation.findMany({
      where,
      select: {
        status: true,
        dueDate: true,
      },
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in QuotationStatus]: number },
    );

    quotations.forEach((quotation) => {
      const isOverdue =
        quotation.dueDate &&
        quotation.dueDate < new Date() &&
        quotation.status === 'DONE';

      const status = isOverdue ? 'OVERDUE' : quotation.status;
      statusCount[status]++;
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      TOTAL: total,
    };
  }

  /**
   * Busca todos os orçamentos com filtros
   */
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
          AND: [
            ...(where.AND
              ? Array.isArray(where.AND)
                ? where.AND
                : [where.AND]
              : []),
            {
              OR: [
                { description: { contains: dto.search, mode: 'insensitive' } },
                {
                  client: {
                    name: { contains: dto.search, mode: 'insensitive' },
                  },
                },
                {
                  seller: {
                    user: {
                      name: { contains: dto.search, mode: 'insensitive' },
                    },
                  },
                },
              ],
            },
          ],
        };
      }

      if (dto.status) {
        if ((dto.status as any) === 'OVERDUE') {
          where = {
            ...where,
            status: 'DONE',
            dueDate: {
              lt: new Date(),
            },
          };
        } else {
          where = { ...where, status: dto.status };
        }
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

      if (dto.startDate || dto.endDate) {
        const dateFilter: any = {};

        if (dto.startDate) {
          dateFilter.gte = new Date(dto.startDate);
        }

        if (dto.endDate) {
          const endDate = new Date(dto.endDate);
          endDate.setHours(23, 59, 59, 999);
          dateFilter.lte = endDate;
        }

        where = {
          ...where,
          createdAt: dateFilter,
        };
      }

      const [quotations, total] = await Promise.all([
        this.prisma.quotation.findMany({
          where,
          include: {
            tag: true,
            series: true,
            client: true,
            order: {
              select: {
                id: true,
              },
            },
            deliveryInfo: {
              select: {
                value: true,
              },
            },
            quotationPayment: {
              select: {
                finalValue: true,
                discountTotal: true,
                downPaymentAdditionalFee: true,
                commission: {
                  select: {
                    type: true,
                    totalCommission: true,
                  },
                },
                quotationInstallment: {
                  select: {
                    additionalFee: true,
                  },
                },
              },
            },
          },
          take: Number(dto.limit),
          skip: (Number(dto.page) - 1) * Number(dto.limit),
          orderBy: {
            createdAt: 'desc',
          },
        }),
        this.prisma.quotation.count({ where }),
      ]);

      return {
        data: quotations.map((quotation) => ({
          ...quotation,
          finalValue: quotation.quotationPayment?.finalValue || 0,
        })),
        meta: {
          total,
          page: Number(dto.page),
          limit: Number(dto.limit),
          totalPages: Math.ceil(total / Number(dto.limit)),
        },
      };
    } catch (error) {
      this.logger.error('Error in findAll:', error.stack);
      throw error;
    }
  }

  /**
   * Busca um orçamento por ID
   */
  async findOne(id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        seller: {
          include: { user: true, sellerProfile: true },
        },
        client: true,
        series: true,
        quotationPayment: true,
        quotationProduct: {
          include: { product: true, items: true },
        },
        deliveryInfo: true,
      },
    });

    if (!quotation) {
      throw new NotFoundException(`Quotation with ID '${id}' not found.`);
    }

    return quotation;
  }

  /**
   * Conta total de orçamentos
   */
  async count() {
    return this.prisma.quotation.count();
  }

  /**
   * Atualiza um orçamento
   */
  async update(id: string, updateQuotationDto: UpdateQuotationDto) {
    try {
      const existingQuotation = await this.prisma.quotation.findUnique({
        where: { id },
      });

      if (!existingQuotation) {
        throw new NotFoundException(`Quotation with ID '${id}' not found.`);
      }

      return await this.prisma.quotation.update({
        where: { id },
        data: updateQuotationDto,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove (desativa) um orçamento
   */
  remove(id: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Busca fontes de contato
   */
  async findAllContactSources() {
    try {
      return await this.prisma.contactSource.findMany({
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      this.logger.error('Error finding all contact sources:', error.stack);
      throw error;
    }
  }

  /**
   * Duplica um orçamento completo
   */
  async duplicate(
    quotationId: string,
    duplicateDto: DuplicateQuotationDto,
    userId?: string,
  ): Promise<Quotation> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: {
          include: {
            items: true,
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

    const createDto: CreateQuotationDto = {
      description:
        duplicateDto.description || `${quotation.description} (Cópia)`,
      clientId: duplicateDto.clientId || quotation.clientId,
      contactId: duplicateDto.contactId || quotation.contactId,
      contactSourceId: quotation.contactSourceId,
      totalValue: quotation.totalValue,
      sellerId: quotation.sellerId,
      seriesId: quotation.seriesId,
      companyId: quotation.companyId,
      subCompanyId: quotation.subCompanyId,
      quotationNumber: serie.currentBudgetNumber + 1,
    };

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
          modality: quotation.deliveryInfo.modality,
          supplierId: quotation.deliveryInfo.supplierId,
        },
      });

      await this.prisma.quotationPayment.create({
        data: {
          quotationId: newQuotation.id,
          paymentConditionId: quotation.quotationPayment.paymentConditionId,
          totalValue: quotation.quotationPayment.totalValue,
          finalValue: quotation.quotationPayment.finalValue,
        },
      });
    } catch (error) {
      this.logger.error(
        'Error creating deliveryInfo/payment for duplicate:',
        error.stack,
      );
    }

    let productsWithCurrentPrices = null;
    if (duplicateDto.updatePrices) {
      const productIds = quotation.quotationProduct.map((p) => p.productId);
      productsWithCurrentPrices = await this.prisma.product.findMany({
        where: {
          id: { in: productIds },
        },
        include: {
          items: true,
        },
      });
    }

    for (const product of quotation.quotationProduct) {
      const currentProduct = duplicateDto.updatePrices
        ? productsWithCurrentPrices.find((p) => p.id === product.productId)
        : null;

      const calculatedItems: {
        item: any;
        currentItem: any;
        calculatedSalePrice: number;
      }[] = [];

      for (const item of product.items) {
        const currentItem = currentProduct?.items.find(
          (i) => i.id === item.productItemId,
        );

        let calculatedSalePrice: number;

        if (duplicateDto.updatePrices) {
          const baseSalePrice = currentItem?.salePrice;

          if (!baseSalePrice) {
            calculatedSalePrice = item.salePrice ?? 0;
          } else {
            if (item.unitKind === 'DURATION' && item.duration) {
              const durationInHours = item.duration / 3600;
              calculatedSalePrice =
                baseSalePrice * durationInHours * item.quantity;
            } else if (item.unitKind === 'AREA' && item.width && item.height) {
              calculatedSalePrice =
                baseSalePrice * item.width * item.height * item.quantity;
            } else if (item.unitKind === 'DISTANCE' && item.distance) {
              calculatedSalePrice =
                baseSalePrice * item.distance * item.quantity;
            } else if (item.unitKind === 'LENGTH' && item.length) {
              calculatedSalePrice = baseSalePrice * item.length * item.quantity;
            } else if (item.unitKind === 'WEIGHT' && item.weight) {
              calculatedSalePrice = baseSalePrice * item.weight * item.quantity;
            } else if (item.unitKind === 'CAPACITY' && item.volume) {
              calculatedSalePrice = baseSalePrice * item.volume * item.quantity;
            } else {
              calculatedSalePrice = baseSalePrice * item.quantity;
            }
          }
        } else {
          calculatedSalePrice = item.salePrice ?? 0;
        }

        calculatedItems.push({ item, currentItem, calculatedSalePrice });
      }

      let newProductTotalValue = product.totalValue;
      let newProductFinalValue = product.finalValue;

      if (duplicateDto.updatePrices) {
        newProductTotalValue = calculatedItems.reduce(
          (total, { calculatedSalePrice }) => total + calculatedSalePrice,
          0,
        );

        if (product.discount && product.discountType === 'PERCENT') {
          newProductFinalValue =
            newProductTotalValue -
            (newProductTotalValue * product.discount) / 100;
        } else if (product.discount && product.discountType === 'VALUE') {
          newProductFinalValue = newProductTotalValue - product.discount;
        } else {
          newProductFinalValue = newProductTotalValue;
        }
      }

      const productDto: DuplicateQuotationProductDto = {
        description: product.description,
        quantity: product.quantity,
        technicalDescription: product.technicalDescription,
        imageUrl: product.imageUrl,
        notes: product.notes,
        totalValue: newProductTotalValue,
        finalValue: newProductFinalValue,
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

      for (const {
        item,
        currentItem,
        calculatedSalePrice,
      } of calculatedItems) {
        const baseUnitCost = duplicateDto.updatePrices
          ? (currentItem?.unitCost ?? item.unitCost)
          : item.unitCost;

        const itemDto: DuplicateQuotationProductItemDto = {
          quotationId: newQuotation.id,
          productId: newProduct.productId,
          productItemId: item.productItemId,
          quotationProductId: newProduct.id,
          name: item.name,
          quantity: item.quantity,
          originalQuantity: item.originalQuantity,
          unitKind: item.unitKind as any,
          width: item.width,
          height: item.height,
          length: item.length,
          weight: item.weight,
          volume: item.volume,
          distance: item.distance,
          duration: item.duration,
          unitCost: baseUnitCost,
          salePrice: calculatedSalePrice,
          totalValue: calculatedSalePrice,
        };

        try {
          await this.prisma.quotationProductItem.create({
            data: itemDto as any,
          });
        } catch (error) {
          this.logger.error(
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

    await this.recalculateQuotationTotalValue(newQuotation.id);

    if (userId) {
      try {
        await this.prisma.quotationHistory.create({
          data: {
            quotationId: newQuotation.id,
            action: 'DUPLICATED',
            description: `Orçamento duplicado a partir do orçamento #${quotation.quotationNumber}`,
            changes: null,
            metadata: {
              originalQuotationId: quotation.id,
              originalQuotationNumber: quotation.quotationNumber,
              updatedPrices: duplicateDto.updatePrices || false,
              clientChanged: duplicateDto.clientId
                ? duplicateDto.clientId !== quotation.clientId
                : false,
              contactChanged: duplicateDto.contactId
                ? duplicateDto.contactId !== quotation.contactId
                : false,
              descriptionChanged: duplicateDto.description
                ? duplicateDto.description !== quotation.description
                : false,
            },
            createdBy: userId,
            createdByName: null,
          },
        });
      } catch (error) {
        this.logger.error(
          'Error creating quotation duplication history:',
          error.stack,
        );
      }
    }

    return newQuotation;
  }

  /**
   * Recalcula o valor total do orçamento somando finalValues dos produtos
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
