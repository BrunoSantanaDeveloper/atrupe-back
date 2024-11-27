import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import {
  AddInstallmentArrayDto,
  UpdateReceivableDto,
  UpdateReceivableInstallmentDto,
} from './dto/update-receivable.dto';

@Injectable()
export class ReceivableService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReceivableDto) {
    const { installments, ...receivableData } = dto;

    if (installments.length === 0) {
      throw new Error('At least one installment is required.');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const totalAmount = installments
          .reduce((sum, installment) => {
            const additionalFee = installment.additionalFee ?? 0;
            return sum + installment.amount + additionalFee;
          }, 0)
          .toFixed(2);

        const receivable = await tx.receivable.create({
          data: {
            ...receivableData,
            dueDate: new Date(receivableData.dueDate),
            referenceDate: new Date(receivableData.referenceDate),
            totalAmount: parseFloat(totalAmount),
            installmentQty: installments.length,
          },
        });

        // Cria as parcelas vinculadas
        await tx.receivableInstallment.createMany({
          data: installments.map((installment, index) => ({
            ...installment,
            installmentNumber: index + 1,
            dueDate: new Date(installment.dueDate),
            receivableId: receivable.id,
          })),
        });

        return receivable;
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error creating receivable' + error.message);
    }
  }

  async findAll(paginationDto: BaseFilterDTO) {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (+page - 1) * +limit;

    return this.prisma.receivable.findMany({
      skip,
      take: +limit,
      include: { installments: true },
    });
  }

  async findOne(id: string) {
    const receivable = await this.prisma.receivable.findUnique({
      where: { id },
      include: { installments: true },
    });
    if (!receivable)
      throw new NotFoundException('Conta a receber não encontrada.');
    return receivable;
  }

  async updateTitle(id: string, dto: UpdateReceivableDto) {
    try {
      const updatedReceivable = await this.prisma.receivable.update({
        where: { id },
        data: dto,
      });

      return updatedReceivable;
    } catch (error) {
      console.error('Error updating receivable title:', error);
      throw new Error('Failed to update receivable title.');
    }
  }

  async updateInstallments(
    id: string,
    installmentId: string,
    updateData: UpdateReceivableInstallmentDto,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        let totalAmountChanged = false;

        // Atualiza a parcela específica
        const { amount, ...rest } = updateData;

        // Atualiza a parcela
        await tx.receivableInstallment.update({
          where: { id: installmentId },
          data: {
            ...rest,
            dueDate: new Date(rest.dueDate),
            // Se o valor da parcela for enviado, atualiza o valor
            ...(amount && { amount }),
          },
        });

        // Verifica se o valor da parcela foi alterado
        if (amount) {
          totalAmountChanged = true;
        }

        // Atualiza o valor total do título, se necessário
        if (totalAmountChanged) {
          const updatedTotal = await tx.receivableInstallment.aggregate({
            where: { receivableId: id },
            _sum: { amount: true },
          });

          await tx.receivable.update({
            where: { id },
            data: {
              totalAmount: parseFloat(updatedTotal._sum.amount.toFixed(2)),
            },
          });
        }
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error updating installment' + error.message);
    }
  }

  async addInstallments(
    receivableId: string,
    newInstallments: AddInstallmentArrayDto,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // Busca a quantidade atual de parcelas para determinar o próximo installmentNumber
      const existingInstallments = await tx.receivableInstallment.findMany({
        where: { receivableId },
        orderBy: { installmentNumber: 'asc' }, // Certifica que as parcelas estão em ordem
      });

      const nextInstallmentNumber = existingInstallments.length + 1;

      // Adiciona as novas parcelas
      await tx.receivableInstallment.createMany({
        data: newInstallments.installments.map((installment, index) => ({
          ...installment,
          receivableId,
          dueDate: new Date(installment.dueDate), // Ajusta a data para o formato correto
          installmentNumber: nextInstallmentNumber + index, // Gera o número da parcela dinamicamente
        })),
      });

      // Recalcula o valor total do título, incluindo taxas adicionais
      const updatedTotal = await tx.receivableInstallment.aggregate({
        where: { receivableId },
        _sum: {
          amount: true,
          additionalFee: true,
        },
      });

      const totalAmount =
        (updatedTotal._sum.amount ?? 0) +
        (updatedTotal._sum.additionalFee ?? 0);

      // Atualiza o título com o novo valor total e quantidade de parcelas
      await tx.receivable.update({
        where: { id: receivableId },
        data: {
          totalAmount: parseFloat(totalAmount.toFixed(2)), // Formata para dois dígitos
          installmentQty:
            existingInstallments.length + newInstallments.installments.length,
        },
      });
    });
  }

  async removeInstallment(receivableId: string, installmentId: string) {
    return await this.prisma.$transaction(async (tx) => {
      // Remove a parcela específica
      await tx.receivableInstallment.delete({
        where: { id: installmentId },
      });

      // Atualiza o valor total e a quantidade de parcelas
      const updatedTotal = await tx.receivableInstallment.aggregate({
        where: { receivableId },
        _sum: { amount: true },
      });

      const updatedQty = await tx.receivableInstallment.count({
        where: { receivableId },
      });

      await tx.receivable.update({
        where: { id: receivableId },
        data: {
          totalAmount: parseFloat(updatedTotal._sum.amount?.toFixed(2) || '0'),
          installmentQty: updatedQty,
        },
      });
    });
  }

  async cancel(id: string, cancelReason: string) {
    const receivable = await this.findOne(id);

    // Verifica se o título já está cancelado
    if (receivable.status === 'CANCELED') {
      throw new Error('A conta a receber já foi cancelada.');
    }

    // Atualiza o status de todas as parcelas com status "PENDING" para "CANCELED"
    const updates = receivable.installments
      .filter((installment) => installment.status === 'PENDING')
      .map((installment) =>
        this.prisma.receivableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    // Realiza a transação
    await this.prisma.$transaction(updates);
    await this.prisma.receivable.update({
      where: { id },
      data: {
        status: 'CANCELED',
        cancelReason,
      },
    });
    return { message: 'Conta a receber cancelada com sucesso.' };
  }

  async remove(id: string) {
    await this.prisma.receivableInstallment.deleteMany({
      where: { receivableId: id },
    });
    await this.prisma.receivableHistory.deleteMany({
      where: { receivableId: id },
    });
    return await this.prisma.receivable.delete({ where: { id } });
  }

  async count() {
    return this.prisma.receivable.count();
  }
}
