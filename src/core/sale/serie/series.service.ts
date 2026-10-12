import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CreateSaleSeriesDto } from './dto/create-series.dto';
import { UpdateSaleSeriesDto } from './dto/update-serie.dto';
import { SeriesFilterDTO } from './dto/series-filter.dto';
import { Prisma } from '@prisma/client';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

const SERIES_NOT_FOUND = 'Série de venda não encontrada.';

/**
 * A transação que só paga parcelas da série: tem parcela dela, e todas as
 * parcelas que tem são dela. Só `every` casava toda transação sem parcela
 * desse lado (lista vazia satisfaz `every`): o expurgo descontava os caixas
 * e apagava as transações de todas as empresas.
 */
function transactionsOnlyOfSeries(
  serieId: string,
): Prisma.TransactionWhereInput {
  const receivableOfSeries: Prisma.ReceivableInstallmentWhereInput = {
    receivable: { quotation: { series: { id: serieId } } },
  };
  const payableOfSeries: Prisma.PayableInstallmentWhereInput = {
    payable: { quotation: { series: { id: serieId } } },
  };
  return {
    OR: [
      {
        receivableInstallment: {
          some: receivableOfSeries,
          every: receivableOfSeries,
        },
      },
      {
        payableInstallment: {
          some: payableOfSeries,
          every: payableOfSeries,
        },
      },
    ],
  };
}

@Injectable()
export class SaleSeriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSaleSeriesDto: CreateSaleSeriesDto) {
    try {
      return await this.prisma.saleSeries.create({ data: createSaleSeriesDto });
    } catch (error) {
      console.error(error);
      if (error instanceof HttpException) {
        throw error;
      }
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

  async findOne(id: string, companyId: string) {
    const series = await this.prisma.saleSeries.findFirst({
      where: { id, companyId, isActive: true },
      include: { allowedProfiles: { select: { id: true, name: true } } },
    });

    if (!series) {
      throw new NotFoundException(SERIES_NOT_FOUND);
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

  /**
   * Toda operação por id confere a empresa da sessão: sem isso, a série de
   * outra empresa era lida, alterada, inativada ou expurgada pelo id. O id de
   * outra empresa responde 404, como um id que não existe.
   */
  private async findOwn(id: string, companyId: string) {
    const series = await this.prisma.saleSeries.findFirst({
      where: { id, companyId },
      select: { id: true, isTraining: true },
    });
    if (!series) {
      throw new NotFoundException(SERIES_NOT_FOUND);
    }
    return series;
  }

  async update(
    id: string,
    companyId: string,
    updateSaleSeriesDto: UpdateSaleSeriesDto,
    isAdmin = false,
  ) {
    await this.findOwn(id, companyId);
    await assertBelongsToCompany(
      this.prisma.sellerProfile,
      updateSaleSeriesDto.allowedProfileIds,
      { companyId },
      'Perfil de vendedor não encontrado.',
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const isUpdatingCurrentBudgetNumber =
          updateSaleSeriesDto.currentBudgetNumber !== undefined;

        if (isUpdatingCurrentBudgetNumber) {
          const currentBudgetNumber = Number(
            updateSaleSeriesDto.currentBudgetNumber,
          );

          if (
            !Number.isInteger(currentBudgetNumber) ||
            currentBudgetNumber < 0
          ) {
            throw new BadRequestException(
              'O número atual do orçamento deve ser um inteiro maior ou igual a zero.',
            );
          }

          updateSaleSeriesDto.currentBudgetNumber = currentBudgetNumber;
        }

        if (isUpdatingCurrentBudgetNumber && !isAdmin) {
          throw new ForbiddenException(
            'Somente administradores podem alterar o número atual do orçamento.',
          );
        }

        const seriesForNumberValidation = isUpdatingCurrentBudgetNumber
          ? await tx.saleSeries.findUnique({
              where: { id },
              select: { currentBudgetNumber: true },
            })
          : null;

        if (isUpdatingCurrentBudgetNumber && !seriesForNumberValidation) {
          throw new NotFoundException(`Sale series not found`);
        }

        if (
          isUpdatingCurrentBudgetNumber &&
          updateSaleSeriesDto.currentBudgetNumber !==
            seriesForNumberValidation?.currentBudgetNumber
        ) {
          const existingQuotation = await tx.quotation.findFirst({
            where: {
              seriesId: id,
              quotationNumber: updateSaleSeriesDto.currentBudgetNumber,
            },
            select: { id: true },
          });

          if (existingQuotation) {
            throw new BadRequestException(
              `Já existe um orçamento com o número ${updateSaleSeriesDto.currentBudgetNumber} nesta série.`,
            );
          }
        }

        // Se estiver definindo como padrão, primeiro remover o padrão de outras séries
        if (updateSaleSeriesDto.isDefault === true) {
          await tx.saleSeries.updateMany({
            where: {
              companyId,
              id: { not: id },
            },
            data: { isDefault: false },
          });
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
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.code === 'P2002') {
        throw new BadRequestException('Sale series code already exists');
      }
      throw new BadRequestException('Error on update sale series');
    }
  }

  async remove(id: string, companyId: string) {
    await this.findOwn(id, companyId);

    return this.prisma.saleSeries.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Apaga orçamentos, O.S., agendas e o financeiro da série de treinamento.
   * Só da empresa da sessão e só de série de treinamento: a rota apagava
   * qualquer série pelo id.
   */
  async removeTrainingSerieData(serieId: string, companyId: string) {
    const serie = await this.findOwn(serieId, companyId);
    if (!serie.isTraining) {
      throw new UnprocessableEntityException({
        code: 'NOT_TRAINING_SERIES',
        message: 'Só a série de treinamento pode ter os dados apagados.',
      });
    }

    try {
      //deletar orçamento/agenda de entrega/pedido/financeiro
      return await this.prisma.$transaction(async (tx) => {
        // First find all transactions that will be deleted
        const transactions = await tx.transaction.findMany({
          where: transactionsOnlyOfSeries(serieId),
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

        // As mesmas transações cujo valor saiu dos caixas acima
        await tx.transaction.deleteMany({
          where: { id: { in: transactions.map((t) => t.id) } },
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
