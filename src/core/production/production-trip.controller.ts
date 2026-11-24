import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AbacService } from '../auth/abac/abac.service';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import {
  ProductionAccessService,
  PRODUCTION,
} from './production-access.service';
import { ProductionTripService } from './production-trip.service';
import {
  CancelTripDto,
  CloseTripDto,
  CreateTripDto,
  StartTripDto,
  StopResultDto,
  VehicleRequestDto,
} from './dto/production-trip.dto';

/** Agendar, fechar e cancelar saídas: a chave "Agendar veículos" */
const VEHICLES = 'production:vehicle_schedule';

/**
 * Veículos, fase 1 (Maicol, 23/11/2026, ELITE): as saídas com as paradas,
 * o pedido de veículo e quem estava com o veículo.
 */
@ApiTags('Produção - Veículos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('production_manager')
@Controller('production/trip')
export class ProductionTripController {
  constructor(
    private readonly access: ProductionAccessService,
    private readonly trips: ProductionTripService,
    private readonly abac: AbacService,
  ) {}

  /** Quem agenda os veículos marca qualquer saída; os outros, só a sua. */
  private scheduler(req) {
    return this.abac.hasPermission(req.user, 'edit', VEHICLES);
  }

  @Get()
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTION },
    { action: 'edit', resource: VEHICLES },
  )
  @ApiOperation({ summary: 'As saídas, os pedidos e o que precisa de saída' })
  async overview(
    @Req() req,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.trips.overview(await this.access.viewer(req.user), from, to);
  }

  @Get('who-was')
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTION },
    { action: 'edit', resource: VEHICLES },
  )
  @ApiOperation({ summary: 'Quem estava com o veículo (placa, dia e hora)' })
  async whoWas(
    @Req() req,
    @Query('plate') plate: string,
    @Query('at') at: string,
  ) {
    return this.trips.whoWas(await this.access.viewer(req.user), plate, at);
  }

  @Post()
  @HasPermission('edit', VEHICLES)
  @ApiOperation({ summary: 'Agenda uma saída' })
  async create(@Req() req, @Body() dto: CreateTripDto) {
    return this.trips.create(await this.access.viewer(req.user), dto);
  }

  @Post(':id/start')
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTION },
    { action: 'edit', resource: VEHICLES },
  )
  // O motorista, a equipe ou quem agenda os veículos (o serviço confere)
  @ApiOperation({ summary: 'Saiu: a partida e o odômetro' })
  async start(@Req() req, @Param('id') id: string, @Body() dto: StartTripDto) {
    return this.trips.start(
      await this.access.viewer(req.user),
      id,
      dto,
      await this.scheduler(req),
    );
  }

  @Post(':id/stop/:stopId')
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTION },
    { action: 'edit', resource: VEHICLES },
  )
  // O motorista, a equipe ou quem agenda os veículos (o serviço confere)
  @ApiOperation({ summary: 'Conclui uma parada: feita ou não feita' })
  async stop(
    @Req() req,
    @Param('id') id: string,
    @Param('stopId') stopId: string,
    @Body() dto: StopResultDto,
  ) {
    return this.trips.stopResult(
      await this.access.viewer(req.user),
      id,
      stopId,
      dto,
      await this.scheduler(req),
    );
  }

  @Post(':id/close')
  @HasPermission('edit', VEHICLES)
  @ApiOperation({ summary: 'Fecha na volta: o km repartido pelas paradas' })
  async close(@Req() req, @Param('id') id: string, @Body() dto: CloseTripDto) {
    return this.trips.close(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/cancel')
  @HasPermission('edit', VEHICLES)
  @ApiOperation({ summary: 'Cancela a saída agendada, com o motivo' })
  async cancel(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CancelTripDto,
  ) {
    return this.trips.cancel(await this.access.viewer(req.user), id, dto);
  }

  // Pedir veículo: qualquer setor (a produção, a agenda, o financeiro, as
  // vendas) e quem agenda os veículos (a tela de Veículos)
  @Post('request')
  @HasAnyPermission(
    { action: 'edit', resource: VEHICLES },
    { action: 'view', resource: PRODUCTION },
    { action: 'view', resource: 'production:delivery_schedule' },
    { action: 'view', resource: 'financial:flow' },
    { action: 'view', resource: 'sale:quotation' },
  )
  @ApiOperation({ summary: 'Pede um veículo (motivo, destino, dia)' })
  async request(@Req() req, @Body() dto: VehicleRequestDto) {
    return this.trips.request(await this.access.viewer(req.user), dto);
  }

  @Post('request/:id/cancel')
  @HasPermission('edit', VEHICLES)
  @ApiOperation({ summary: 'Cancela um pedido de veículo' })
  async cancelRequest(@Req() req, @Param('id') id: string) {
    return this.trips.cancelRequest(await this.access.viewer(req.user), id);
  }
}
