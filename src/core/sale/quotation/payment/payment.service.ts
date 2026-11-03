/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  UpdateCommissionDto,
  UpdatePaymentDto,
} from './dto/create-payment.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly prisma: PrismaService) {}
  async findOne(id: string) {
    return this.prisma.quotationPayment.findUnique({
      where: { quotationId: id },
      include: {
        paymentCondition: true,
        commission: true,
        quotationInstallment: true,
      },
    });
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    initialTimeout = 10000,
  ): Promise<T> {
    let lastError;
    let timeout = initialTimeout;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (
          error?.code === 'P2028' || // Transaction timeout
          error?.message?.includes(
            'Transaction API error: Transaction already closed',
          )
        ) {
          timeout = Math.min(timeout * 1.5, 30000);
          console.log(
            `Attempt ${attempt} failed, retrying with timeout ${timeout}ms`,
          );
          continue;
        }
        throw error; // If it's not a timeout error, throw immediately
      }
    }
    throw lastError;
  }

  async updatePayment(quotationId: string, updateData: UpdatePaymentDto) {
    const existingPayment = await this.findOne(quotationId);
    if (!existingPayment) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    try {
      const {
        installments = [],
        commission,
        downPayment,
        paymentConditionId,
        discount,
        type,
        billing,
        hasDownPayment,
        totalValue = 0,
        description,
        finalValue,
        installmentQty,
        maxInstallmentQty,
        minInstallmentQty,
        mainAdditionalFee,
        additionalFeeType,
        ...rest
      } = updateData;

      // Colunas NOT NULL no banco. O formulário manda `null` quando o campo é
      // limpo — o zod e o `@IsOptional()` do DTO aceitam null, e a guarda
      // `!== undefined` deixava o null chegar no Prisma, que recusava e virava
      // "Internal server error" sem causa visível.
      const orZero = (value?: number | null) => value ?? 0;

      // Prepare base payment data
      const paymentData: any = {
        ...(type && { type }),
        ...(billing && { billing }),
        ...(description && { description }),
        ...(totalValue && { totalValue }),
        ...(finalValue !== undefined && { finalValue }),
        ...(installmentQty && { installmentQty }),
        ...(maxInstallmentQty && { maxInstallmentQty }),
        ...(minInstallmentQty && { minInstallmentQty }),
        ...(mainAdditionalFee !== undefined && { mainAdditionalFee }),
        ...(additionalFeeType && { additionalFeeType }),
      };

      // Handle payment condition
      if (paymentConditionId) {
        paymentData.paymentCondition = {
          connect: { id: paymentConditionId },
        };
      }

      // Handle down payment if exists
      if (hasDownPayment && downPayment) {
        // Entrada sem vencimento gravava `downPaymentDueDate` nulo e a venda
        // so quebrava la na aprovacao, ao criar a parcela da entrada
        // (`dueDate` e NOT NULL): a venda ficava aprovada, com O.S., e sem
        // nenhum lancamento no financeiro.
        //
        // A edicao parcial nao reenvia tudo, entao o que vale e o valor final,
        // ja considerando o que esta gravado.
        const valorEntrada =
          downPayment.amount !== undefined
            ? orZero(downPayment.amount)
            : (existingPayment.downPayment ?? 0);
        const vencimentoEntrada =
          downPayment.dueDate ?? existingPayment.downPaymentDueDate;
        if (valorEntrada > 0 && !vencimentoEntrada) {
          throw new BadRequestException(
            'Informe a data de vencimento da entrada.',
          );
        }
        if (downPayment.amount !== undefined) {
          paymentData.downPayment = orZero(downPayment.amount);
        }
        if (downPayment.paymentConditionId) {
          paymentData.downPaymentCondition = {
            connect: { id: downPayment.paymentConditionId },
          };
        } else {
          paymentData.downPaymentCondition = { disconnect: true };
        }
        if (downPayment.additionalFee !== undefined) {
          paymentData.downPaymentAdditionalFee = orZero(
            downPayment.additionalFee,
          );
        }
        if (downPayment.dueDate) {
          paymentData.downPaymentDueDate = new Date(downPayment.dueDate);
        }
      } else {
        paymentData.downPayment = 0;
        paymentData.downPaymentCondition = { disconnect: true };
        paymentData.downPaymentAdditionalFee = 0;
        paymentData.downPaymentDueDate = null;
      }

      // Handle discount
      if (discount) {
        if (discount.discountType) {
          paymentData.discountType = discount.discountType;
        }
        if (discount.discountValue !== undefined) {
          paymentData.discountValue = orZero(discount.discountValue);
        }
        if (discount.discountTotal !== undefined) {
          paymentData.discountTotal = orZero(discount.discountTotal);
        }
      }

      return await this.executeWithRetry(async () => {
        const updatedPaymentData = await this.prisma.$transaction(
          async (prisma) => {
            // Atualiza o pagamento principal
            const updatedPayment = await prisma.quotationPayment.update({
              where: { quotationId },
              data: paymentData,
            });

            // Delete all existing installments if we have new ones
            if (installments.length > 0) {
              await prisma.quotationInstallment.deleteMany({
                where: { quotationPaymentId: updatedPayment.id },
              });

              // Prepare installments data for batch insert
              const installmentsData = installments
                .filter(
                  (installmentData) =>
                    installmentData.dueDate && installmentData.amount,
                )
                .map((installmentData) => {
                  const installmentPaymentConditionId =
                    installmentData.paymentConditionId || paymentConditionId;
                  // O acréscimo vem do front já em dinheiro (centavos), para
                  // qualquer tipo de taxa: em %, o front aplica a taxa da
                  // venda em Nx sobre a parcela; em R$, o valor por parcela.
                  // Antes, na condição em %, o valor era tratado como taxa e
                  // multiplicado pela parcela: 3% de R$ 50,00 virava
                  // R$ 0,03 ou R$ 25,00, conforme o que o front mandava.
                  // Tudo o que lê o acréscimo depois (a receber, limite de
                  // crédito, financeiro da venda) já o soma como dinheiro.
                  const additionalFee = installmentData.additionalFee || 0;

                  return {
                    quotationPaymentId: updatedPayment.id,
                    dueDate: new Date(installmentData.dueDate),
                    additionalFee,
                    value: installmentData.amount,
                    paymentConditionId: installmentPaymentConditionId,
                  };
                });

              // Create all installments in a single query
              if (installmentsData.length > 0) {
                await prisma.quotationInstallment.createMany({
                  data: installmentsData,
                });
              }
            }

            // Handle commission if provided or explicitly set to null
            if (commission !== undefined) {
              await this.handleCommission(prisma, updatedPayment, commission);
            }

            return updatedPayment;
          },
          {
            timeout: 10000,
            maxWait: 12000,
          },
        );

        return updatedPaymentData;
      });
    } catch (error) {
      // Antes tudo virava um Error genérico: o Nest respondia "Internal server
      // error" e a causa só existia no log. Sem ela, o usuário só via o modal
      // não fechar — e o fluxo de concluir orçamento parava sem explicação.
      if (error instanceof HttpException) throw error;

      const code = (error as { code?: string })?.code;
      this.logger.error(
        `Falha ao atualizar pagamento do orçamento ${quotationId}` +
          (code ? ` (Prisma ${code})` : ''),
        error instanceof Error ? error.stack : String(error),
      );

      if (code === 'P2003') {
        throw new BadRequestException(
          'Forma de pagamento inválida: ela não existe mais ou é de outra empresa. Selecione a forma de pagamento novamente.',
        );
      }

      if (code === 'P2025') {
        throw new BadRequestException(
          'Um registro do pagamento foi removido enquanto a tela estava aberta. Recarregue o orçamento e tente de novo.',
        );
      }

      if (code === 'P2028') {
        throw new InternalServerErrorException(
          'O salvamento demorou demais e foi cancelado. Tente novamente.',
        );
      }

      throw new InternalServerErrorException(
        'Não foi possível salvar as condições de pagamento. Tente novamente; se persistir, avise o suporte.',
      );
    }
  }

  /**
   * Internal method to handle commission within a transaction.
   * Uses the transaction's prisma client to avoid deadlocks.
   */
  private async handleCommission(
    prisma: Prisma.TransactionClient,
    quotationPayment: { id: string; commissionId: string | null },
    commissionData: UpdateCommissionDto,
  ) {
    // If commission value is empty, delete existing commission
    if (
      commissionData.commissionValue === 0 ||
      commissionData.commissionValue === undefined ||
      commissionData.commissionValue === null
    ) {
      if (quotationPayment.commissionId) {
        await prisma.commission.delete({
          where: { id: quotationPayment.commissionId },
        });
      }
      return;
    }

    const commissionPayload = {
      type: commissionData.type,
      supplierId: commissionData.supplier.value,
      transferMethod: commissionData.transferMethod,
      commissionType: commissionData.commissionType,
      commissionValue: commissionData.commissionValue,
      totalCommission: commissionData.totalCommission,
    };

    if (quotationPayment.commissionId) {
      // Update existing commission
      await prisma.commission.update({
        where: { id: quotationPayment.commissionId },
        data: commissionPayload,
      });
    } else {
      // Create new commission and connect to payment
      const newCommission = await prisma.commission.create({
        data: {
          ...commissionPayload,
          quotationPayment: { connect: { id: quotationPayment.id } },
        },
      });
      // Update payment to reference the new commission
      await prisma.quotationPayment.update({
        where: { id: quotationPayment.id },
        data: { commissionId: newCommission.id },
      });
    }
  }

  async updateCommission(
    quotationId: string,
    commissionData: UpdateCommissionDto,
    baseValue?: number,
  ) {
    try {
      // Busca o pagamento relacionado à venda
      const quotationPayment = await this.prisma.quotationPayment.findUnique({
        where: { quotationId },
        include: { commission: true },
      });

      if (!quotationPayment) {
        throw new Error('Pagamento do orçamento não encontrado.');
      }

      if (
        commissionData.commissionValue === 0 ||
        commissionData.commissionValue === undefined ||
        commissionData.commissionValue === null
      ) {
        if (!quotationPayment.commission) {
          return 'Comissão não criada';
        }
        const deletedCommission = await this.prisma.commission.delete({
          where: { id: quotationPayment.commission.id },
        });
        return deletedCommission;
      }

      const commissionPayload: Prisma.CommissionCreateInput = {
        type: commissionData.type,
        supplier: { connect: { id: commissionData.supplier.value } },
        transferMethod: commissionData.transferMethod,
        commissionType: commissionData.commissionType,
        commissionValue: commissionData.commissionValue,
        quotationPayment: { connect: { id: quotationPayment.id } },
        totalCommission: commissionData.totalCommission,
      };
      let updatedCommission;

      if (quotationPayment.commission) {
        updatedCommission = await this.prisma.commission.update({
          where: { id: quotationPayment.commission.id },
          data: commissionPayload,
        });
      } else {
        updatedCommission = await this.prisma.commission.create({
          data: commissionPayload,
        });
      }

      return updatedCommission;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        'Erro ao atualizar comissão: ' + error.message,
      );
    }
  }

  async getPaymentConditionsInUse(companyId: string) {
    const receivablePaymentConditions =
      await this.prisma.receivableInstallment.findMany({
        where: {
          receivable: {
            companyId: companyId,
          },
          paymentConditionId: {
            not: null,
          },
        },
        select: {
          paymentCondition: true,
        },
        distinct: ['paymentConditionId'],
      });

    const payablePaymentConditions =
      await this.prisma.payableInstallment.findMany({
        where: {
          payable: {
            companyId: companyId,
          },
          paymentConditionId: {
            not: null,
          },
        },
        select: {
          paymentCondition: true,
        },
        distinct: ['paymentConditionId'],
      });

    const allPaymentConditions = [
      ...receivablePaymentConditions
        .map((item) => item.paymentCondition)
        .filter(Boolean),
      ...payablePaymentConditions
        .map((item) => item.paymentCondition)
        .filter(Boolean),
    ];

    const uniquePaymentConditions = allPaymentConditions.filter(
      (condition, index, self) =>
        condition && self.findIndex((c) => c?.id === condition.id) === index,
    );

    return uniquePaymentConditions;
  }
}
