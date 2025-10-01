/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  Injectable,
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
        if (downPayment.amount !== undefined) {
          paymentData.downPayment = downPayment.amount;
        }
        if (downPayment.paymentConditionId) {
          paymentData.downPaymentCondition = {
            connect: { id: downPayment.paymentConditionId },
          };
        } else {
          paymentData.downPaymentCondition = { disconnect: true };
        }
        if (downPayment.additionalFee !== undefined) {
          paymentData.downPaymentAdditionalFee = downPayment.additionalFee;
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
          paymentData.discountValue = discount.discountValue;
        }
        if (discount.discountTotal !== undefined) {
          paymentData.discountTotal = discount.discountTotal;
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

            // Get payment condition configuration if needed for installments
            let conditionConfig;
            if (paymentConditionId && installments.length > 0) {
              conditionConfig = await prisma.paymentCondition.findUnique({
                where: {
                  id: paymentConditionId,
                },
              });
            }

            // Delete all existing installments if we have new ones
            if (installments.length > 0) {
              await prisma.quotationInstallment.deleteMany({
                where: { quotationPaymentId: updatedPayment.id },
              });

              // Create new installments
              for (const installmentData of installments) {
                if (!installmentData.dueDate || !installmentData.amount) {
                  continue; // Skip invalid installments
                }

                const additionalFee =
                  conditionConfig?.costType === 'VALUE'
                    ? installmentData.additionalFee || 0
                    : ((installmentData.additionalFee || 0) / 100) *
                      installmentData.amount;

                await prisma.quotationInstallment.create({
                  data: {
                    quotationPaymentId: updatedPayment.id,
                    dueDate: new Date(installmentData.dueDate),
                    additionalFee,
                    value: installmentData.amount,
                    ...(paymentConditionId && {
                      paymentConditionId: paymentConditionId,
                    }),
                  },
                });
              }
            }

            // Handle commission if provided or explicitly set to null
            if (commission !== undefined) {
              await this.updateCommission(
                quotationId,
                commission,
                updatedPayment.totalValue,
              );
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
      console.error(error);
      throw new Error('Error updating payment: ' + error.message);
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
        include: { commission: true }, // Inclui a comissão associada, se houver
      });

      if (!quotationPayment) {
        throw new Error('Quotation payment not found.');
      }

      if (
        commissionData.commissionValue === 0 ||
        commissionData.commissionValue === undefined ||
        commissionData.commissionValue === null
      ) {
        if (!quotationPayment.commission) {
          return 'Commission not created';
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
        // Atualiza a comissão existente
        updatedCommission = await this.prisma.commission.update({
          where: { id: quotationPayment.commission.id },
          data: commissionPayload,
        });
      } else {
        // Cria uma nova comissão
        updatedCommission = await this.prisma.commission.create({
          data: commissionPayload,
        });
      }

      // await this.prisma.quotation.update({
      //   where: {
      //     id: quotationId,
      //   },
      // });

      return updatedCommission;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        'Error updating commission: ' + error.message,
      );
    }
  }
}
