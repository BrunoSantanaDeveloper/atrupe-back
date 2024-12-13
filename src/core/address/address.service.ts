import { Injectable } from '@nestjs/common';

import { PrismaService } from 'nestjs-prisma';
import { OwnerType } from '@prisma/client';
import { PlugService } from 'src/svc/plug/plug.service';
import { UtilsService } from 'src/svc/utils/utils.service';

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
}
