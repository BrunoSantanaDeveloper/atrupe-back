import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CreateSaleSeriesDto } from './dto/create-series.dto';
import { UpdateSaleSeriesDto } from './dto/update-serie.dto';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

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

  async findAll(filter: BaseFilterDTO) {
    const { companyId, page, limit } = filter;
    console.log(page, limit);
    try {
      const skip = (+page - 1) * +limit;

      const [total, saleSeries] = await Promise.all([
        this.prisma.saleSeries.count({
          where: { companyId },
        }),
        this.prisma.saleSeries.findMany({
          where: { companyId },
          orderBy: { title: 'asc' },
          skip,
          take: +limit,
        }),
      ]);

      return {
        total,
        lastPage: Math.ceil(total / +limit),
        saleSeries: saleSeries.map((series) => this.formatSeries(series)),
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
    return {
      ...series,
      billing: {
        value: series.billing,
        label: this.toCapitalCase(series.billing),
      },
      sendToProduction: {
        value: series.sendToProduction,
        label: this.toCapitalCase(series.sendToProduction),
      },
      productionStatus: {
        value: series.productionStatus,
        label: this.toCapitalCase(series.productionStatus),
      },
    };
  }
  private toCapitalCase(value: string | null): string | null {
    if (!value) return null;

    const all = value.split('-').join(' ');
    return all[0].toUpperCase() + all.slice(1);
  }

  async update(id: string, updateSaleSeriesDto: UpdateSaleSeriesDto) {
    try {
      return await this.prisma.saleSeries.update({
        where: { id },
        data: updateSaleSeriesDto,
      });
    } catch (error) {
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
