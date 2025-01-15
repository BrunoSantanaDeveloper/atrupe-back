import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { PrismaService } from 'nestjs-prisma';
import { FinancialFlowFilterDTO } from './dto/filter.dto';

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
  async findAll(paginationDto: FinancialFlowFilterDTO) {
    const {
      page = 1,
      limit = 10,
      search,
      startDate,
      endDate,
      status,
      paymentMethodId,
      sort = 'DESC',
      dateType = 'dueDate',
      showValues = 'ON',
    } = paginationDto;

    if (!['dueDate', 'paidDate'].includes(dateType)) {
      throw new BadRequestException(
        'Invalid dateType. Use "dueDate" or "paidDate".',
      );
    }
    const filtersReceivables: any = {
      receivable: {
        companyId: paginationDto.companyId,
      },
    };
    const filtersPayables: any = {
      payable: {
        companyId: paginationDto.companyId,
      },
    };
    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      filtersReceivables[dateType] = dateFilter;
      filtersPayables[dateType] = dateFilter;
    }

    // Filtro de status
    if (status) {
      filtersReceivables.status = status;
      filtersPayables.status = status;
    }

    // Filtro de método de pagamento
    if (paymentMethodId) {
      filtersReceivables.paymentMethodId = paymentMethodId;
      filtersPayables.paymentMethodId = paymentMethodId;
    }

    // Filtro de busca
    if (search) {
      filtersReceivables.OR = [
        { client: { name: { contains: search, mode: 'insensitive' } } },
      ];
      filtersPayables.OR = [
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    try {
      // Buscar dados agrupados para recebíveis
      const [receivablesGrouped, payablesGrouped] =
        dateType === 'dueDate'
          ? await this.fetchDataDueDate(
              filtersReceivables,
              filtersPayables,
              showValues,
            )
          : await this.fetchDataPaidDate(
              filtersReceivables,
              filtersPayables,
              showValues,
            );
      console.log(receivablesGrouped);
      // Extrair as datas para busca detalhada
      const dueDates = [
        ...new Set([
          ...receivablesGrouped.map((g) => g[dateType]?.toISOString()),
          ...payablesGrouped.map((g) => g[dateType]?.toISOString()),
        ]),
      ];
      const receivableDetails =
        await this.prisma.receivableInstallment.findMany({
          where: {
            [dateType]: { in: dueDates.map((d) => new Date(d)) },
            ...filtersReceivables,
          },
          orderBy: { [dateType]: sort.toLowerCase() },
          include: {
            receivable: {
              include: {
                client: true,
                nature: true,
                subCategory: true,
                installments: { orderBy: { [dateType]: 'desc' } },
              },
            },
          },
        });

      const payableDetails = await this.prisma.payableInstallment.findMany({
        where: {
          [dateType]: { in: dueDates.map((d) => new Date(d)) },
          ...filtersPayables,
        },
        orderBy: { [dateType]: sort.toLowerCase() },
        include: {
          payable: {
            include: {
              supplier: true,
              nature: true,
              subCategory: true,
              installments: { orderBy: { [dateType]: 'desc' } },
            },
          },
        },
      });

      const groupedData = dueDates.map((date) => {
        const receivables = receivableDetails
          .filter((inst) => inst[dateType]?.toISOString() === date)
          .map((inst) => ({
            type: 'receivable',
            id: inst.receivable.id,
            description: inst.receivable.description || '',
            client: inst.receivable.client
              ? {
                  id: inst.receivable.client.id,
                  name: inst.receivable.client.name,
                }
              : null,
            nature: inst.receivable.nature
              ? {
                  id: inst.receivable.nature.id,
                  name: inst.receivable.nature.name,
                }
              : null,
            subCategory: inst.receivable.subCategory
              ? {
                  id: inst.receivable.subCategory.id,
                  name: inst.receivable.subCategory.name,
                }
              : null,
            installments:
              showValues === 'ON'
                ? inst.receivable.installments.map((i) => ({
                    id: i.id,
                    value: i.amount || 0,
                    paidValue: i.paidAmount || 0,
                    dueDate: i.dueDate,
                  }))
                : [],
          }));

        const payables = payableDetails
          .filter((inst) => inst[dateType]?.toISOString() === date)
          .map((inst) => ({
            type: 'payable',
            id: inst.payable.id,
            description: inst.payable.description || '',
            supplier: inst.payable.supplier
              ? {
                  id: inst.payable.supplier.id,
                  name: inst.payable.supplier.name,
                }
              : null,
            nature: inst.payable.nature
              ? { id: inst.payable.nature.id, name: inst.payable.nature.name }
              : null,
            subCategory: inst.payable.subCategory
              ? {
                  id: inst.payable.subCategory.id,
                  name: inst.payable.subCategory.name,
                }
              : null,
            installments:
              showValues === 'ON'
                ? inst.payable.installments.map((i) => ({
                    id: i.id,
                    value: i.amount || 0,
                    paidValue: i.paidAmount || 0,
                    dueDate: i.dueDate,
                  }))
                : [],
          }));

        return {
          date: new Date(date),
          transactions: [...receivables, ...payables],
        };
      });

      const total = groupedData.length;
      const lastPage = Math.ceil(total / +limit);

      return {
        total,
        lastPage,
        data: groupedData.slice((+page - 1) * +limit, +page * +limit),
      };
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Error fetching financial flow data',
      );
    }
  }

  private async fetchDataDueDate(
    filtersReceivables,
    filtersPayables,
    showValues,
  ) {
    const receivablesGrouped = await this.prisma.receivableInstallment.groupBy({
      by: ['dueDate'],
      where: filtersReceivables,
      orderBy: { dueDate: 'desc' },
      _sum:
        showValues === 'ON' ? { amount: true, additionalFee: true } : undefined,
      _count: true,
    });

    const payablesGrouped = await this.prisma.payableInstallment.groupBy({
      by: ['dueDate'], // Adiciona o campo de agrupamento conforme o `dateType`
      where: filtersPayables,
      orderBy: { dueDate: 'desc' },
      _sum:
        showValues === 'ON' ? { amount: true, additionalFee: true } : undefined,
      _count: true,
    });

    return [receivablesGrouped, payablesGrouped];
  }
  private async fetchDataPaidDate(
    filtersReceivables,
    filtersPayables,
    showValues,
  ) {
    filtersReceivables = {
      ...filtersReceivables,
      paidDate: {
        not: null,
      },
    };
    filtersPayables = {
      ...filtersPayables,
      paidDate: {
        not: null,
      },
    };
    const receivablesGrouped = await this.prisma.receivableInstallment.groupBy({
      by: ['paidDate'],
      where: filtersReceivables,
      orderBy: { paidDate: 'desc' },
      _sum:
        showValues === 'ON' ? { amount: true, additionalFee: true } : undefined,
      _count: true,
    });

    const payablesGrouped = await this.prisma.payableInstallment.groupBy({
      by: ['paidDate'], // Adiciona o campo de agrupamento conforme o `dateType`
      where: filtersPayables,
      orderBy: { paidDate: 'desc' },
      _sum:
        showValues === 'ON' ? { amount: true, additionalFee: true } : undefined,
      _count: true,
    });

    return [receivablesGrouped, payablesGrouped];
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
