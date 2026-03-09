import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  ReceivableWithInstallments,
  PayableWithInstallments,
  InstallmentStatusCheck,
} from './financial.types';

@Injectable()
export class BaseTransactionService {
  private readonly logger = new Logger(BaseTransactionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna o status real da parcela considerando atraso.
   */
  getActualStatus(installment: InstallmentStatusCheck): string {
    if (
      installment.status === 'PENDING' &&
      new Date(installment.dueDate) < new Date()
    ) {
      return 'OVERDUE';
    }
    return installment.status;
  }

  /**
   * Aplica o status dinâmico na parcela.
   */
  applyDynamicStatus<T extends InstallmentStatusCheck>(
    installment: T,
  ): T & { status: string } {
    return {
      ...installment,
      status: this.getActualStatus(installment),
    };
  }

  /**
   * Cancela um receivable e suas parcelas PENDING em transação.
   */
  async cancelReceivableWithInstallments(
    receivable: ReceivableWithInstallments,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = receivable.installments
      .filter((installment) => installment.status === 'PENDING')
      .map((installment) =>
        this.prisma.receivableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.receivable.update({
        where: { id: receivable.id },
        data: {
          status: 'CANCELED',
          cancelReason: reason,
          cancelNotes: `Título cancelado em ${new Date().toLocaleDateString()}`,
        },
      }),
    ]);
  }

  /**
   * Cancela um payable e suas parcelas PENDING em transação.
   */
  async cancelPayableWithInstallments(
    payable: PayableWithInstallments,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = payable.installments
      .filter((installment) => installment.status === 'PENDING')
      .map((installment) =>
        this.prisma.payableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.payable.update({
        where: { id: payable.id },
        data: {
          status: 'CANCELED',
          cancelReason: reason,
          cancelNotes: `Título cancelado em ${new Date().toLocaleDateString()}`,
        },
      }),
    ]);
  }

  /**
   * Reativa um receivable cancelado e suas parcelas CANCELED.
   */
  async reactivateReceivableWithInstallments(
    receivable: ReceivableWithInstallments,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = receivable.installments
      .filter((installment) => installment.status === 'CANCELED')
      .map((installment) =>
        this.prisma.receivableInstallment.update({
          where: { id: installment.id },
          data: { status: 'PENDING' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.receivable.update({
        where: { id: receivable.id },
        data: {
          status: 'PENDING',
          changeReason: reason,
          changeNotes: `Título reativado em ${new Date().toLocaleDateString()}`,
          cancelReason: null,
          cancelNotes: null,
        },
      }),
    ]);
  }

  /**
   * Reativa um payable cancelado e suas parcelas CANCELED.
   */
  async reactivatePayableWithInstallments(
    payable: PayableWithInstallments,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = payable.installments
      .filter((installment) => installment.status === 'CANCELED')
      .map((installment) =>
        this.prisma.payableInstallment.update({
          where: { id: installment.id },
          data: { status: 'PENDING' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.payable.update({
        where: { id: payable.id },
        data: {
          status: 'PENDING',
          changeReason: reason,
          changeNotes: `Título reativado em ${new Date().toLocaleDateString()}`,
          cancelReason: null,
          cancelNotes: null,
        },
      }),
    ]);
  }

  /**
   * Cancela todos os títulos financeiros relacionados a uma venda (quotationId).
   */
  async cancelRelatedFinancials(quotationId: string): Promise<void> {
    try {
      let canceledCount = 0;

      // 1. Cancela comissões através do relacionamento Commission -> Payable
      const commissions = await this.prisma.commission.findMany({
        where: {
          quotationPayment: {
            quotationId,
          },
          payable: {
            status: { not: 'CANCELED' },
          },
        },
        include: {
          payable: {
            include: {
              installments: true,
            },
          },
        },
      });

      for (const commission of commissions) {
        if (!commission.payable) continue;
        await this.cancelPayableWithInstallments(
          commission.payable,
          'Cancelamento automático - título da venda cancelado',
        );
        canceledCount++;
      }

      // 2. Cancela entradas (receivables de entrada)
      const downPaymentReceivables = await this.prisma.receivable.findMany({
        where: {
          quotationId,
          status: { not: 'CANCELED' },
          financialType: 'DOWN_PAYMENT',
        },
        include: {
          installments: true,
        },
      });

      for (const receivable of downPaymentReceivables) {
        await this.cancelReceivableWithInstallments(
          receivable,
          'Cancelamento automático - título da venda cancelado',
        );
        canceledCount++;
      }

      // 3. Cancela entregas (payables de entrega)
      const deliveryPayables = await this.prisma.payable.findMany({
        where: {
          quotationId,
          status: { not: 'CANCELED' },
          financialType: 'DELIVERY',
        },
        include: {
          installments: true,
        },
      });

      for (const payable of deliveryPayables) {
        await this.cancelPayableWithInstallments(
          payable,
          'Cancelamento automático - título da venda cancelado',
        );
        canceledCount++;
      }

      this.logger.log(
        `${canceledCount} títulos relacionados cancelados para a venda ${quotationId}`,
      );
    } catch (error) {
      this.logger.error(
        'Erro ao cancelar títulos relacionados',
        error.stack,
      );
    }
  }

  /**
   * Reativa todos os títulos financeiros relacionados a uma venda (quotationId).
   */
  async reactivateRelatedFinancials(quotationId: string): Promise<void> {
    try {
      let reactivatedCount = 0;

      // 1. Reativa comissões canceladas automaticamente
      const commissions = await this.prisma.commission.findMany({
        where: {
          quotationPayment: {
            quotationId,
          },
          payable: {
            status: 'CANCELED',
            cancelReason:
              'Cancelamento automático - título da venda cancelado',
          },
        },
        include: {
          payable: {
            include: {
              installments: true,
            },
          },
        },
      });

      for (const commission of commissions) {
        if (!commission.payable) continue;
        await this.reactivatePayableWithInstallments(
          commission.payable,
          'Reativação automática - título da venda reativado',
        );
        reactivatedCount++;
      }

      // 2. Reativa entradas (receivables de entrada)
      const downPaymentReceivables = await this.prisma.receivable.findMany({
        where: {
          quotationId,
          status: 'CANCELED',
          cancelReason:
            'Cancelamento automático - título da venda cancelado',
          financialType: 'DOWN_PAYMENT',
        },
        include: {
          installments: true,
        },
      });

      for (const receivable of downPaymentReceivables) {
        await this.reactivateReceivableWithInstallments(
          receivable,
          'Reativação automática - título da venda reativado',
        );
        reactivatedCount++;
      }

      // 3. Reativa entregas (payables de entrega)
      const deliveryPayables = await this.prisma.payable.findMany({
        where: {
          quotationId,
          status: 'CANCELED',
          cancelReason:
            'Cancelamento automático - título da venda cancelado',
          financialType: 'DELIVERY',
        },
        include: {
          installments: true,
        },
      });

      for (const payable of deliveryPayables) {
        await this.reactivatePayableWithInstallments(
          payable,
          'Reativação automática - título da venda reativado',
        );
        reactivatedCount++;
      }

      this.logger.log(
        `${reactivatedCount} títulos relacionados reativados para a venda ${quotationId}`,
      );
    } catch (error) {
      this.logger.error(
        'Erro ao reativar títulos relacionados',
        error.stack,
      );
    }
  }
}
