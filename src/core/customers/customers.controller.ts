import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

/**
 * Cliente de cobrança (Asaas) de cada empresa. Nenhuma tela usa estas
 * rotas; a contratação cria o cliente por dentro. Abertas a qualquer usuário
 * logado, listavam os clientes de cobrança de todas as empresas, com a
 * empresa inteira, e alteravam ou apagavam o de outra pelo id (no Asaas
 * também). Ficam com o superadmin.
 */
@Controller('customers')
@ApiTags('Customers')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@ApiBearerAuth()
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Criar um novo cliente' })
  @ApiBody({ type: CreateCustomerDto })
  @ApiResponse({
    status: 201,
    description: 'Cliente criado com sucesso',
    type: CreateCustomerDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos',
  })
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos os clientes' })
  @ApiResponse({
    status: 200,
    description: 'Lista de clientes retornada com sucesso',
    type: [CreateCustomerDto],
  })
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar um cliente pelo ID' })
  @ApiParam({
    name: 'id',
    description: 'ID do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Cliente encontrado com sucesso',
    type: CreateCustomerDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado',
  })
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um cliente' })
  @ApiParam({
    name: 'id',
    description: 'ID do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({ type: UpdateCustomerDto })
  @ApiResponse({
    status: 200,
    description: 'Cliente atualizado com sucesso',
    type: CreateCustomerDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado',
  })
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover um cliente' })
  @ApiParam({
    name: 'id',
    description: 'ID do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 204,
    description: 'Cliente removido com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado',
  })
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
