import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CreateSaleSeriesDto } from './dto/create-series.dto';
import { UpdateSaleSeriesDto } from './dto/update-serie.dto';

@Injectable()
export class SaleSeriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSaleSeriesDto: CreateSaleSeriesDto) {
    return this.prisma.saleSeries.create({ data: createSaleSeriesDto });
  }

  async findAll(companyId) {
    const saleSeries = await this.prisma.saleSeries.findMany({
      where: { isActive: true, companyId },
      orderBy: { title: 'asc' },
    });

    return saleSeries.map((series) => this.formatSeries(series));
  }

  async findOne(id: string) {
    const series = await this.prisma.saleSeries.findUnique({
      where: { id },
    });

    if (!series) {
      throw new Error(`Sale series with ID ${id} not found`);
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

  update(id: string, updateSaleSeriesDto: UpdateSaleSeriesDto) {
    return this.prisma.saleSeries.update({
      where: { id },
      data: updateSaleSeriesDto,
    });
  }

  remove(id: string) {
    return this.prisma.saleSeries.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
