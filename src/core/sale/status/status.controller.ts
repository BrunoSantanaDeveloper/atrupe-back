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
  Req,
  Query,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { QuotationTag } from '@prisma/client';
import { CreateStatusQuotationDto } from './dto/create-status.dto';
import { StatusService } from './status.service';
import { UpdateStatusQuotationDto } from './dto/update-status.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';

@ApiTags('Status de Orçamento')
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller('sale/status')
@ApiBearerAuth()
// Listar é livre (a lista de orçamentos usa); criar, editar e excluir status é recurso de plano.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class StatusController {
  constructor(private readonly statusQuotationService: StatusService) {}

  @Post()
  @HasPermission('create', 'sales_settings:quotation_status')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_status_configuration')
  @ApiOperation({ summary: 'Criar um novo status de orçamento' })
  @ApiResponse({
    status: 201,
    description: 'Status de orçamento criado com sucesso.',
  })
  create(
    @Body() createStatusQuotationDto: CreateStatusQuotationDto,
    @Req() req,
  ): Promise<QuotationTag> {
    createStatusQuotationDto.companyId = req.user.companyId;
    return this.statusQuotationService.create(createStatusQuotationDto);
  }

  @ApiOperation({ summary: 'Listar todos os status de orçamento' })
  @ApiResponse({ status: 200, description: 'Lista de status de orçamento.' })
  @Get()
  async findAll(@Req() req, @Query() filter: BaseFilterDTO): Promise<any> {
    filter.companyId = req.user.companyId;
    return await this.statusQuotationService.findAll(filter);
  }

  @Get(':id')
  @HasPermission('view', 'sales_settings:quotation_status')
  @TenantResource('quotationTag')
  @ApiOperation({ summary: 'Buscar um status de orçamento específico' })
  @ApiResponse({ status: 200, description: 'Status de orçamento encontrado.' })
  @ApiResponse({
    status: 404,
    description: 'Status de orçamento não encontrado.',
  })
  findOne(@Param('id') id: string): Promise<QuotationTag> {
    return this.statusQuotationService.findOne(id);
  }

  @Patch(':id')
  @HasPermission('edit', 'sales_settings:quotation_status')
  @TenantResource('quotationTag')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_status_configuration')
  @ApiOperation({ summary: 'Atualizar um status de orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Status de orçamento atualizado com sucesso.',
  })
  update(
    @Param('id') id: string,
    @Body() updateStatusQuotationDto: UpdateStatusQuotationDto,
  ): Promise<QuotationTag> {
    return this.statusQuotationService.update(id, updateStatusQuotationDto);
  }

  @Delete(':id')
  @HasPermission('delete', 'sales_settings:quotation_status')
  @TenantResource('quotationTag')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_status_configuration')
  @ApiOperation({ summary: 'Remover um status de orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Status de orçamento removido com sucesso.',
  })
  remove(@Param('id') id: string): Promise<QuotationTag> {
    return this.statusQuotationService.remove(id);
  }
}
