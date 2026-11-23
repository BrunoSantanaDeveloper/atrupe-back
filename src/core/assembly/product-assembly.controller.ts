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
import { PlanControlService } from '../plan/plan-control.service';
import {
  FIELD_NOT_FOUND,
  FORMULA_NOT_FOUND,
  LINE_NOT_FOUND,
  OPTION_NOT_FOUND,
} from './composition-lines';
import {
  AssemblyQueryDto,
  CreateAssemblyVariationDto,
  CreateBlockDto,
  NextStepQueryDto,
  PartCandidateQueryDto,
  ProductCreateFieldDto,
  ProductCreateFormulaDto,
  ProductCreateLineDto,
  ProductCreateOptionDto,
  ProductUpdateFieldDto,
  ProductUpdateFormulaDto,
  ProductUpdateLineDto,
  UpdateAssemblyDto,
  UpdateBlockDto,
  VariationRefDto,
} from './dto/assembly.dto';
import {
  BLOCK_NOT_FOUND,
  PRODUCT_NOT_FOUND,
  ProductAssemblyService,
} from './product-assembly.service';

// Chave própria da composição (D18); a migração a deu a quem via ou
// editava produtos
const COMPOSITION_KEY = 'product_settings:composition';
const COMPOSITION = 'product_composition';

// O id que não é UUID responde como o que não existe
const uuid = (message: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException(message) });
const ProductId = uuid(PRODUCT_NOT_FOUND);
const BlockId = uuid(BLOCK_NOT_FOUND);
const LineId = uuid(LINE_NOT_FOUND);
const OptionId = uuid(OPTION_NOT_FOUND);
const FieldId = uuid(FIELD_NOT_FOUND);
const FormulaId = uuid(FORMULA_NOT_FOUND);

/**
 * A composição do produto (CP-17), com o cálculo no servidor (SEG-1).
 * Contrato da API, módulo 1, parte A. Plano: `cost_base` na classe e
 * `product_composition` nas rotas da composição (as duas são exigidas; o
 * decorator com lista aceitaria qualquer uma).
 *
 * Custo e venda só para quem tem `values:values:view` (rota nova: a regra
 * vale já, sem modo observar).
 */
@ApiTags('Composição do produto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('cost_base')
@Controller('product')
export class ProductAssemblyController {
  constructor(
    private readonly service: ProductAssemblyService,
    private readonly abacService: AbacService,
    private readonly planControl: PlanControlService,
  ) {}

  private async ctx(
    req: any,
    productId: string,
    variationId?: string | null,
    composition = true,
  ) {
    if (composition) {
      await this.planControl.enforceFeature(req.user.companyId, COMPOSITION);
    }
    return { companyId: req.user.companyId, productId, variationId };
  }

  /* ---------------------------------------------------------------- leitura */

  @Get(':id/assembly')
  @HasPermission('view', COMPOSITION_KEY)
  @ApiOperation({ summary: 'A composição calculada numa medida (mm)' })
  async read(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Query() query: AssemblyQueryDto,
  ) {
    return this.service.read(
      await this.ctx(req, id, query.variationId),
      query,
      { values: await canViewValues(req, this.abacService) },
    );
  }

  @Get(':id/assembly/next-step')
  @HasPermission('view', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Processos para a próxima etapa (FL-7)' })
  async nextStep(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Query() query: NextStepQueryDto,
  ) {
    return this.service.nextStep(
      await this.ctx(req, id, query.variationId, false),
      query,
    );
  }

  @Get(':id/assembly/part-candidate')
  @HasPermission('view', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Produtos que podem entrar como parte (IP-9)' })
  async partCandidates(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Query() query: PartCandidateQueryDto,
  ) {
    return this.service.partCandidates(
      await this.ctx(req, id, null, false),
      query,
    );
  }

  /* ---------------------------------------------------------- cabeçalho */

  @Patch(':id/assembly')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Situação, dimensão e renomear etapas' })
  async updateHeader(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: UpdateAssemblyDto,
  ) {
    return this.service.updateHeader(
      await this.ctx(req, id, dto.variationId),
      dto,
    );
  }

  @Post(':id/assembly/adopt-suggested-price')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Adota o preço sugerido (CP-16, DC-14)' })
  async adoptSuggestedPrice(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: VariationRefDto,
  ) {
    // O preço é valor: só quem vê valores adota
    if (!(await canViewValues(req, this.abacService))) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
    return this.service.adoptSuggestedPrice(
      await this.ctx(req, id, dto.variationId, false),
    );
  }

  /* ------------------------------------------------------------- etapas */

  @Post(':id/assembly/block')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Acrescenta uma etapa' })
  async addBlock(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: CreateBlockDto,
  ) {
    return this.service.addBlock(await this.ctx(req, id, dto.variationId), dto);
  }

  // PRO: o fluxo de ícones do produto vira a composição (etapas vazias)
  @Post(':id/assembly/from-flow')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Cria as etapas pela sequência de ícones' })
  async fromFlow(@Req() req, @Param('id', ProductId) id: string) {
    return this.service.fromFlow(await this.ctx(req, id, null));
  }

  @Patch(':id/assembly/block/:blockId')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Ajusta a etapa: nome, tarefa, regras, ligações' })
  async updateBlock(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Body() dto: UpdateBlockDto,
  ) {
    return this.service.updateBlock(
      await this.ctx(req, id, dto.variationId),
      blockId,
      dto,
    );
  }

  // Etapa de dentro do produto: tirar é editar
  @Delete(':id/assembly/block/:blockId')
  @HasPermission('edit', COMPOSITION_KEY)
  @HttpCode(204)
  @ApiOperation({ summary: 'Tira a etapa sem soltar o fluxo (FL-12)' })
  async removeBlock(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Query() query: VariationRefDto,
  ) {
    await this.service.removeBlock(
      await this.ctx(req, id, query.variationId),
      blockId,
    );
  }

  @Post(':id/assembly/block/:blockId/restore-process-lines')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Traz de volta as linhas do processo (CP-21)' })
  async restoreProcessLines(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Body() dto: VariationRefDto,
  ) {
    return this.service.restoreProcessLines(
      await this.ctx(req, id, dto.variationId),
      blockId,
    );
  }

  /* ------------------------------------------------------------- linhas */

  @Post(':id/assembly/block/:blockId/line')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Acrescenta uma linha à etapa (IP-31)' })
  async addLine(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Body() dto: ProductCreateLineDto,
  ) {
    return this.service.addLine(
      await this.ctx(req, id, dto.variationId),
      blockId,
      dto,
    );
  }

  @Patch(':id/assembly/block/:blockId/line/:lineId')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Ajusta a linha neste produto (IP-22)' })
  async updateLine(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Param('lineId', LineId) lineId: string,
    @Body() dto: ProductUpdateLineDto,
  ) {
    return this.service.updateLine(
      await this.ctx(req, id, dto.variationId),
      blockId,
      lineId,
      dto,
    );
  }

  @Post(':id/assembly/block/:blockId/line/:lineId/reset')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Volta a linha a acompanhar o processo (CP-21)' })
  async resetLine(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Param('lineId', LineId) lineId: string,
    @Body() dto: VariationRefDto,
  ) {
    return this.service.resetLine(
      await this.ctx(req, id, dto.variationId),
      blockId,
      lineId,
    );
  }

  @Delete(':id/assembly/block/:blockId/line/:lineId')
  @HasPermission('edit', COMPOSITION_KEY)
  @HttpCode(204)
  @ApiOperation({ summary: 'Tira a linha da etapa' })
  async removeLine(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Param('lineId', LineId) lineId: string,
    @Query() query: VariationRefDto,
  ) {
    await this.service.removeLine(
      await this.ctx(req, id, query.variationId),
      blockId,
      lineId,
    );
  }

  @Post(':id/assembly/block/:blockId/line/:lineId/option')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Acrescenta uma opção à linha (IP-27)' })
  async addOption(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Param('lineId', LineId) lineId: string,
    @Body() dto: ProductCreateOptionDto,
  ) {
    return this.service.addOption(
      await this.ctx(req, id, dto.variationId),
      blockId,
      lineId,
      dto,
    );
  }

  @Delete(':id/assembly/block/:blockId/line/:lineId/option/:optionId')
  @HasPermission('edit', COMPOSITION_KEY)
  @HttpCode(204)
  @ApiOperation({ summary: 'Tira uma opção da linha' })
  async removeOption(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('blockId', BlockId) blockId: string,
    @Param('lineId', LineId) lineId: string,
    @Param('optionId', OptionId) optionId: string,
    @Query() query: VariationRefDto,
  ) {
    await this.service.removeOption(
      await this.ctx(req, id, query.variationId),
      blockId,
      lineId,
      optionId,
    );
  }

  /* --------------------------------------------- campos do orçamento */

  @Post(':id/assembly/field')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Cria um campo do orçamento (IP-4)' })
  async addField(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: ProductCreateFieldDto,
  ) {
    return this.service.addField(await this.ctx(req, id, dto.variationId), dto);
  }

  @Patch(':id/assembly/field/:fieldId')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Altera um campo do orçamento' })
  async updateField(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('fieldId', FieldId) fieldId: string,
    @Body() dto: ProductUpdateFieldDto,
  ) {
    return this.service.updateField(
      await this.ctx(req, id, dto.variationId),
      fieldId,
      dto,
    );
  }

  @Delete(':id/assembly/field/:fieldId')
  @HasPermission('edit', COMPOSITION_KEY)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um campo que nenhuma linha lê' })
  async removeField(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('fieldId', FieldId) fieldId: string,
    @Query() query: VariationRefDto,
  ) {
    await this.service.removeField(
      await this.ctx(req, id, query.variationId),
      fieldId,
    );
  }

  /* -------------------------------------------------------- fórmulas */

  @Post(':id/assembly/formula')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Cria uma fórmula do produto (IP-2)' })
  async addFormula(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: ProductCreateFormulaDto,
  ) {
    return this.service.addFormula(
      await this.ctx(req, id, dto.variationId),
      dto,
    );
  }

  @Patch(':id/assembly/formula/:formulaId')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({ summary: 'Altera uma fórmula do produto' })
  async updateFormula(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('formulaId', FormulaId) formulaId: string,
    @Body() dto: ProductUpdateFormulaDto,
  ) {
    return this.service.updateFormula(
      await this.ctx(req, id, dto.variationId),
      formulaId,
      dto,
    );
  }

  @Delete(':id/assembly/formula/:formulaId')
  @HasPermission('edit', COMPOSITION_KEY)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove uma fórmula que nenhuma linha usa' })
  async removeFormula(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('formulaId', FormulaId) formulaId: string,
    @Query() query: VariationRefDto,
  ) {
    await this.service.removeFormula(
      await this.ctx(req, id, query.variationId),
      formulaId,
    );
  }

  /* ------------------------------------------- variação com composição */

  @Post(':id/variation')
  @HasPermission('edit', COMPOSITION_KEY)
  @ApiOperation({
    summary: 'Cria uma variação com composição própria (cópia)',
  })
  async createVariation(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: CreateAssemblyVariationDto,
  ) {
    return this.service.createVariation(await this.ctx(req, id), dto);
  }
}
