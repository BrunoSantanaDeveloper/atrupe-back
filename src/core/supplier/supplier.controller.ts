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
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantResource } from '../auth/guards/tenant-resource.decorator';
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
@UseGuards(JwtAuthGuard, PermissionsGuard, TenantGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @HasPermission('create', 'register:supplier')
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

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os fornecedores em seus status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de caixas retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.supplierService.findAllQuantity(companyId);
  }

  @Get()
  @HasPermission('view', 'register:supplier')
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

  @Get('export')
  @HasPermission('export', 'register:supplier')
  @ApiOperation({ summary: 'Obtém os fornecedores filtrados para exportação' })
  @ApiResponse({
    status: 200,
    description: 'Lista de fornecedores para exportação retornada com sucesso.',
  })
  export(@Req() req, @Query() filter: SupplierFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.supplierService.findAllForExport(filter);
  }

  @Get(':id')
  @TenantResource('supplier')
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

  @Patch(':id/toggle-status')
  @TenantResource('supplier')
  @HasPermission('edit', 'register:supplier')
  @ApiOperation({
    summary: 'Alterna o status (ativo/inativo) de um fornecedor',
  })
  @ApiParam({ name: 'id', required: true, description: 'ID do fornecedor' })
  @ApiResponse({
    status: 200,
    description: 'Status do fornecedor alternado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fornecedor não encontrado.',
  })
  toggleStatus(@Param('id') id: string) {
    return this.supplierService.toggleStatus(id);
  }

  @Patch(':id')
  @TenantResource('supplier')
  @HasPermission('edit', 'register:supplier')
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

  @Post(':id/convert-to-client')
  @HasPermission('edit', 'register:supplier')
  @ApiOperation({
    summary: 'Converte um fornecedor em cliente',
    description:
      'Cria um novo cliente com os mesmos dados do fornecedor, se não existir um cliente com o mesmo CPF/CNPJ.',
  })
  @ApiParam({ name: 'id', required: true, description: 'ID do fornecedor' })
  @ApiResponse({
    status: 201,
    description: 'Cliente criado com sucesso a partir do fornecedor.',
  })
  @ApiResponse({
    status: 400,
    description: 'Já existe um cliente com o mesmo CPF/CNPJ.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fornecedor não encontrado.',
  })
  convertToClient(@Req() req, @Param('id') id: string) {
    return this.supplierService.convertToClient(id, req.user.companyId);
  }

  @Delete(':id')
  @TenantResource('supplier')
  @HasPermission('delete', 'register:supplier')
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
