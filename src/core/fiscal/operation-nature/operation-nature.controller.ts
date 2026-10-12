import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { OperationNatureService } from './operation-nature.service';
import {
  CreateOperationNatureDto,
  UpdateOperationNatureDto,
} from './operation-nature.dto';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';

@ApiTags('Fiscal - Naturezas de Operação')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller('fiscal/naturezas') // Note: Path updated as per plan
export class OperationNatureController {
  constructor(private readonly service: OperationNatureService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas as Naturezas de Operação da empresa' })
  async getAll(@Req() req) {
    return this.service.getAll(req.user.companyId);
  }

  @Get(':id')
  @HasPermission('view', 'nota_fiscal:config')
  @TenantResource('operationNature')
  @ApiOperation({ summary: 'Obter Natureza por ID' })
  @ApiParam({ name: 'id', description: 'ID da Natureza' })
  async getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @HasPermission('create', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar nova Natureza' })
  async create(@Req() req, @Body() dto: CreateOperationNatureDto) {
    return this.service.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @HasPermission('edit', 'nota_fiscal:config')
  @TenantResource('operationNature')
  @ApiOperation({ summary: 'Atualizar Natureza' })
  @ApiParam({ name: 'id', description: 'ID da Natureza' })
  async update(@Param('id') id: string, @Body() dto: UpdateOperationNatureDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HasPermission('delete', 'nota_fiscal:config')
  @TenantResource('operationNature')
  @ApiOperation({ summary: 'Excluir Natureza' })
  @ApiParam({ name: 'id', description: 'ID da Natureza' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
