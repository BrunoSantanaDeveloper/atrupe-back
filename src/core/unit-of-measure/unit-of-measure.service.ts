import { Injectable } from '@nestjs/common';
import { UnitOfMeasureFilterDTO } from './dto/filter.dto';
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

  findAll(filter: UnitOfMeasureFilterDTO) {
    let where = {};
    if (filter.companyId) {
      where = { ...where, companyId: filter.companyId };
    }
    return this.prisma.unitOfMeasure.findMany({
      where: where,
    });
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
