import { Injectable } from '@nestjs/common';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { PrismaService } from 'nestjs-prisma';
import { FinancialFlowFilterDTO } from './dto/filter.dto';
import { FinancialFlowResponse } from './dto/flow.dto';

@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateFlowDto) {
    return this.prisma.financialFlow.create({
      data: {
        ...dto,
      },
    });
  }

  async findAll(filter: FinancialFlowFilterDTO) {
    try {
      const where = {};

      // Definindo datas
      if (filter.startDate) where['referenceDate']['gte'] = filter.startDate;
      if (filter.endDate) where['referenceDate']['lte'] = filter.endDate;

      // Adicionando filtros condicionais
      if (filter.bankAccountId) where['bankAccountId'] = filter.bankAccountId;
      if (filter.paymentMethodId)
        where['paymentMethodId'] = filter.paymentMethodId;

      const includes = {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        bankAccount: {
          include: {
            bank: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        paymentMethod: {
          select: {
            id: true,
            name: true,
          },
        },
      };

      // Buscar todos os recebíveis e pagáveis
      const payables = await this.prisma.payable.findMany({
        where: where,
        include: includes,
      });

      const receivables = await this.prisma.receivable.findMany({
        where: where,
        include: includes,
      });

      // Marcar cada item com seu tipo e combinar os arrays
      const combined = [
        ...payables.map((p) => ({ ...p, type: 'payable' })),
        ...receivables.map((r) => ({ ...r, type: 'receivable' })),
      ];

      // Agrupar por data
      const groupedByDate = combined.reduce((acc, curr) => {
        const date = curr.referenceDate.toISOString().split('T')[0];
        acc[date] = acc[date] || {
          items: [],
          date: date,
          total: { payables: 0, receivables: 0 },
        };

        acc[date].items.push(curr);
        acc[date].total[curr.type === 'payable' ? 'payables' : 'receivables'] +=
          curr.amount;

        return acc;
      }, {});

      // Converter o objeto em um array de resultados
      const result: FinancialFlowResponse[] = Object.values(groupedByDate);

      // Ordenar por data
      if (filter.sort === 'ASC') {
        result.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      } else {
        // Por padrão, assume-se DESC se não for 'ASC'
        result.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
      }

      return result;
    } catch (error) {
      console.error(error);
      throw new Error('Error fetching flows');
    }
  }

  findOne(id: string) {
    return this.prisma.financialFlow.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: string, updateFlowDto: UpdateFlowDto) {
    return this.prisma.financialFlow.update({
      where: {
        id,
      },
      data: {
        ...updateFlowDto,
      },
    });
  }

  remove(id: string) {
    return this.prisma.financialFlow.delete({
      where: {
        id,
      },
    });
  }
}
