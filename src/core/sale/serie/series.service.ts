import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CreateSaleSeriesDto } from './dto/create-series.dto';
import { UpdateSaleSeriesDto } from './dto/update-serie.dto';
import { SeriesFilterDTO } from './dto/series-filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class SaleSeriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSaleSeriesDto: CreateSaleSeriesDto) {
    try {
      return await this.prisma.saleSeries.create({ data: createSaleSeriesDto });
    } catch (error) {
      console.error(error);
      if (error.code === 'P2002') {
        throw new BadRequestException('Sale series code already exists');
      }
      throw new BadRequestException('Error on create sale series');
    }
  }

  async findAll(filter: SeriesFilterDTO) {
    const { companyId, page, limit } = filter;
    const where: Prisma.SaleSeriesWhereInput = { companyId };
    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    // When fetching active series for a non-admin seller, apply profile restriction:
    // series with no allowedProfiles = available to everyone
    // series with allowedProfiles = only those profiles can use it
    if (filter.isActive === true && !filter.isAdmin && filter.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: filter.employeeId },
        select: { sellerProfileId: true },
      });
      if (employee?.sellerProfileId) {
        where.OR = [
          { allowedProfiles: { none: {} } },
          { allowedProfiles: { some: { id: employee.sellerProfileId } } },
        ];
      } else {
        where.allowedProfiles = { none: {} };
      }
    }

    try {
      const skip = (+page - 1) * +limit;

      const [total, saleSeries] = await Promise.all([
        this.prisma.saleSeries.count({ where }),
        this.prisma.saleSeries.findMany({
          where,
          include: { allowedProfiles: { select: { id: true, name: true } } },
          orderBy: [{ isTraining: 'desc' }, { description: 'asc' }],
          skip,
          take: +limit,
        }),
      ]);

      return {
        total,
        lastPage: Math.ceil(total / +limit),
        data: saleSeries.map((series) => this.formatSeries(series)),
      };
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error on find sale series');
    }
  }

  async findOne(id: string) {
    const series = await this.prisma.saleSeries.findUnique({
      where: { id, isActive: true },
      include: { allowedProfiles: { select: { id: true, name: true } } },
    });

    if (!series) {
      throw new NotFoundException(`Sale series not found`);
    }

    return this.formatSeries(series);
  }

  private formatSeries(series: any) {
    const billingMap = {
      ON_ORDER: 'Faturar no pedido',
      ON_DELIVERY: 'Faturar na entrega',
      ON_CASHIER: 'Faturar na frente de caixa',
      NO_INVOICE: 'Sem lançamento',
    };

    const sendToProductionMap = {
      DIRECT: 'Enviar Diretamente',
    };

    const productionStatusMap = {
      MANAGE_PRODUCTION: 'Gerenciar produção',
      PRODUCTION_COMPLETED: 'Produção concluída',
    };

    return {
      ...series,
      billing: {
        value: series.billing,
        label: billingMap[series.billing] || series.billing,
      },
      sendToProduction: {
        value: series.sendToProduction,
        label:
          sendToProductionMap[series.sendToProduction] ||
          series.sendToProduction,
      },
      productionStatus: {
        value: series.productionStatus,
        label:
          productionStatusMap[series.productionStatus] ||
          series.productionStatus,
      },
    };
  }

  async update(id: string, updateSaleSeriesDto: UpdateSaleSeriesDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Se estiver definindo como padrão, primeiro remover o padrão de outras séries
        if (updateSaleSeriesDto.isDefault === true) {
          const currentSeries = await tx.saleSeries.findUnique({
            where: { id },
            select: { companyId: true },
          });

          if (currentSeries) {
            await tx.saleSeries.updateMany({
              where: {
                companyId: currentSeries.companyId,
                id: { not: id },
              },
              data: { isDefault: false },
            });
          }
        }

        const { allowedProfileIds, ...rest } = updateSaleSeriesDto;

        return await tx.saleSeries.update({
          where: { id },
          data: {
            ...rest,
            ...(allowedProfileIds !== undefined && {
              allowedProfiles: {
                set: allowedProfileIds.map((profileId) => ({ id: profileId })),
              },
            }),
          },
          include: { allowedProfiles: { select: { id: true, name: true } } },
        });
      });
    } catch (error) {
      console.error(error);
      if ((error.code = 'P2002')) {
        throw new BadRequestException('Sale series code already exists');
      }
      throw new BadRequestException('Error on update sale series');
    }
  }

  remove(id: string) {
    return this.prisma.saleSeries.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async removeTrainingSerieData(serieId: string) {
    try {
      const serie = await this.prisma.saleSeries.findUnique({
        where: { id: serieId },
      });

      if (!serie) {
        throw new NotFoundException(`Serie nao encontrada`);
      }

      //deletar orçamento/agenda de entrega/pedido/financeiro
      return await this.prisma.$transaction(async (tx) => {
        // First find all transactions that will be deleted
        const transactions = await tx.transaction.findMany({
          where: {
            OR: [
              {
                receivableInstallment: {
                  every: {
                    receivable: { quotation: { series: { id: serieId } } },
                  },
                },
              },
              {
                payableInstallment: {
                  every: {
                    payable: { quotation: { series: { id: serieId } } },
                  },
                },
              },
            ],
          },
          include: {
            cashRegister: true,
          },
        });

        // Update cash registers based on transactions
        for (const transaction of transactions) {
          if (transaction.cashRegister) {
            const updateData: any = {};

            if (transaction.type === 'INCOME') {
              updateData.totalIncomes = { decrement: transaction.amount };
              if (transaction.cashRegister.status !== 'OPEN') {
                updateData.closingBalance = {
                  decrement: transaction.amount,
                };
              }
            } else if (transaction.type === 'OUTCOME') {
              updateData.totalOutcomes = { decrement: transaction.amount };
              if (transaction.cashRegister.status !== 'OPEN') {
                updateData.closingBalance = {
                  increment: transaction.amount,
                };
              }
            }

            await tx.cashRegister.update({
              where: { id: transaction.cashRegister.id },
              data: updateData,
            });
          }
        }

        // Continue with existing deletion logic
        await tx.productionStage.deleteMany({
          where: {
            schedule: {
              quotation: {
                series: {
                  id: serieId,
                },
              },
            },
          },
        });
        await tx.deliverySchedule.deleteMany({
          where: {
            quotation: {
              series: {
                id: serieId,
              },
            },
          },
        });

        await tx.order.deleteMany({
          where: {
            quotation: {
              series: {
                id: serieId,
              },
            },
          },
        });

        await tx.deliveryInfo.deleteMany({
          where: {
            quotation: {
              series: {
                id: serieId,
              },
            },
          },
        });
        await tx.quotationInstallment.deleteMany({
          where: {
            quotationPayment: {
              quotation: {
                series: {
                  id: serieId,
                },
              },
            },
          },
        });

        await tx.quotationPayment.deleteMany({
          where: {
            quotation: {
              series: {
                id: serieId,
              },
            },
          },
        });

        await tx.quotationProductItem.deleteMany({
          where: {
            quotationProduct: {
              quotation: {
                series: {
                  id: serieId,
                },
              },
            },
          },
        });

        await tx.quotationProduct.deleteMany({
          where: {
            quotation: {
              series: {
                id: serieId,
              },
            },
          },
        });

        await tx.transaction.deleteMany({
          where: {
            OR: [
              {
                receivableInstallment: {
                  every: {
                    receivable: { quotation: { series: { id: serieId } } },
                  },
                },
              },
              {
                payableInstallment: {
                  every: {
                    payable: { quotation: { series: { id: serieId } } },
                  },
                },
              },
            ],
          },
        });

        await tx.payableInstallment.deleteMany({
          where: {
            payable: {
              quotation: {
                series: {
                  id: serieId,
                },
              },
            },
          },
        });
        await tx.receivableInstallment.deleteMany({
          where: {
            receivable: {
              quotation: {
                series: {
                  id: serieId,
                },
              },
            },
          },
        });

        await tx.payable.deleteMany({
          where: {
            quotation: {
              series: {
                id: serieId,
              },
            },
          },
        });

        await tx.receivable.deleteMany({
          where: {
            quotation: {
              series: {
                id: serieId,
              },
            },
          },
        });
        await tx.quotation.deleteMany({
          where: {
            series: {
              id: serieId,
            },
          },
        });
      });
    } catch (error) {
      if (error.code === 'P2024') {
        // Tratamento específico para timeout
        throw new Error('A transação demorou muito para ser concluída.');
      }
      throw error; // Re-throw outros erros
    }
  }
}
