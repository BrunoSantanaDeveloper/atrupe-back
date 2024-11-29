import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ClientService } from './client.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ClientFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'client';

@ApiTags('Clientes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo cliente' })
  @ApiBody({
    description: 'Dados do novo cliente',
    type: CreateClientDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Cliente criado com sucesso.',
  })
  create(@Body() createClientDto: CreateClientDto) {
    return this.clientService.create(createClientDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os clientes' })
  @ApiQuery({ name: 'filter', type: ClientFilterDTO, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de clientes retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: ClientFilterDTO) {
    return this.clientService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Cliente retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.clientService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiBody({
    description: 'Dados para atualização do cliente',
    type: UpdateClientDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Cliente atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.clientService.update(id, updateClientDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Cliente removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.clientService.remove(id);
  }
}
