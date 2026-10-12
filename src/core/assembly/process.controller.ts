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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AbacService } from '../auth/abac/abac.service';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { canViewValues } from '../auth/abac/values-visibility.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import {
  CreateFieldDto,
  CreateFormulaDto,
  CreateLineDto,
  CreateOptionDto,
  UpdateFieldDto,
  UpdateFormulaDto,
  UpdateLineDto,
} from './dto/composition.dto';
import {
  CreateProcessDto,
  ProcessFilterDto,
  ProcessSimulationDto,
  ToggleProcessStatusDto,
  UpdateProcessDto,
  UsualNextDto,
} from './dto/process.dto';
import {
  FIELD_NOT_FOUND,
  FORMULA_NOT_FOUND,
  LINE_NOT_FOUND,
  OPTION_NOT_FOUND,
} from './composition-lines';
import { PROCESS_NOT_FOUND, ProcessService } from './process.service';

/**
 * Os processos usam as chaves do cadastro de produtos até a composição ter
 * a dela (contrato, módulo 1: "[ver]" e "[editar]").
 */
const PRODUCTS = 'product_settings:products';
const FEATURE = 'cost_base';

// O id que não é UUID responde como o que não existe
const uuid = (message: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException(message) });
const ProcessId = uuid(PROCESS_NOT_FOUND);
const LineId = uuid(LINE_NOT_FOUND);
const OptionId = uuid(OPTION_NOT_FOUND);
const FieldId = uuid(FIELD_NOT_FOUND);
const FormulaId = uuid(FORMULA_NOT_FOUND);

/**
 * Processos (MS-11): a etapa reutilizável de um setor, com linhas, opções,
 * campos e fórmulas no mesmo formato da composição do produto. Contrato da
 * API, módulo 1, parte A. Plano: `cost_base`.
 *
 * Custo e venda da simulação só para quem tem `values:values:view` (rota
 * nova: a regra vale já, sem modo observar).
 */
@ApiTags('Processos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature(FEATURE)
@Controller('process')
export class ProcessController {
  constructor(
    private readonly service: ProcessService,
    private readonly abacService: AbacService,
  ) {}

  @Get()
  // O orçamento ("Acrescentar a este item") lê só os ativos
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTS },
    { action: 'edit', resource: 'sale:quotation' },
  )
  @ApiOperation({ summary: 'Lista os processos da empresa' })
  async findAll(@Req() req, @Query() filter: ProcessFilterDto) {
    const readsRegistry = await this.abacService.hasPermission(
      req.user,
      'view',
      PRODUCTS,
    );
    return this.service.list(req.user.companyId, filter, {
      onlyActive: !readsRegistry,
    });
  }

  @Get('quantity')
  @HasPermission('view', PRODUCTS)
  @ApiOperation({ summary: 'Contagem de processos ativos e inativos' })
  quantity(@Req() req) {
    return this.service.quantity(req.user.companyId);
  }

  // Antes de qualquer rota com :id
  @Put('usual-next')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Liga ou desliga o par "vem depois de" (FL-7)' })
  setUsualNext(@Req() req, @Body() dto: UsualNextDto) {
    return this.service.setUsualNext(req.user.companyId, dto);
  }

  @Get(':id')
  @HasPermission('view', PRODUCTS)
  @ApiOperation({
    summary: 'Detalhe do processo com a simulação numa medida (mm)',
  })
  async findOne(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Query() simulation: ProcessSimulationDto,
  ) {
    return this.service.detail(req.user.companyId, id, simulation, {
      values: await canViewValues(req, this.abacService),
    });
  }

  @Post()
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Cria um processo vazio (MS-1)' })
  async create(@Req() req, @Body() dto: CreateProcessDto) {
    return this.service.create(req.user.companyId, dto, {
      values: await canViewValues(req, this.abacService),
    });
  }

  @Patch(':id')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Altera a configuração e as regras do processo' })
  update(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Body() dto: UpdateProcessDto,
  ) {
    return this.service.update(req.user.companyId, id, dto);
  }

  @Patch(':id/toggle-status')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Inativa ou reativa o processo (PAD-7)' })
  toggleStatus(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Body() dto: ToggleProcessStatusDto,
  ) {
    return this.service.toggleStatus(req.user.companyId, id, dto.isActive);
  }

  @Get(':id/usage')
  @HasPermission('view', PRODUCTS)
  @ApiOperation({ summary: 'As etapas de produto ligadas ao processo' })
  usage(@Req() req, @Param('id', ProcessId) id: string) {
    return this.service.usage(req.user.companyId, id);
  }

  @Get(':id/usual-next')
  @HasPermission('view', PRODUCTS)
  @ApiOperation({ summary: '"Costuma vir depois de" e etapas seguintes' })
  usualNext(@Req() req, @Param('id', ProcessId) id: string) {
    return this.service.usualNext(req.user.companyId, id);
  }

  /* ----------------------------------------------------------------- linhas */

  @Post(':id/line')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Acrescenta uma linha ao processo' })
  addLine(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Body() dto: CreateLineDto,
  ) {
    return this.service.addLine(req.user.companyId, id, dto);
  }

  @Patch(':id/line/:lineId')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Ajusta uma linha do processo' })
  updateLine(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('lineId', LineId) lineId: string,
    @Body() dto: UpdateLineDto,
  ) {
    return this.service.updateLine(req.user.companyId, id, lineId, dto);
  }

  // Linha de dentro do processo: tirar é editar
  @Delete(':id/line/:lineId')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Tira uma linha do processo' })
  removeLine(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('lineId', LineId) lineId: string,
  ) {
    return this.service.removeLine(req.user.companyId, id, lineId);
  }

  @Post(':id/line/:lineId/option')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Acrescenta uma opção à linha (IP-27)' })
  addOption(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('lineId', LineId) lineId: string,
    @Body() dto: CreateOptionDto,
  ) {
    return this.service.addOption(req.user.companyId, id, lineId, dto);
  }

  @Delete(':id/line/:lineId/option/:optionId')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Tira uma opção da linha' })
  removeOption(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('lineId', LineId) lineId: string,
    @Param('optionId', OptionId) optionId: string,
  ) {
    return this.service.removeOption(req.user.companyId, id, lineId, optionId);
  }

  /* ---------------------------------------------------- campos do orçamento */

  @Post(':id/field')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Cria um campo do orçamento no processo (IP-4)' })
  addField(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Body() dto: CreateFieldDto,
  ) {
    return this.service.addField(req.user.companyId, id, dto);
  }

  @Patch(':id/field/:fieldId')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Altera um campo do orçamento do processo' })
  updateField(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('fieldId', FieldId) fieldId: string,
    @Body() dto: UpdateFieldDto,
  ) {
    return this.service.updateField(req.user.companyId, id, fieldId, dto);
  }

  @Delete(':id/field/:fieldId')
  @HasPermission('edit', PRODUCTS)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um campo que nenhuma linha lê' })
  async removeField(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('fieldId', FieldId) fieldId: string,
  ) {
    await this.service.removeField(req.user.companyId, id, fieldId);
  }

  /* ---------------------------------------------------------------- fórmulas */

  @Post(':id/formula')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Cria uma fórmula do processo (IP-2)' })
  addFormula(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Body() dto: CreateFormulaDto,
  ) {
    return this.service.addFormula(req.user.companyId, id, dto);
  }

  @Patch(':id/formula/:formulaId')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Altera uma fórmula do processo' })
  updateFormula(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('formulaId', FormulaId) formulaId: string,
    @Body() dto: UpdateFormulaDto,
  ) {
    return this.service.updateFormula(req.user.companyId, id, formulaId, dto);
  }

  @Delete(':id/formula/:formulaId')
  @HasPermission('edit', PRODUCTS)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove uma fórmula que nenhuma linha usa' })
  async removeFormula(
    @Req() req,
    @Param('id', ProcessId) id: string,
    @Param('formulaId', FormulaId) formulaId: string,
  ) {
    await this.service.removeFormula(req.user.companyId, id, formulaId);
  }
}
