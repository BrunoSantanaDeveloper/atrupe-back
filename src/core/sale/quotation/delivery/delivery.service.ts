import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
    if (deliveryType === 'CARRIER' && !createDeliveryInfoDto.supplierId) {
      throw new BadRequestException(
        'Fornecedor é necessário quando o tipo de entrega for Transportadora',
      );
    }

    if (
      createDeliveryInfoDto.clientAddressId === 'custom' &&
      !createDeliveryInfoDto.customAddress
    ) {
      throw new BadRequestException(
        'Endereço customizado é necessário quando clientAddressId for "custom"',
      );
    }

    // Se clientAddressId for "custom", criar um endereço temporário
    let addressId = createDeliveryInfoDto.clientAddressId;

    // Se clientAddressId for string vazia, tratar como null
    if (addressId === '') {
      addressId = null;
    }

    if (
      createDeliveryInfoDto.clientAddressId === 'custom' &&
      createDeliveryInfoDto.customAddress
    ) {
      // Criar endereço temporário na tabela Address
      const customAddress = await this.prisma.address.create({
        data: {
          ...createDeliveryInfoDto.customAddress,
          type: 'CustomForDelivery',
        },
      });
      addressId = customAddress.id;
    }

    // Preparar dados para criar o DeliveryInfo (removendo customAddress)
    const deliveryData: any = { ...createDeliveryInfoDto };
    delete deliveryData.customAddress;

    // Criar o DeliveryInfo
    const deliveryInfo = await this.prisma.deliveryInfo.create({
      data: {
        ...deliveryData,
        quotationId,
        deliveryType,
        clientAddressId: addressId === 'custom' ? null : addressId || null,
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

      // Validações específicas
      // Se está mudando para CARRIER, validar se há supplierId
      if (updateDeliveryInfoDto.deliveryType === 'CARRIER') {
        const finalSupplierId = updateDeliveryInfoDto.hasOwnProperty(
          'supplierId',
        )
          ? updateDeliveryInfoDto.supplierId
          : existingDeliveryInfo.supplierId;

        if (!finalSupplierId) {
          throw new BadRequestException(
            'Fornecedor é necessário quando o tipo de entrega for Transportadora',
          );
        }
      }

      // Se está removendo o supplierId, validar se o tipo de entrega permite
      if (
        updateDeliveryInfoDto.hasOwnProperty('supplierId') &&
        updateDeliveryInfoDto.supplierId === null
      ) {
        const finalDeliveryType =
          updateDeliveryInfoDto.deliveryType ||
          existingDeliveryInfo.deliveryType;

        if (finalDeliveryType === 'CARRIER') {
          throw new BadRequestException(
            'Não é possível remover o fornecedor quando o tipo de entrega é Transportadora',
          );
        }
      }

      if (
        updateDeliveryInfoDto.clientAddressId === 'custom' &&
        !updateDeliveryInfoDto.customAddress
      ) {
        throw new BadRequestException(
          'Endereço customizado é necessário quando clientAddressId for "custom"',
        );
      }

      // Tratar endereço customizado
      let addressId = updateDeliveryInfoDto.clientAddressId;

      // Se clientAddressId for string vazia, tratar como null
      if (addressId === '') {
        addressId = null;
      }

      // Verificar se existe um endereço customizado anterior
      const existingCustomAddress = existingDeliveryInfo.clientAddressId
        ? await this.prisma.address.findFirst({
            where: {
              id: existingDeliveryInfo.clientAddressId,
              type: 'CustomForDelivery',
            },
          })
        : null;

      if (
        updateDeliveryInfoDto.clientAddressId === 'custom' &&
        updateDeliveryInfoDto.customAddress
      ) {
        if (existingCustomAddress) {
          // Atualizar endereço customizado existente
          await this.prisma.address.update({
            where: { id: existingCustomAddress.id },
            data: {
              ...updateDeliveryInfoDto.customAddress,
            },
          });
          addressId = existingCustomAddress.id;
        } else {
          // Criar novo endereço customizado
          const customAddress = await this.prisma.address.create({
            data: {
              ...updateDeliveryInfoDto.customAddress,
              type: 'CustomForDelivery',
            },
          });
          addressId = customAddress.id;
        }
      } else if (
        updateDeliveryInfoDto.clientAddressId &&
        updateDeliveryInfoDto.clientAddressId !== 'custom' &&
        existingCustomAddress
      ) {
        // Se mudou de endereço customizado para endereço de cliente,
        // limpar o endereço customizado anterior
        try {
          await this.prisma.address.delete({
            where: { id: existingCustomAddress.id },
          });
        } catch (error) {
          // Se não conseguir deletar (ex: usado por outros registros),
          // apenas logga o erro e continua
          console.warn(
            'Não foi possível deletar endereço customizado:',
            error.message,
          );
        }
        addressId = updateDeliveryInfoDto.clientAddressId;
      }

      // Preparar dados para atualizar o DeliveryInfo (removendo customAddress)
      const deliveryData: any = { ...updateDeliveryInfoDto };
      delete deliveryData.customAddress;

      // Preparar dados para atualização
      const updateData: any = {
        ...deliveryData,
        clientAddressId: addressId === 'custom' ? null : addressId || null,
      };

      // Se supplierId for explicitamente null, mantém null para desconectar a relação
      if (updateDeliveryInfoDto.hasOwnProperty('supplierId')) {
        updateData.supplierId = updateDeliveryInfoDto.supplierId;
      }

      // Se clientAddressId for string vazia, converter para null
      if (updateData.clientAddressId === '') {
        updateData.clientAddressId = null;
      }

      const updatedDeliveryInfo = await this.prisma.deliveryInfo.update({
        where: { id },
        data: updateData,
      });

      return updatedDeliveryInfo;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
}
