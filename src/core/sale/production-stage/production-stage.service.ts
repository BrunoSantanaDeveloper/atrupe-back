import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class ProductionStageService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.productionStage.findMany();
  }

  findOne(id: string) {
    return this.prisma.productionStage.findUnique({ where: { id } });
  }

  async update(id: string, updateProductionStageDto: UpdateProductionStageDto) {
    const productionStage = await this.prisma.productionStage.findUnique({
      where: { id },
    });

    if (!productionStage) {
      throw new NotFoundException('Etapa de produção nao encontrada');
    }

    updateProductionStageDto.prevStatus = productionStage.status;

    try {
      return await this.prisma.productionStage.update({
        where: { id },
        data: updateProductionStageDto,
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error on update production stage');
    }
  }

  remove(id: string) {
    return this.prisma.productionStage.delete({ where: { id } });
  }
}
