import { Injectable } from '@nestjs/common';

import { CreateProductionStageDto } from './dto/create-production-stage.dto';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class ProductionStageService {
  constructor(private readonly prisma: PrismaService) {}

  create(createProductionStageDto: CreateProductionStageDto) {
    return this.prisma.productionStage.create({
      data: createProductionStageDto,
    });
  }

  findAll() {
    return this.prisma.productionStage.findMany();
  }

  findOne(id: string) {
    return this.prisma.productionStage.findUnique({ where: { id } });
  }

  update(id: string, updateProductionStageDto: UpdateProductionStageDto) {
    return this.prisma.productionStage.update({
      where: { id },
      data: updateProductionStageDto,
    });
  }

  remove(id: string) {
    return this.prisma.productionStage.delete({ where: { id } });
  }
}
