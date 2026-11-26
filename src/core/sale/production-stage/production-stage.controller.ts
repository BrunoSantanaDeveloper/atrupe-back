import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Get,
  Body,
  Patch,
  Post,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductionStageService } from './production-stage.service';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import {
  UpdateItemStageDto,
  FinishAllStagesDto,
  AddScheduleStageDto,
  WorkListQueryDto,
} from './dto/item-stage.dto';

const RESOURCE = 'production-stage';

// Quem concluiu fica gravado na etapa do item (§4.16)
const actorOf = (req: any) => ({
  userId: req.user?.userId ?? null,
  name: req.user?.name ?? null,
});

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

  // A lista de trabalhos do LITE (área 9 §4.16): antes de ':id'
  @Get('work-list')
  @HasPermission('view', 'production:delivery_schedule')
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_production_stages')
  @ApiOperation({ summary: 'Os trabalhos dos setores (lista do LITE)' })
  workList(@Req() req, @Query() query: WorkListQueryDto) {
    return this.productionStageService.workList(req.user.companyId, query);
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
      actorOf(req),
    );
  }

  @Patch('item/:id')
  @HasPermission('edit', 'production:delivery_schedule')
  // Rota nova (§4.7): a permissão já recusa, sem passar pelo modo observar
  @ObservePermissions(false)
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({
    summary: 'Trocar o estado da etapa de um item na agenda (§4.7)',
  })
  updateItem(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateItemStageDto,
  ) {
    return this.productionStageService.updateItem(
      id,
      dto,
      req.user.companyId,
      actorOf(req),
    );
  }

  // Concluir tudo de uma vez (gerencial, §4.7): chave própria no cargo, que
  // já recusa (rota nova, fora do modo observar da classe)
  @Post('finish-all')
  @HasPermission('edit', 'production:delivery_schedule_finish_all')
  @ObservePermissions(false)
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({
    summary: 'Finalizar todas as etapas das agendas escolhidas',
  })
  finishAll(@Req() req, @Body() dto: FinishAllStagesDto) {
    return this.productionStageService.finishAll(
      dto.scheduleIds,
      req.user.companyId,
      actorOf(req),
    );
  }

  // O ícone livre acrescentado no pedido (área 9 §4.16)
  @Post('schedule/:id/stage')
  @HasPermission('edit', 'production:delivery_schedule')
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({ summary: 'Acrescentar um setor ao fluxo do pedido' })
  addToSchedule(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: AddScheduleStageDto,
  ) {
    return this.productionStageService.addToSchedule(
      id,
      dto.stageId,
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
