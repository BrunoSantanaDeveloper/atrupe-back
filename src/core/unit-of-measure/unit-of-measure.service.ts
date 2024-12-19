import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';

@Injectable()
export class UnitOfMeasureService {
  constructor(private readonly prisma: PrismaService) {}

  create(createUnitOfMeasureDto: CreateUnitOfMeasureDto) {
    return this.prisma.companyUnitOfMeasure.create({
      data: {
        ...createUnitOfMeasureDto,
      },
    });
  }

  findAll(companyId: string) {
    return this.prisma.companyUnitOfMeasure.findMany({
      where: { companyId },
      orderBy: {
        name: 'asc',
      },
    });
  }

  findOne(id: string) {
    return this.prisma.companyUnitOfMeasure.findUnique({
      where: { id },
    });
  }

  update(id: string, updateUnitOfMeasureDto: UpdateUnitOfMeasureDto) {
    return this.prisma.companyUnitOfMeasure.update({
      where: { id },
      data: updateUnitOfMeasureDto,
    });
  }

  remove(id: string) {
    return `This action removes a #${id} unitOfMeasure`;
  }
}
