import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterQuotationDto } from './dto/filter.dto';
import { Quotation, QuotationStatus } from '@prisma/client';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { DuplicateQuotationDto } from './dto/duplicate-quotation.dto';
import { QuotationContactType } from './entities/quotation.entity';
import { OrderService } from '../order/order.service';

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
      serieId,
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
          seriesId: serieId || undefined,
        },
      });

      if (serieId) {
        const series = await this.prisma.saleSeries.findUnique({
          where: { id: serieId },
        });

        if (!series) {
          throw new NotFoundException(`Série com ID ${serieId} não encontrada`);
        }

        await this.prisma.saleSeries.update({
          where: {
            id: serieId,
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

  // async createWithItems(dto: CreateQuotationDto) {
  //   const prisma = new PrismaClient();

  //   try {
  //     const productData = await Promise.all(
  //       dto.products.map(async (product) => {
  //         const items = await Promise.all(
  //           product.items.map(async (item) => {
  //             const productItem = await prisma.productItem.findUnique({
  //               where: { id: item.productItemId },
  //             });
  //             if (!productItem) {
  //               throw new Error('ProductItem not found');
  //             }
  //             return {
  //               productItemId: item.productItemId,
  //               quantity: item.quantity,
  //               totalValue: productItem.salePrice * item.quantity,
  //             };
  //           }),
  //         );

  //         const totalValue = items.reduce(
  //           (acc, item) => acc + item.totalValue,
  //           0,
  //         );

  //         return {
  //           productId: product.productId,
  //           quantity: product.quantity,
  //           totalValue: totalValue,
  //           items: {
  //             create: items,
  //           },
  //         };
  //       }),
  //     );

  //     // Criar a cotação
  //     return await prisma.quotation.create({
  //       data: {
  //         clientId: dto.clientId,
  //         seriesId: dto.serieId,
  //         description: dto.description,
  //         sellerId: dto.sellerId,
  //         companyId: dto.companyId,
  //         totalValue: productData.reduce(
  //           (acc, product) => acc + product.totalValue,
  //           0,
  //         ),
  //         quotationProduct: {
  //           create: productData,
  //         },
  //       },
  //     });
  //   } catch (error) {
  //     if (error instanceof PrismaClientKnownRequestError) {
  //       console.error('Prisma error:', error);
  //       throw new HttpException(
  //         'Database error',
  //         HttpStatus.INTERNAL_SERVER_ERROR,
  //       );
  //     }
  //     console.error('General error:', error);
  //     throw new HttpException(
  //       'Internal server error',
  //       HttpStatus.INTERNAL_SERVER_ERROR,
  //     );
  //   } finally {
  //     await prisma.$disconnect();
  //   }
  // }

  async findAll(dto: FilterQuotationDto) {
    try {
      let where: any = {
        status: { not: QuotationStatus.APPROVED },
      };

      if (dto.companyId) {
        where = { ...where, companyId: dto.companyId };
      }

      if (dto.search) {
        where = { ...where, name: { contains: dto.search } };
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
        const date = new Date(dto.date);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        where = {
          ...where,
          createdAt: {
            lte: endDate,
          },
        };
      }

      const [quotations, total] = await Promise.all([
        this.prisma.quotation.findMany({
          where,
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
          acc[date].quotations.push(quotation);
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
    dto: DuplicateQuotationDto,
  ): Promise<Quotation> {
    // TODO: implementar o controle de preço
    console.log('Duplicate price:', dto.price);

    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }

    const createDto: CreateQuotationDto = {
      description: `${quotation.description} (Cópia)`,
      clientId: quotation.clientId,
      companyId: quotation.companyId,
      sellerId: quotation.sellerId,
      serieId: quotation.seriesId,
      contactType: QuotationContactType.DIRECT,
      // products: quotation.quotationProduct.map((product) => ({
      //   productId: product.productId,
      //   quantity: product.quantity,
      //   items: product.items.map((item) => ({
      //     productItemId: item.productItemId,
      //     quantity: item.quantity,
      //   })),
      // })),
    };

    return this.create(createDto);
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

    if (updateQuotationDto.serieId) {
      update['seriesId'] = updateQuotationDto.serieId;
    }

    if (updateQuotationDto.sellerId) {
      update['sellerId'] = updateQuotationDto.sellerId;
    }

    // if (updateQuotationDto.dueDate) {
    //   update['dueDate'] = updateQuotationDto.dueDate;
    // }

    if (updateQuotationDto.clientId) {
      update['clientId'] = updateQuotationDto.clientId;
    }

    if (!Object.keys(update).length) {
      return existingQuotation;
    }

    // Realize a atualização com os dados fornecidos
    return this.prisma.quotation.update({
      where: { id },
      data: update,
    });
  }

  remove(id: string) {
    return this.prisma.quotation.delete({ where: { id } });
  }
}
