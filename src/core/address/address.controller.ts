import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AddressService } from './address.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

const RESOURCE = 'address';
@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get('/zipcode/:zipcode')
  zipcode(@Param('zipcode') zipcode: string) {
    return this.addressService.zipCode(zipcode);
  }

  // @MessagePattern('findAllAddress')
  // findAll() {
  //   return this.addressService.findAll();
  // }

  // @MessagePattern('findOneAddress')
  // findOne(@Payload() id: number) {
  //   return this.addressService.findOne(id);
  // }

  // @MessagePattern('updateAddress')
  // update(@Payload() updateAddressDto: UpdateAddressDto) {
  //   return this.addressService.update(updateAddressDto.id, updateAddressDto);
  // }

  // @MessagePattern('removeAddress')
  // remove(@Payload() id: number) {
  //   return this.addressService.remove(id);
  // }
}
