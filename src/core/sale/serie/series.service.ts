import { Injectable } from '@nestjs/common';
import { CreateSeriesDto } from './dto/create-series.dto';
import { PrismaService } from 'nestjs-prisma';
import { UpdateSeriesDto } from './dto/update-serie.dto';

@Injectable()
export class SeriesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateSeriesDto) {
    return this.prisma.saleSeries.create({
      data: {
        ...dto,
      },
    });
  }

  findAll() {
    return this.prisma.saleSeries.findMany();
  }

  findOne(id: string) {
    return this.prisma.saleSeries.findFirst({ where: { id } });
  }

  update(id: string, dto: UpdateSeriesDto) {
    return this.prisma.saleSeries.update({
      where: { id },
      data: dto,
    });
  }

  remove(id: string) {
    return this.prisma.saleSeries.delete({
      where: { id },
    });
  }
}
