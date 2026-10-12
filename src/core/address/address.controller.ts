import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AddressService } from './address.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { OwnerType } from '@prisma/client';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
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
  async findClientAddresses(@Req() req, @Param('clientId') clientId: string) {
    await this.addressService.assertClientOfCompany(
      clientId,
      req.user.companyId,
    );
    return this.addressService.findByOwner(clientId, OwnerType.CLIENT);
  }

  @Post('/client/:clientId')
  @ApiOperation({ summary: 'Cria um novo endereço para o cliente' })
  @ApiParam({ name: 'clientId', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 201,
    description: 'Endereço criado com sucesso.',
  })
  async createClientAddress(
    @Req() req,
    @Param('clientId') clientId: string,
    @Body() createAddressDto: CreateAddressDto,
  ) {
    await this.addressService.assertClientOfCompany(
      clientId,
      req.user.companyId,
    );
    return this.addressService.create(
      createAddressDto,
      OwnerType.CLIENT,
      clientId,
    );
  }

  @Patch('/:id')
  @ApiOperation({ summary: 'Atualiza um endereço existente' })
  @ApiParam({ name: 'id', required: true, description: 'ID do endereço' })
  @ApiResponse({
    status: 200,
    description: 'Endereço atualizado com sucesso.',
  })
  update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateAddressDto: UpdateAddressDto,
  ) {
    return this.addressService.update(id, updateAddressDto, req.user.companyId);
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Exclui um endereço existente' })
  @ApiParam({ name: 'id', required: true, description: 'ID do endereço' })
  @ApiResponse({
    status: 200,
    description: 'Endereço excluído com sucesso.',
  })
  delete(@Req() req, @Param('id') id: string) {
    return this.addressService.delete(id, req.user.companyId);
  }
}
