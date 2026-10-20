import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AbacService } from '../auth/abac/abac.service';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import { ASSET_MONEY_FIELDS } from '../auth/abac/money-fields';
import { ObservePermissions } from '../auth/abac/observe-permissions.decorator';
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
import { AssetGroupService, GROUP_NOT_FOUND } from './asset-group.service';
import {
  ASSET_NOT_FOUND,
  AssetService,
  READING_NOT_FOUND,
} from './asset.service';
import {
  AssetAccountsDto,
  AssetCostDto,
  AssetFilterDto,
  AssetReadingDto,
  AssetSetupDto,
  CreateAssetDto,
  CreateAssetGroupDto,
  GroupFilterDto,
  ReadingFilterDto,
  RenameAssetGroupDto,
  SellAssetDto,
  ToggleAssetDto,
  UpdateAssetCostDto,
  UpdateAssetDto,
  UpdateAssetSetupDto,
} from './dto/asset.dto';

const BASE = 'cost:base';

// O id que não é UUID responde como o que não existe
const AssetId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException(ASSET_NOT_FOUND),
});
const GroupId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException(GROUP_NOT_FOUND),
});
const ItemId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Item não encontrado'),
});
const ReadingId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException(READING_NOT_FOUND),
});

/**
 * Patrimônios (módulo 4, PRO): cadastro, depreciação, custos, configurações
 * produtivas, venda e grupos de bens equivalentes. Tela de método (SEG-6):
 * `cost:base`, a base de custos no plano e, para escrever, ver valores. Sem
 * `values:values:view`, a leitura sai sem os valores. O acesso fica no
 * registro de atividade; as escritas, no histórico de custo (SEG-4).
 */
@ApiTags('Patrimônios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('cost_base')
@Controller('asset')
export class AssetController {
  constructor(
    private readonly assets: AssetService,
    private readonly groups: AssetGroupService,
    private readonly abac: AbacService,
  ) {}

  // Escrever custo pede também ver valores
  private async writer(req) {
    if (!(await canViewValues(req, this.abac))) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
    return { companyId: req.user.companyId, userId: req.user.userId };
  }

  /* --------------------------------------------- rotas literais antes de :id */

  @Get()
  @HasPermission('view', BASE)
  @MoneyFields(...ASSET_MONEY_FIELDS)
  @ApiOperation({ summary: 'Lista os patrimônios com a depreciação' })
  async findAll(@Req() req, @Query() filter: AssetFilterDto) {
    return this.assets.list(
      req.user.companyId,
      filter,
      await canViewValues(req, this.abac),
    );
  }

  @Get('accounts')
  @HasPermission('view', BASE)
  @ApiOperation({
    summary: 'Contas do plano para custo (payable) e venda (receivable)',
  })
  accounts(@Req() req, @Query() query: AssetAccountsDto) {
    return this.assets.accounts(req.user.companyId, query.type);
  }

  @Get('quantity')
  @HasPermission('view', BASE)
  @ApiOperation({ summary: 'Contagem por situação' })
  quantity(@Req() req) {
    return this.assets.quantity(req.user.companyId);
  }

  @Get('group')
  @HasPermission('view', BASE)
  @MoneyFields(...ASSET_MONEY_FIELDS)
  @ApiOperation({ summary: 'Grupos de bens equivalentes' })
  async findGroups(@Req() req, @Query() filter: GroupFilterDto) {
    return this.groups.list(
      req.user.companyId,
      filter,
      await canViewValues(req, this.abac),
    );
  }

  // A tela usa cost:base:edit no botão "novo": as duas valem (ALT-6)
  @Post('group')
  @HasAnyPermission(
    { action: 'create', resource: BASE },
    { action: 'edit', resource: BASE },
  )
  @ApiOperation({ summary: 'Cria um grupo de bens equivalentes' })
  async createGroup(@Req() req, @Body() dto: CreateAssetGroupDto) {
    const { companyId, userId } = await this.writer(req);
    return this.groups.create(companyId, userId, dto);
  }

  @Patch('group/:id')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Renomeia o grupo' })
  async renameGroup(
    @Req() req,
    @Param('id', GroupId) id: string,
    @Body() dto: RenameAssetGroupDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.groups.rename(companyId, userId, id, dto);
  }

  @Delete('group/:id')
  @HttpCode(204)
  @HasPermission('delete', BASE)
  @ApiOperation({ summary: 'Exclui o grupo vazio' })
  async removeGroup(@Req() req, @Param('id', GroupId) id: string) {
    await this.groups.remove(req.user.companyId, req.user.userId, id);
  }

  /* ------------------------------------------------------------------ bem */

  @Get(':id')
  @HasPermission('view', BASE)
  @MoneyFields(...ASSET_MONEY_FIELDS)
  @ApiOperation({ summary: 'O bem com custos, configurações e processos' })
  async findOne(@Req() req, @Param('id', AssetId) id: string) {
    return this.assets.detail(
      req.user.companyId,
      id,
      await canViewValues(req, this.abac),
    );
  }

  @Post()
  @HasAnyPermission(
    { action: 'create', resource: BASE },
    { action: 'edit', resource: BASE },
  )
  @ApiOperation({ summary: 'Cadastro rápido do patrimônio' })
  async create(@Req() req, @Body() dto: CreateAssetDto) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.create(companyId, userId, dto);
  }

  @Patch(':id')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Edita o patrimônio' })
  async update(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.update(companyId, userId, id, dto);
  }

  @Patch(':id/toggle-status')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Inativa ou reativa o bem (nunca exclui)' })
  async toggle(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Body() dto: ToggleAssetDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.toggle(companyId, userId, id, dto);
  }

  @Post(':id/sell')
  @HttpCode(200)
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Vende o bem e lança a receita' })
  async sell(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Body() dto: SellAssetDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.sell(companyId, userId, id, dto);
  }

  /* -------------------------------------------------------- custos do bem */

  @Post(':id/cost')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Lança um custo do bem' })
  async addCost(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Body() dto: AssetCostDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.addCost(companyId, userId, id, dto);
  }

  // PATCH e DELETE do custo não estão no contrato (só o POST): acrescentados
  @Patch(':id/cost/:costId')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Edita um custo do bem' })
  async updateCost(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Param('costId', ItemId) costId: string,
    @Body() dto: UpdateAssetCostDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.updateCost(companyId, userId, id, costId, dto);
  }

  @Delete(':id/cost/:costId')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Retira um custo do bem' })
  async removeCost(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Param('costId', ItemId) costId: string,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.removeCost(companyId, userId, id, costId);
  }

  /* --------------------------------------------- configurações produtivas */

  @Post(':id/setup')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Cria uma configuração produtiva' })
  async addSetup(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Body() dto: AssetSetupDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.addSetup(companyId, userId, id, dto);
  }

  @Patch(':id/setup/:setupId')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Edita uma configuração produtiva' })
  async updateSetup(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Param('setupId', ItemId) setupId: string,
    @Body() dto: UpdateAssetSetupDto,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.updateSetup(companyId, userId, id, setupId, dto);
  }

  @Delete(':id/setup/:setupId')
  @HasPermission('edit', BASE)
  @ApiOperation({ summary: 'Retira uma configuração produtiva' })
  async removeSetup(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Param('setupId', ItemId) setupId: string,
  ) {
    const { companyId, userId } = await this.writer(req);
    return this.assets.removeSetup(companyId, userId, id, setupId);
  }

  /* ------------------------------------------------- leituras do contador */

  // Rotas novas: a permissão já recusa. A leitura não é valor (sai para
  // quem vê o patrimônio); gravar e apagar seguem as escritas do bem
  @Get(':id/readings')
  @HasPermission('view', BASE)
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Leituras do contador do bem' })
  readings(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Query() filter: ReadingFilterDto,
  ) {
    return this.assets.readings(req.user.companyId, id, filter);
  }

  @Post(':id/readings')
  @HasPermission('edit', BASE)
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Grava o que o contador do bem marcava no dia' })
  async addReading(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Body() dto: AssetReadingDto,
  ) {
    const { companyId } = await this.writer(req);
    return this.assets.addReading(companyId, req.user, id, dto);
  }

  @Delete(':id/readings/:readingId')
  @HttpCode(204)
  @HasPermission('edit', BASE)
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Apaga uma leitura do contador' })
  async removeReading(
    @Req() req,
    @Param('id', AssetId) id: string,
    @Param('readingId', ReadingId) readingId: string,
  ) {
    const { companyId, userId } = await this.writer(req);
    await this.assets.removeReading(companyId, userId, id, readingId);
  }
}
