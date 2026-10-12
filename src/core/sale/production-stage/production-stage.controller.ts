import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductionStageService } from './production-stage.service';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';

const RESOURCE = 'production-stage';

@ApiTags('Estágios de produção - Agenda de entrega')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(`sale/${RESOURCE}`)
export class ProductionStageController {
  constructor(
    private readonly productionStageService: ProductionStageService,
  ) {}

  // @Post()
  // @ApiOperation({ summary: 'Criar um estágio de produção' })
  // @ApiResponse({ status: 201, description: 'Estágio criado com sucesso.' })
  // create(@Body() createProductionStageDto: CreateProductionStageDto) {
  //   return this.productionStageService.create(createProductionStageDto);
  // }

  @Get()
  @HasPermission('view', 'production:delivery_schedule')
  @ApiOperation({ summary: 'Listar todos os estágios de produção' })
  findAll(@Req() req) {
    return this.productionStageService.findAll(req.user.companyId);
  }

  @Get(':id')
  @HasPermission('view', 'production:delivery_schedule')
  @ApiOperation({ summary: 'Buscar um estágio de produção pelo ID' })
  findOne(@Req() req, @Param('id') id: string) {
    return this.productionStageService.findOne(id, req.user.companyId);
  }

  @Patch(':id')
  @HasPermission('edit', 'production:delivery_schedule')
  // Mudar o status das etapas na agenda é recurso de plano.
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({ summary: 'Atualizar um estágio de produção' })
  update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateProductionStageDto: UpdateProductionStageDto,
  ) {
    return this.productionStageService.update(
      id,
      updateProductionStageDto,
      req.user.companyId,
    );
  }

  @Get('schedule/:id')
  @HasPermission('edit', 'production:delivery_schedule')
  // Mudar o status das etapas na agenda é recurso de plano.
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({ summary: 'Atualizar um estágio de produção' })
  async updateSchedule(@Req() req, @Param('id') id: string) {
    return await this.productionStageService.updateScheduleOfCompany(
      id,
      req.user.companyId,
    );
  }

  @Delete(':id')
  @HasAnyPermission(
    { action: 'edit', resource: 'production:delivery_schedule' },
    { action: 'delete', resource: 'production:delivery_schedule' },
  )
  // Mudar o status das etapas na agenda é recurso de plano.
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({ summary: 'Excluir um estágio de produção' })
  remove(@Req() req, @Param('id') id: string) {
    return this.productionStageService.remove(id, req.user.companyId);
  }
}
