import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';

@Injectable()
export class UnitOfMeasureService {
  constructor(private readonly prisma: PrismaService) {}

  create(createUnitOfMeasureDto: CreateUnitOfMeasureDto) {
    return this.prisma.unitOfMeasure.create({
      data: {
        ...createUnitOfMeasureDto,
      },
    });
  }

  findAll() {
    return this.prisma.unitOfMeasure.findMany({});
  }

  findOne(id: string) {
    return this.prisma.unitOfMeasure.findUnique({
      where: { id },
    });
  }

  update(id: string, updateUnitOfMeasureDto: UpdateUnitOfMeasureDto) {
    return this.prisma.unitOfMeasure.update({
      where: { id },
      data: updateUnitOfMeasureDto,
    });
  }

  remove(id: string) {
    return `This action removes a #${id} unitOfMeasure`;
  }
}
