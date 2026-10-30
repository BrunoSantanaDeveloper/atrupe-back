import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import {
  CalendarDto,
  CollaboratorRoleDto,
  InactivateManagerDto,
  ManagerDto,
  ManagerUserDto,
  StepOrderDto,
  TaskStepDto,
  TaskTypeDto,
  ToggleActiveDto,
  VehicleDto,
} from './dto/production-config.dto';
import { PRODUCTION } from './production-access.service';
import { ProductionConfigService } from './production-config.service';

/**
 * Configurações › Produção (módulo 3, ELITE): gerenciadores, acesso e
 * perfil dos colaboradores, tipos de tarefa com as etapas, e a frota. Tudo
 * da empresa da sessão; escrever pede `production:production:edit`.
 */
@ApiTags('Produção')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature(['production_manager', 'sector_board'])
@Controller('production')
export class ProductionConfigController {
  constructor(private readonly config: ProductionConfigService) {}

  @Get('config')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({
    summary: 'Fluxos, gerenciadores, tipos, colaboradores e veículos',
  })
  getConfig(@Req() req) {
    return this.config.config(req.user.companyId);
  }

  @Post('manager')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Cria um gerenciador' })
  createManager(@Req() req, @Body() dto: ManagerDto) {
    return this.config.createManager(req.user.companyId, dto);
  }

  @Put('manager/:id')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Edita um gerenciador' })
  updateManager(@Req() req, @Param('id') id: string, @Body() dto: ManagerDto) {
    return this.config.updateManager(req.user.companyId, id, dto);
  }

  @Post('manager/:id/inactivate')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Inativa e passa as etapas para outro (GP-15)' })
  inactivateManager(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: InactivateManagerDto,
  ) {
    return this.config.inactivateManager(
      req.user.companyId,
      id,
      dto.destinationId,
    );
  }

  @Post('manager/:id/reactivate')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Reativa o gerenciador' })
  reactivateManager(@Req() req, @Param('id') id: string) {
    return this.config.reactivateManager(req.user.companyId, id);
  }

  @Put('manager/:id/user/:collaboratorId')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'O acesso do colaborador ao gerenciador (GP-11)' })
  setManagerUser(
    @Req() req,
    @Param('id') id: string,
    @Param('collaboratorId') collaboratorId: string,
    @Body() dto: ManagerUserDto,
  ) {
    return this.config.setManagerUser(
      req.user.companyId,
      id,
      collaboratorId,
      dto,
    );
  }

  @Patch('collaborator/:id')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'O perfil do colaborador na produção' })
  setCollaboratorRole(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CollaboratorRoleDto,
  ) {
    return this.config.setCollaboratorRole(req.user.companyId, id, dto);
  }

  @Post('task-type')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Cria o tipo de tarefa com a primeira etapa' })
  createTaskType(@Req() req, @Body() dto: TaskTypeDto) {
    return this.config.createTaskType(req.user.companyId, dto);
  }

  @Put('task-type/:id')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Edita nome, liberação e controle de tempo' })
  updateTaskType(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: TaskTypeDto,
  ) {
    return this.config.updateTaskType(req.user.companyId, id, dto);
  }

  @Patch('task-type/:id/toggle-status')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Ativa ou inativa o tipo de tarefa' })
  toggleTaskType(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: ToggleActiveDto,
  ) {
    return this.config.toggleTaskType(req.user.companyId, id, dto.active);
  }

  @Put('task-type/:id/step-order')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Grava a sequência inteira das etapas' })
  orderSteps(@Req() req, @Param('id') id: string, @Body() dto: StepOrderDto) {
    return this.config.orderSteps(req.user.companyId, id, dto);
  }

  @Post('task-type/:id/step')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Acrescenta uma etapa no fim' })
  addStep(@Req() req, @Param('id') id: string, @Body() dto: TaskStepDto) {
    return this.config.addStep(req.user.companyId, id, dto);
  }

  @Patch('task-type/:id/step/:stepId')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Edita a etapa' })
  updateStep(
    @Req() req,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: TaskStepDto,
  ) {
    return this.config.updateStep(req.user.companyId, id, stepId, dto);
  }

  @Delete('task-type/:id/step/:stepId')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Remove a etapa (linha do registro: :edit)' })
  removeStep(
    @Req() req,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    return this.config.removeStep(req.user.companyId, id, stepId);
  }

  @Put('calendar')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'O expediente: dias, horário e feriados (§4.8)' })
  updateCalendar(@Req() req, @Body() dto: CalendarDto) {
    return this.config.updateCalendar(req.user.companyId, dto);
  }

  @Post('vehicle')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Cadastra um veículo (VS-7)' })
  createVehicle(@Req() req, @Body() dto: VehicleDto) {
    return this.config.createVehicle(req.user.companyId, dto);
  }

  @Put('vehicle/:id')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Edita o veículo' })
  updateVehicle(@Req() req, @Param('id') id: string, @Body() dto: VehicleDto) {
    return this.config.updateVehicle(req.user.companyId, id, dto);
  }

  @Patch('vehicle/:id/toggle-status')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Ativa ou inativa o veículo' })
  toggleVehicle(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: ToggleActiveDto,
  ) {
    return this.config.toggleVehicle(req.user.companyId, id, dto.active);
  }
}
