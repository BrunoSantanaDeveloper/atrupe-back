import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
  Patch,
} from '@nestjs/common';
import { CreateReasonDto } from './dto/create-cancel-reason.dto';
import { UpdateReasonDto } from './dto/update-cancel-reason.dto';
import { CancelReasonService } from './cancel-reason.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import { CancelReasonFilterDto } from './dto/cancel-reason-filters.dto';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';

const RESOURCE = 'cancel-reason';
// Listar é livre; o cadastro de motivos é recurso de plano.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(RESOURCE)
@ApiTags('Configurações de motivo de cancelamento ou rejeição')
export class CancelReasonController {
  constructor(private readonly cancelReasonService: CancelReasonService) {}

  @ApiOperation({ summary: 'Criar motivo de rejeição ou cancelamento' })
  @ApiResponse({ status: 201, description: 'Motivo criado com sucesso' })
  @ApiResponse({ status: 400, description: 'Requisição inválida' })
  @Post()
  @HasPermission('create', 'sales_settings:rejection_reasons')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_rejection_reasons')
  create(@Req() req, @Body() createReasonDto: CreateReasonDto) {
    createReasonDto.companyId = req.user.companyId;
    return this.cancelReasonService.create(createReasonDto);
  }

  @ApiOperation({
    summary: 'Listar motivos de rejeição ou cancelamento por tipo',
  })
  @ApiResponse({ status: 200, description: 'Motivos listados com sucesso' })
  @Get()
  async findAll(@Req() req, @Query() filter: CancelReasonFilterDto) {
    filter.companyId = req.user.companyId;

    return await this.cancelReasonService.findAllByType(filter);
  }

  @ApiOperation({ summary: 'Editar motivo de rejeição ou cancelamento' })
  @ApiResponse({ status: 200, description: 'Motivo atualizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Requisição inválida' })
  @ApiParam({ name: 'id', description: 'ID do motivo' })
  @Patch(':id')
  @HasPermission('edit', 'sales_settings:rejection_reasons')
  @TenantResource('reasons')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_rejection_reasons')
  update(@Param('id') id: string, @Body() updateReasonDto: UpdateReasonDto) {
    return this.cancelReasonService.update(id, updateReasonDto);
  }

  @ApiOperation({ summary: 'Remover motivo de rejeição ou cancelamento' })
  @ApiResponse({ status: 200, description: 'Motivo removido com sucesso' })
  @ApiParam({ name: 'id', description: 'ID do motivo' })
  @Delete(':id')
  @HasPermission('delete', 'sales_settings:rejection_reasons')
  @TenantResource('reasons')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_rejection_reasons')
  remove(@Param('id') id: string) {
    return this.cancelReasonService.remove(id);
  }
}
