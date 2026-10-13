import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AbacService } from '../auth/abac/abac.service';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import {
  PermissionsGuard,
  permissionDenied,
} from '../auth/abac/permissions.guard';
import {
  VALUES_PERMISSION,
  canViewValues,
} from '../auth/abac/values-visibility.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { CostBaseService } from './cost-base.service';
import {
  AdminExpenseFilterDto,
  ComparisonFilterDto,
  DistributionDto,
  ExpenseAllocationDto,
  LaborHoursDto,
  SectorAllocationDto,
  UpdateAdminExpenseDto,
} from './dto/cost-base.dto';

const BASE = 'cost:base';

// O id que não é UUID responde como o que não existe
const AccountId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Conta não encontrada'),
});
const SectorId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Setor não encontrado'),
});

/**
 * A base de custos (módulo 4, PRO). Tela de método (SEG-6): `cost:base`, a
 * base de custos no plano e, em todas as rotas, ver valores; sem valores,
 * 403 (aqui tudo é valor). O acesso fica no registro de atividade; as
 * escritas, no histórico de custo (SEG-4).
 */
@ApiTags('Base de custos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('cost_base')
@Controller('cost-base')
export class CostBaseController {
  constructor(
    private readonly costBase: CostBaseService,
    private readonly abac: AbacService,
  ) {}

  private async session(req) {
    if (!(await canViewValues(req, this.abac))) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
    return {
      companyId: req.user.companyId as string,
      userId: (req.user.userId as string) ?? null,
    };
  }

  /* --------------------------------------------- despesas administrativas */

  @Get('admin-expense')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Contas administrativas com as médias' })
  async adminExpenses(@Req() req, @Query() filter: AdminExpenseFilterDto) {
    const { companyId } = await this.session(req);
    return this.costBase.adminExpenses(companyId, filter);
  }

  @Get('admin-expense/totals')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Totais das despesas administrativas' })
  async adminExpenseTotals(@Req() req) {
    const { companyId } = await this.session(req);
    return this.costBase.adminExpenseTotals(companyId);
  }

  @Patch('admin-expense/:id')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Troca o critério da conta' })
  async updateAdminExpense(
    @Req() req,
    @Param('id', AccountId) id: string,
    @Body() dto: UpdateAdminExpenseDto,
  ) {
    const { companyId, userId } = await this.session(req);
    return this.costBase.updateAdminExpense(companyId, userId, id, dto);
  }

  @Get('admin-expense/:id/allocation')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Rateio da conta entre os setores produtivos' })
  async expenseAllocation(@Req() req, @Param('id', AccountId) id: string) {
    const { companyId } = await this.session(req);
    return this.costBase.expenseAllocation(companyId, id);
  }

  @Put('admin-expense/:id/allocation')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Grava o rateio por item da conta (BC-8)' })
  async updateExpenseAllocation(
    @Req() req,
    @Param('id', AccountId) id: string,
    @Body() dto: ExpenseAllocationDto,
  ) {
    const { companyId, userId } = await this.session(req);
    return this.costBase.updateExpenseAllocation(companyId, userId, id, dto);
  }

  /* --------------------------------------------- por setor e resumo */

  @Get('sector')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Custo de cada setor por origem' })
  async sectors(@Req() req) {
    const { companyId } = await this.session(req);
    return this.costBase.sectors(companyId);
  }

  @Get('sector/allocation')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Rateio entre os equipamentos de cada setor' })
  async sectorAllocations(@Req() req) {
    const { companyId } = await this.session(req);
    return this.costBase.sectorAllocations(companyId);
  }

  @Put('sector/:id/allocation')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Troca o critério do rateio do setor' })
  async updateSectorAllocation(
    @Req() req,
    @Param('id', SectorId) id: string,
    @Body() dto: SectorAllocationDto,
  ) {
    const { companyId, userId } = await this.session(req);
    return this.costBase.updateSectorAllocation(companyId, userId, id, dto);
  }

  @Get('summary')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Resumo do custo mensal da empresa' })
  async summary(@Req() req) {
    const { companyId } = await this.session(req);
    return this.costBase.summary(companyId);
  }

  /* --------------------------------------------- distribuição */

  @Get('distribution')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Distribuição do administrativo' })
  async distribution(@Req() req) {
    const { companyId } = await this.session(req);
    return this.costBase.distribution(companyId);
  }

  @Put('distribution')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Grava o percentual de cada setor produtivo' })
  async updateDistribution(@Req() req, @Body() dto: DistributionDto) {
    const { companyId, userId } = await this.session(req);
    return this.costBase.updateDistribution(companyId, userId, dto);
  }

  /* --------------------------------------------- mão de obra */

  @Get('labor')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Custo-hora de cada setor produtivo' })
  async labor(@Req() req) {
    const { companyId } = await this.session(req);
    return this.costBase.labor(companyId);
  }

  @Put('labor/:sectorId/hours')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Grava as horas de cada colaborador do setor' })
  async updateLaborHours(
    @Req() req,
    @Param('sectorId', SectorId) sectorId: string,
    @Body() dto: LaborHoursDto,
  ) {
    const { companyId, userId } = await this.session(req);
    return this.costBase.updateLaborHours(companyId, userId, sectorId, dto);
  }

  /* --------------------------------------------- patrimônios e comparativo */

  @Get('depreciation')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Totais de depreciação dos bens ativos' })
  async depreciation(@Req() req) {
    const { companyId } = await this.session(req);
    return this.costBase.depreciation(companyId);
  }

  @Get('comparison')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Previsto × realizado por conta' })
  async comparison(@Req() req, @Query() filter: ComparisonFilterDto) {
    const { companyId } = await this.session(req);
    return this.costBase.comparison(companyId, filter);
  }
}
