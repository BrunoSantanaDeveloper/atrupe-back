import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AddressService } from './address.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { OwnerType } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'address';
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Endereços')
@Controller(RESOURCE)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get('/zipcode/:zipcode')
  @ApiOperation({ summary: 'Busca informações de endereço por CEP' })
  @ApiParam({ name: 'zipcode', required: true, description: 'CEP para busca' })
  @ApiResponse({
    status: 200,
    description: 'Informações do endereço retornadas com sucesso.',
  })
  zipcode(@Param('zipcode') zipcode: string) {
    return this.addressService.zipCode(zipcode);
  }

  @Get('/client/:clientId')
  @ApiOperation({ summary: 'Lista todos os endereços de um cliente' })
  @ApiParam({ name: 'clientId', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Lista de endereços do cliente retornada com sucesso.',
    isArray: true,
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  findClientAddresses(@Param('clientId') clientId: string) {
    return this.addressService.findByOwner(clientId, OwnerType.CLIENT);
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
