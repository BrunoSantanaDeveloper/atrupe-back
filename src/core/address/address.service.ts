import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { PrismaService } from 'nestjs-prisma';
import { OwnerType } from '@prisma/client';
import { PlugService } from 'src/svc/plug/plug.service';
import { UtilsService } from 'src/svc/utils/utils.service';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugService: PlugService,
    private readonly utilsService: UtilsService,
  ) {}

  async create(address: any, ownerType: OwnerType, ownerId: string) {
    return this.prisma.address.create({
      data: {
        type: address.type,
        zipcode: address.zipcode,
        state: address.state,
        city: address.city,
        neighborhood: address.neighborhood,
        street: address.street,
        number: address.number,
        complement: address.complement,
        ownerType,
        ownerId,
      },
    });
  }

  async findByOwner(ownerId: string, ownerType: OwnerType) {
    return this.prisma.address.findMany({
      where: {
        ownerId,
        ownerType,
      },
      orderBy: {
        type: 'asc',
      },
    });
  }

  async zipCode(zipCode: string) {
    try {
      const data = await this.plugService.zipcode(zipCode);
      return {
        zipcode: data.zipCode,
        street: data.street,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
      };
    } catch (error) {
      return error;
    }
  }

  async deleteByOwner(ownerId: string, ownerType: OwnerType) {
    return this.prisma.address.deleteMany({
      where: { ownerId, ownerType },
    });
  }

  async update(id: string, data: UpdateAddressDto) {
    const address = await this.prisma.address.findUnique({
      where: { id },
    });
    if (!address) {
      throw new NotFoundException('Endereço não encontrado.');
    }
    return this.prisma.address.update({
      where: { id },
      data: {
        type: data.type,
        zipcode: data.zipcode,
        state: data.state,
        city: data.city,
        neighborhood: data.neighborhood,
        street: data.street,
        number: data.number,
        complement: data.complement,
      },
    });
  }

  async delete(id: string) {
    const address = await this.prisma.address.findUnique({
      where: { id },
    });
    if (!address) {
      throw new NotFoundException('Endereço não encontrado.');
    }

    const count = await this.prisma.address.count({
      where: {
        ownerId: address.ownerId,
        ownerType: address.ownerType,
      },
    });

    if (count <= 1) {
      throw new BadRequestException(
        'Não é possível excluir o único endereço cadastrado.',
      );
    }

    return this.prisma.address.delete({
      where: { id },
    });
  }
}
