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
import { CfopService } from './cfop.service';
import { CreateCfopDto, UpdateCfopDto } from './cfop.dto';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';

@ApiTags('Fiscal - CFOPs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller('fiscal/cfops')
export class CfopController {
  constructor(private readonly cfopService: CfopService) {}

  @Get()
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Listar todos os CFOPs da empresa' })
  async getAll(@Req() req) {
    return this.cfopService.getAll(req.user.companyId);
  }

  @Get('active')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Listar CFOPs ativos da empresa' })
  async getActive(@Req() req) {
    return this.cfopService.getActive(req.user.companyId);
  }

  @Get(':id')
  @HasPermission('view', 'nota_fiscal:config')
  @TenantResource('cfopConfig')
  @ApiOperation({ summary: 'Obter CFOP por ID' })
  @ApiParam({ name: 'id', description: 'ID do CFOP' })
  async getById(@Param('id') id: string) {
    return this.cfopService.getById(id);
  }

  @Post()
  @HasPermission('create', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar novo CFOP' })
  async create(@Req() req, @Body() dto: CreateCfopDto) {
    return this.cfopService.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @HasPermission('edit', 'nota_fiscal:config')
  @TenantResource('cfopConfig')
  @ApiOperation({ summary: 'Atualizar CFOP' })
  @ApiParam({ name: 'id', description: 'ID do CFOP' })
  async update(@Param('id') id: string, @Body() dto: UpdateCfopDto) {
    return this.cfopService.update(id, dto);
  }

  @Delete(':id')
  @HasPermission('delete', 'nota_fiscal:config')
  @TenantResource('cfopConfig')
  @ApiOperation({ summary: 'Excluir CFOP' })
  @ApiParam({ name: 'id', description: 'ID do CFOP' })
  async delete(@Param('id') id: string) {
    return this.cfopService.delete(id);
  }
}
