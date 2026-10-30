import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  DeliveryDto,
  PeriodDto,
  ProjectFilterDto,
} from './dto/production-task.dto';
import {
  PRODUCTION,
  ProductionAccessService,
} from './production-access.service';
import { ProductionBoardService } from './production-board.service';
import { ProductionProjectService } from './production-project.service';

/**
 * O gerenciador de produção (módulo 3, ELITE): as abas e o quadro de cada
 * gerenciador, a agenda viva, os projetos e a produtividade. Quem é gerente
 * e o que cada um vê decide o servidor, pela sessão (GP-11).
 */
@ApiTags('Produção')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
// A tela por setor do PRO (sector_board) lê o mesmo gerenciador; a agenda
// com hora e a produtividade são do ELITE (GP-46, GP-47)
@RequiresFeature(['production_manager', 'sector_board'])
@Controller('production')
export class ProductionController {
  constructor(
    private readonly access: ProductionAccessService,
    private readonly board: ProductionBoardService,
    private readonly projects: ProductionProjectService,
  ) {}

  // Fora do contrato (aditiva): a agenda e o diálogo da tarefa precisam de
  // quem é o usuário sem abrir um quadro
  @Get('viewer')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Quem é o usuário da sessão na produção' })
  async viewer(@Req() req) {
    const viewer = await this.access.viewer(req.user);
    return {
      collaboratorId: viewer.employeeId,
      name: viewer.name,
      manager: viewer.manager,
      timeEditor: viewer.timeEditor,
      productivity: viewer.productivity,
    };
  }

  @Get('manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Os gerenciadores com abertas e alertas' })
  async managers(@Req() req) {
    return this.board.managers(await this.access.viewer(req.user));
  }

  @Get('manager/:id/board')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'O quadro do gerenciador' })
  async managerBoard(@Req() req, @Param('id') id: string) {
    return this.board.board(await this.access.viewer(req.user), id);
  }

  @Get('agenda')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'A agenda viva e a ocupação dos veículos' })
  async agenda(@Req() req, @Query() query: PeriodDto) {
    return this.board.agenda(await this.access.viewer(req.user), query);
  }

  @Get('productivity')
  @RequiresFeature('productivity_tracking')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Produtividade pelo tempo vendido' })
  async productivity(@Req() req, @Query() query: PeriodDto) {
    return this.board.productivity(await this.access.viewer(req.user), query);
  }

  @Get('project')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Os projetos, por situação' })
  async listProjects(@Req() req, @Query() query: ProjectFilterDto) {
    return this.projects.list(await this.access.viewer(req.user), query);
  }

  // Antes de project/:id
  @Get('project/quantity')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Quantos projetos em cada situação' })
  quantity(@Req() req) {
    return this.projects.quantity(req.user.companyId);
  }

  @Get('project/:id')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'O projeto com as tarefas' })
  async project(@Req() req, @Param('id') id: string) {
    return this.projects.detail(await this.access.viewer(req.user), id);
  }

  @Post('project/:id/release')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Libera a produção (GP-8)' })
  async release(@Req() req, @Param('id') id: string) {
    return this.projects.release(await this.access.viewer(req.user), id);
  }

  @Post('project/:id/finish')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Conclui o projeto' })
  async finish(@Req() req, @Param('id') id: string) {
    return this.projects.finish(await this.access.viewer(req.user), id);
  }

  @Post('project/:id/cancel')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Cancela o projeto e as tarefas abertas' })
  async cancel(@Req() req, @Param('id') id: string) {
    return this.projects.cancel(await this.access.viewer(req.user), id);
  }

  @Patch('project/:id/delivery')
  @HasPermission('edit', PRODUCTION)
  @ApiOperation({ summary: 'Altera a entrega do projeto' })
  async delivery(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: DeliveryDto,
  ) {
    return this.projects.changeDelivery(
      await this.access.viewer(req.user),
      id,
      dto.due,
    );
  }
}
