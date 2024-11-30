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
import { Prisma, Quotation, QuotationStatus } from '@prisma/client';
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

      if (seriesId) {
        const series = await this.prisma.saleSeries.findUnique({
          where: { id: seriesId },
        });

        if (!series) {
          throw new NotFoundException(
            `Série com ID ${seriesId} não encontrada`,
          );
        }

        await this.prisma.saleSeries.update({
          where: {
            id: seriesId,
          },
          data: {
            currentBudgetNumber: { increment: 1 },
          },
        });
      }

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
    // Verifica se o front enviou as propriedades que podem ser editadas
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

    // Validação de `allowEditValues` (apenas se algum campo editável for enviado)
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
        // Verifica campos de valores
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

    // Cria o QuotationProduct
    await this.prisma.quotationProduct.create({
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

    // Cria os QuotationProductItems
    const quotationProductItems = data.items.map((item) => {
      const originalItem = product.items.find((pItem) => pItem.id === item.id);
      if (!originalItem) {
        throw new BadRequestException(
          `Item ${item.id} não encontrado no produto`,
        );
      }

      return {
        quotationId,
        productId: product.id,
        productItemId: originalItem.id,
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

    return this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: { include: { items: true } },
      },
    });
  }

  async updateProductInQuotation(
    quotationId: string,
    productId: string,
    data: UpdateItemDto,
  ) {
    try {
      // Busca o orçamento e o produto
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: quotationId },
        include: {
          products: true,
          quotationProduct: {
            where: { productId },
            include: {
              items: true,
            },
          },
        },
      });

      if (!quotation) {
        throw new NotFoundException(`Orçamento não encontrado`);
      }

      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        include: {
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
          `Descrição técnica não pode ser editada para o produto ${product.name}`,
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
          `Valores não podem ser editados para o produto ${product.name}`,
        );
      }

      // Atualiza o produto dentro do orçamento
      const updatedQuotationProduct = await this.prisma.quotationProduct.update(
        {
          where: { quotationId_productId: { quotationId, productId } },
          data: {
            description: data.description || undefined,
            quantity: data.quantity,
            imageUrl: data.imageUrl || undefined,
            technicalDescription: data.technicalDescription || undefined,
            totalValue:
              data.quantity *
              product.items.reduce(
                (acc, item) => acc + (item.salePrice || 0),
                0,
              ),
            ...(data.items && {
              items: {
                update: data.items.map((item) => ({
                  where: {
                    quotationId_productId_productItemId: {
                      quotationId,
                      productId,
                      productItemId: item.id,
                    },
                  },
                  data: {
                    unitOfMeasureId: item.unitOfMeasureId,
                    quantity: item.quantity,
                    width: item.width,
                    height: item.height,
                    length: item.length,
                    weight: item.weight,
                    volume: item.volume,
                    distance: item.distance,
                    duration: item.duration,
                    unitCost: item.unitCost,
                    salePrice: item.salePrice,
                    totalValue: item.quantity * item.salePrice,
                  },
                })),
              },
            }),
          },
        },
      );

      return updatedQuotationProduct;
    } catch (error) {
      throw new BadRequestException(
        'Failed to update product in quotation',
        error.message,
      );
    }
  }

  async removeProductFromQuotation(quotationId: string, productId: string) {
    try {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: quotationId },
        include: {
          quotationProduct: {
            where: {
              productId: productId,
            },
            include: {
              items: true,
            },
          },
        },
      });

      if (!quotation) {
        throw new NotFoundException(`Orçamento não encontrado`);
      }

      const quotationProduct = quotation.quotationProduct[0];

      if (!quotationProduct) {
        throw new NotFoundException(
          `Produto ${productId} não encontrado no orçamento ${quotationId}.`,
        );
      }

      const productItemIds = quotationProduct.items?.map(
        (item) => item.productItemId,
      );

      if (productItemIds.length > 0) {
        await this.prisma.quotationProductItem.deleteMany({
          where: {
            quotationId,
            productId,
            productItemId: {
              in: productItemIds,
            },
          },
        });
      }

      await this.prisma.quotationProduct.delete({
        where: { quotationId_productId: { quotationId, productId } },
      });

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

  async findAllQuantity(companyId: string) {
    const allStatuses: QuotationStatus[] = [
      'OPEN',
      'REJECTED',
      'DONE',
      'OVERDUE',
    ];

    const result = await this.prisma.quotation.groupBy({
      by: ['status'],
      where: { companyId },
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
      console.log(where);
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

  findOne(id: string) {
    return this.prisma.quotation.findUnique({
      where: { id },
      include: {
        series: {
          select: {
            id: true,
            title: true,
            code: true,
          },
        },
        client: true,
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
        quotationProduct: {
          include: {
            product: true,
            items: {
              include: {
                productItem: true,
              },
            },
          },
        },
      },
    });
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
          notes: item.notes,
          discount: item.discount,
          discountType: item.discountType,
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

  async approve(quotationId: string): Promise<Quotation> {
    const approved = await this.prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.APPROVED,
        approvedAt: new Date(),
      },
    });

    // Criar um pedido com base na cotação aprovada
    await this.orderService.create({
      quotationId: approved.id,
    });

    return approved;
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

    const update = {};

    if (updateQuotationDto.description) {
      update['description'] = updateQuotationDto.description;
    }

    if (updateQuotationDto.sellerId) {
      update['sellerId'] = updateQuotationDto.sellerId;
    }

    if (updateQuotationDto.companyId) {
      update['companyId'] = updateQuotationDto.companyId;
    }

    if (updateQuotationDto.clientId) {
      update['clientId'] = updateQuotationDto.clientId;
    }

    if (updateQuotationDto.tagId) {
      update['tagId'] = updateQuotationDto.tagId;
    }

    if (!Object.keys(update).length) {
      return existingQuotation;
    }
    console.log(update);
    // Realize a atualização com os dados fornecidos
    return this.prisma.quotation.update({
      where: { id },
      data: update,
    });
  }

  remove(id: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
