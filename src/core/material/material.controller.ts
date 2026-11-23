import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AbacService } from '../auth/abac/abac.service';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import {
  PermissionsGuard,
  permissionDenied,
} from '../auth/abac/permissions.guard';
import {
  VALUES_PERMISSION,
  canViewValues,
} from '../auth/abac/values-visibility.interceptor';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { PlanControlService } from '../plan/plan-control.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import {
  ImportMaterialsDto,
  ImportPreviewDto,
} from './dto/import-material.dto';
import { MaterialFilterDto } from './dto/material-filter.dto';
import { UpdateMaterialPriceDto } from './dto/material-price.dto';
import { MaterialFiscalDto } from './dto/material-fiscal.dto';
import {
  CreateMaterialVariationsDto,
  UpdateMaterialVariationDto,
} from './dto/material-variation.dto';
import { ToggleMaterialDto } from './dto/toggle-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { MaterialImportService } from './material-import.service';
import { MaterialService } from './material.service';

const PRODUCTS = 'product_settings:products';
/**
 * Quem lê a lista inteira: a tela de Materiais, a entrada de nota e as
 * telas de compras do FULL (solicitação, pedido e lote escolhem o material).
 */
const READS_REGISTRY = [
  { action: 'view', resource: PRODUCTS },
  { action: 'view', resource: 'stock:invoice_entry' },
  { action: 'view', resource: 'stock:purchase_request' },
  { action: 'view', resource: 'stock:purchase' },
  { action: 'view', resource: 'stock:lot' },
];
const FEATURE = 'cost_base';
// Papéis no LITE (13/10/2026): o papel sem custo, sem a base de custos
const PAPER_FEATURE = 'paper_register';

/** No papel do LITE, custo e preço não entram (400). */
const COST_FIELDS = ['cost', 'price'] as const;
export const PAPER_WITHOUT_COST =
  'No seu plano o papel não tem custo nem preço';
/** Os campos da tela completa de Materiais: pedem a base de custos (403). */
const FULL_REGISTRY_FIELDS = [
  'subcategory',
  'unit',
  'directSale',
  'productionMaterial',
  'advanced',
] as const;

/**
 * O corpo da tela Papéis: sem custo, preço nem os campos da tela completa.
 * Na tela de Materiais a unidade é obrigatória, então o corpo dela nunca é
 * só de papel.
 */
const isPaperBody = (dto: CreateMaterialDto) =>
  ![...COST_FIELDS, ...FULL_REGISTRY_FIELDS].some(
    (field) => dto[field] !== undefined,
  );

// O id que não é UUID responde como o que não existe
const MaterialId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Material não encontrado'),
});
const VariationId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Variação não encontrada'),
});

/**
 * Materiais do PRO (contrato da API, módulo 1, parte B). A empresa é a da
 * sessão. O cadastro usa a permissão de produtos; custo e preço pedem também
 * `values:values:view`, que aqui é conferida de verdade: são rotas novas,
 * sem tela antiga que dependa do campo.
 *
 * Papéis no LITE (PO, 13/10/2026): com `paper_register` e sem a base de
 * custos, a lista (`?paper=true`), o cadastro e a edição valem só para o
 * papel (forma SHEET), sem custo nem preço. Material que não é papel
 * continua pedindo a base de custos.
 */
@ApiTags('Materiais')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature(FEATURE)
@Controller('material')
export class MaterialController {
  constructor(
    private readonly materialService: MaterialService,
    private readonly importService: MaterialImportService,
    private readonly abacService: AbacService,
    private readonly planControlService: PlanControlService,
  ) {}

  @Get()
  @HasAnyPermission(
    ...READS_REGISTRY,
    { action: 'create', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:quotation' },
  )
  // O plano é conferido no handler: a busca de venda direta do orçamento
  // responde lista vazia, e não 403, a quem não tem a base de custos
  @RequiresFeature([])
  @ApiOperation({ summary: 'Lista os materiais da empresa' })
  async findAll(@Req() req, @Query() filter: MaterialFilterDto) {
    const user = req.user;
    // A busca de venda direta: só os de venda direta e ativos
    const directSaleSearch =
      filter.directSale === true && filter.active !== false;

    // O orçamento só alcança os materiais pela busca de venda direta; a tela
    // de materiais, a entrada de nota e as compras leem a lista inteira
    const readsRegistry = await this.abacService.hasAnyPermission(
      user,
      READS_REGISTRY,
    );
    if (!readsRegistry && !directSaleSearch) {
      throw permissionDenied(
        READS_REGISTRY.map((item) => `${item.resource}:${item.action}`),
      );
    }

    const full = await this.planControlService.hasFeature(
      user.companyId,
      FEATURE,
    );
    if (!full && directSaleSearch) {
      return { data: [], page: 1, lastPage: 1, total: 0 };
    }
    // Papéis: a lista dos papéis com a folha, sem custo nem preço. No LITE é
    // o cadastro do papel; no PRO a mesma tela lê daqui e o custo fica em
    // Materiais (30/10/2026: antes o PRO recebia a forma de Materiais, sem a
    // folha no topo, e a tela mostrava a folha vazia)
    if (filter.paper === true) {
      if (!full) {
        await this.planControlService.enforceFeature(user.companyId, [
          FEATURE,
          PAPER_FEATURE,
        ]);
      }
      return this.materialService.findAll(user.companyId, filter, {
        values: false,
        paper: true,
      });
    }
    if (!full) {
      await this.planControlService.enforceFeature(user.companyId, FEATURE);
    }

    return this.materialService.findAll(user.companyId, filter, {
      values: await canViewValues(req, this.abacService),
      directSale: filter.directSale === true,
    });
  }

  @Post()
  @HasPermission('edit', PRODUCTS)
  // O plano é conferido no handler: sem a base de custos, só o papel
  @RequiresFeature([FEATURE, PAPER_FEATURE])
  @ApiOperation({
    summary:
      'Cadastra um material; sem a base de custos, ou com o corpo da tela Papéis, o papel',
  })
  async create(@Req() req, @Body() dto: CreateMaterialDto) {
    const companyId = req.user.companyId;
    // O corpo da tela Papéis (nome, setor e os campos do papel) cria o papel
    // também com a base de custos: o caminho completo pedia unidade e forma,
    // que a tela não manda, e o PRO recebia 400 (30/10/2026)
    if (
      !isPaperBody(dto) &&
      (await this.planControlService.hasFeature(companyId, FEATURE))
    ) {
      return this.materialService.create(companyId, dto, {
        values: await canViewValues(req, this.abacService),
      });
    }
    await this.assertPaperBody(companyId, dto);
    return this.materialService.createPaper(companyId, dto);
  }

  @Post('import/preview')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({
    summary: 'Concilia as linhas da planilha com o cadastro, sem gravar',
  })
  async previewImport(@Req() req, @Body() dto: ImportPreviewDto) {
    await this.requireValues(req);
    return this.importService.preview(req.user.companyId, dto.rows);
  }

  @Post('import')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Aplica a importação já conciliada' })
  async import(@Req() req, @Body() dto: ImportMaterialsDto) {
    await this.requireValues(req);
    return this.importService.apply(req.user.companyId, dto.rows);
  }

  @Patch(':id')
  @HasPermission('edit', PRODUCTS)
  // O plano é conferido no handler: sem a base de custos, só o papel
  @RequiresFeature([FEATURE, PAPER_FEATURE])
  @ApiOperation({
    summary:
      'Edita o cadastro e a configuração avançada; sem a base de custos, só o papel',
  })
  async update(
    @Req() req,
    @Param('id', MaterialId) id: string,
    @Body() dto: UpdateMaterialDto,
  ) {
    const companyId = req.user.companyId;
    if (await this.planControlService.hasFeature(companyId, FEATURE)) {
      return this.materialService.update(companyId, id, dto, {
        values: await canViewValues(req, this.abacService),
      });
    }
    await this.assertPaperBody(companyId, dto);
    // O material que não é papel continua sendo da base de custos (403)
    if (!(await this.materialService.isPaper(companyId, id))) {
      await this.planControlService.enforceFeature(companyId, FEATURE);
    }
    return this.materialService.updatePaper(companyId, id, dto);
  }

  @Post(':id/variation')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Cria em lote as combinações marca × cor' })
  async createVariations(
    @Req() req,
    @Param('id', MaterialId) id: string,
    @Body() dto: CreateMaterialVariationsDto,
  ) {
    return this.materialService.createVariations(req.user.companyId, id, dto, {
      values: await canViewValues(req, this.abacService),
    });
  }

  @Patch(':id/variation/:variationId')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Altera custo e preço de uma combinação' })
  async updateVariation(
    @Req() req,
    @Param('id', MaterialId) id: string,
    @Param('variationId', VariationId) variationId: string,
    @Body() dto: UpdateMaterialVariationDto,
  ) {
    await this.requireValues(req);
    return this.materialService.updateVariation(
      req.user.companyId,
      id,
      variationId,
      dto,
    );
  }

  @Patch(':id/price')
  @HasAnyPermission(
    { action: 'edit', resource: PRODUCTS },
    { action: 'edit', resource: 'cost:pricing' },
  )
  @ApiOperation({
    summary: 'Grava a regra e o preço do material ou da variação',
  })
  async updatePrice(
    @Req() req,
    @Param('id', MaterialId) id: string,
    @Body() dto: UpdateMaterialPriceDto,
  ) {
    await this.requireValues(req);
    // Quem chega só pela permissão da Precificação precisa também do recurso
    // de plano dela
    const fromRegistry = await this.abacService.hasPermission(
      req.user,
      'edit',
      PRODUCTS,
    );
    if (!fromRegistry) {
      await this.planControlService.enforceFeature(
        req.user.companyId,
        'pricing_center',
      );
    }
    return this.materialService.updatePrice(req.user.companyId, id, dto);
  }

  @Put(':id/fiscal')
  // Os dados fiscais são do módulo Nota Fiscal, como os do produto
  @RequiresFeature('nota_fiscal')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({
    summary: 'Grava os dados fiscais do material de venda direta',
  })
  async updateFiscal(
    @Req() req,
    @Param('id', MaterialId) id: string,
    @Body() dto: MaterialFiscalDto,
  ) {
    return this.materialService.updateFiscal(req.user.companyId, id, dto, {
      values: await canViewValues(req, this.abacService),
    });
  }

  @Get(':id/usage')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({
    summary: 'Produtos e processos cuja composição usa o material',
  })
  usage(@Req() req, @Param('id', MaterialId) id: string) {
    return this.materialService.usage(req.user.companyId, id);
  }

  @Patch(':id/toggle-status')
  // Inativar não é excluir: pede a permissão de editar
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Inativa ou reativa o material' })
  async toggleStatus(
    @Req() req,
    @Param('id', MaterialId) id: string,
    @Body() dto: ToggleMaterialDto,
  ) {
    return this.materialService.toggleStatus(
      req.user.companyId,
      id,
      dto.active,
      { values: await canViewValues(req, this.abacService) },
    );
  }

  /** Rotas que só fazem sentido com custo e preço à vista. */
  private async requireValues(req: any) {
    if (!(await canViewValues(req, this.abacService))) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
  }

  /**
   * O corpo do papel do LITE: nome, setor, ativo e os campos do papel.
   * Custo e preço são recusados (400); o campo da tela completa de
   * Materiais pede a base de custos (o 403 diz de qual plano em diante).
   */
  private async assertPaperBody(companyId: string, dto: UpdateMaterialDto) {
    if (COST_FIELDS.some((field) => dto[field] !== undefined)) {
      throw new BadRequestException(PAPER_WITHOUT_COST);
    }
    if (FULL_REGISTRY_FIELDS.some((field) => dto[field] !== undefined)) {
      await this.planControlService.enforceFeature(companyId, FEATURE);
    }
  }
}
