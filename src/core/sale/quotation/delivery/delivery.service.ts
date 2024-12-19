import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateDeliveryInfoDto } from './dto/create-delivery.dto';
import { UpdateDeliveryInfoDto } from './dto/update-delivery.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class DeliveryService {
  constructor(private prisma: PrismaService) {}

  async createDeliveryInfo(
    quotationId: string,
    createDeliveryInfoDto: CreateDeliveryInfoDto,
  ) {
    const { deliveryType } = createDeliveryInfoDto;

    // Verificação do tipo de entrega para transportadora
    // if (deliveryType === 'CARRIER' && !supplierId) {
    //   throw new BadRequestException(
    //     'Fornecedor é necessário quando o tipo de entrega for Transportadora',
    //   );
    // }

    // Criar o DeliveryInfo
    const deliveryInfo = await this.prisma.deliveryInfo.create({
      data: {
        ...createDeliveryInfoDto,
        quotationId,
        deliveryType, // Vincular o deliveryTypeId
      },
    });

    return deliveryInfo;
  }

  async updateDeliveryInfo(
    id: string,
    updateDeliveryInfoDto: UpdateDeliveryInfoDto,
  ) {
    try {
      const existingDeliveryInfo = await this.prisma.deliveryInfo.findUnique({
        where: { id },
      });

      if (!existingDeliveryInfo) {
        throw new NotFoundException('Informações de entrega não encontradas');
      }

      // Verificar se o tipo de entrega existe
      // if (updateDeliveryInfoDto.deliveryTypeId) {
      //   const deliveryType = await this.prisma.deliveryType.findUnique({
      //     where: { id: updateDeliveryInfoDto.deliveryTypeId },
      //   });

      //   if (!deliveryType) {
      //     throw new BadRequestException('Tipo de entrega não encontrado');
      //   }

      //   // Verificação do tipo de entrega para transportadora
      //   if (deliveryType.isCarrier && !updateDeliveryInfoDto.supplierId) {
      //     throw new BadRequestException(
      //       'Fornecedor é necessário quando o tipo de entrega for Transportadora',
      //     );
      //   }
      // }

      // Atualizar o DeliveryInfo

      if (updateDeliveryInfoDto.estimatedDate) {
        updateDeliveryInfoDto.estimatedDate = new Date(
          updateDeliveryInfoDto.estimatedDate,
        );
      }
      const updatedDeliveryInfo = await this.prisma.deliveryInfo.update({
        where: { id },
        data: updateDeliveryInfoDto,
      });

      return updatedDeliveryInfo;
    } catch (error) {
      console.error(error);
    }
  }
}
