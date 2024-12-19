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
    try {
      const skip = (+page - 1) * +limit;

      const [total, saleSeries] = await Promise.all([
        this.prisma.saleSeries.count({
          where,
        }),
        this.prisma.saleSeries.findMany({
          where,
          orderBy: { title: 'asc' },
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
      return await this.prisma.saleSeries.update({
        where: { id },
        data: updateSaleSeriesDto,
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
}
