import { Injectable } from '@nestjs/common';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
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

  create(
    createAddressDto: CreateAddressDto,
    ownerType: OwnerType,
    ownerId: string,
  ) {
    // TODO: Implement this method
    console.log(createAddressDto, ownerType, ownerId);
    // return this.prisma.address.create({
    //   data: {
    //     ...createAddressDto,
    //     ownerType,
    //     ownerId,
    //   },
    // });
  }

  async zipCode(zipCode: string) {
    try {
      const data = await this.plugService.zipcode(zipCode);

      const state = await this.prisma.state.findFirst({
        where: { code: data.state.toUpperCase() },
      });

      const city = await this.prisma.city.findFirst({
        where: { name: data.city.toUpperCase() },
      });

      return {
        zipcode: data.zipCode,
        street: data.street,
        neighborhood: data.neighborhood,
        city: data.city,
        cityId: city.id,
        stateId: state.id,
        state: state.name,
      };
    } catch (error) {
      return error;
    }
  }

  findAll() {
    return `This action returns all address`;
  }

  findOne(id: number) {
    return `This action returns a #${id} address`;
  }

  update(id: number, updateAddressDto: UpdateAddressDto) {
    return `This action updates a #${id} address with ${updateAddressDto}`;
  }

  remove(id: number) {
    return `This action removes a #${id} address`;
  }
}
