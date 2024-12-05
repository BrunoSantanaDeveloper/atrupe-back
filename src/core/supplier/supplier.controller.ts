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
  Req,
} from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SupplierFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CreateClientDto } from '../client/dto/create-client.dto';
import { UpdateClientDto } from '../client/dto/update-client.dto';

const RESOURCE = 'supplier';

@ApiTags('Fornecedores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo fornecedor' })
  @ApiBody({
    description: 'Dados do novo fornecedor',
    type: CreateClientDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Fornecedor criado com sucesso.',
  })
  create(@Req() req, @Body() createSupplierDto: CreateSupplierDto) {
    createSupplierDto.companyId = req.user.companyId;
    return this.supplierService.create(createSupplierDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os fornecedores' })
  @ApiResponse({
    status: 200,
    description: 'Lista de fornecedores retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() filter: SupplierFilterDTO) {
    filter.companyId = req.user.companyId;
    return await this.supplierService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um fornecedor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do fornecedor' })
  @ApiResponse({
    status: 200,
    description: 'Fornecedor retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fornecedor não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.supplierService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um fornecedor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do fornecedor' })
  @ApiBody({
    description: 'Dados para atualização do fornecedor',
    type: UpdateClientDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Fornecedor atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fornecedor não encontrado.',
  })
  update(
    @Param('id') id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
  ) {
    return this.supplierService.update(id, updateSupplierDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um fornecedor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do fornecedor' })
  @ApiResponse({
    status: 200,
    description: 'Fornecedor removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fornecedor não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.supplierService.remove(id);
  }
}
