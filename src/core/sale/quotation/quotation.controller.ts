import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { MoneyFields } from 'src/core/auth/abac/money-fields.decorator';
import { QUOTATION_MONEY_FIELDS } from 'src/core/auth/abac/money-fields';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  BadRequestException,
  Patch,
  NotFoundException,
  ForbiddenException,
  Logger,
  Req,
  HttpCode,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { QuotationService } from './quotation.service';
import { CreditCheckService } from './credit-check.service';
import { ComposedItemService, withoutCost } from './composed-item.service';
import {
  AddComposedItemDto,
  CreateComposedDraftDto,
  SaveDraftAsProductDto,
  UpdateComposedItemDto,
} from './dto/composed-item.dto';
import {
  DRAFT_NOT_FOUND,
  ProductAssemblyService,
} from '../../assembly/product-assembly.service';
import {
  AssemblyQueryDto,
  CreateBlockDto,
  NextStepQueryDto,
  PartCandidateQueryDto,
  UpdateBlockDto,
} from '../../assembly/dto/assembly.dto';
import { AddItemDto, CreateQuotationDto } from './dto/create-quotation.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../../auth/guards/block-level.guard';
import { FilterQuotationDto } from './dto/filter.dto';
import { isUUID } from 'class-validator';
import { DuplicateQuotationDto } from './dto/duplicate-quotation.dto';
import { UpdateItemDto, UpdateQuotationDto } from './dto/update-quotation.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { QuotationProduct } from '@prisma/client';
import { CancelOrderDto } from '../order/dto/create-order.dto';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../../auth/abac/abac.service';
import { PlanControlService } from '../../plan/plan-control.service';
import {
  VALUES_PERMISSION,
  canViewValues,
} from '../../auth/abac/values-visibility.interceptor';
import { ValuesOnly } from '../../auth/abac/money-fields.decorator';
import { permissionDenied } from '../../auth/abac/permissions.guard';
import { QuotationResultService } from './quotation-result.service';
import { pdfDetailLevel } from './quotation-pdf.transformers';
import { ItemLineDto } from './dto/item-line.dto';
import {
  AddOutsourcedItemDto,
  PreviewOutsourcedItemDto,
} from './dto/outsourced-item.dto';
import { QuotationLinesService } from './quotation-lines.service';
import {
  AddMaterialItemDto,
  UpdateMaterialItemDto,
} from './dto/material-item.dto';
import { QuickSaleService } from '../quick-sale/quick-sale.service';
import { FollowUpService } from './follow-up/follow-up.service';
import { RegisterContactDto } from './follow-up/follow-up.dto';
import { QUICK_SALE_LOCKED, isAtCashier } from '../quick-sale/quick-sale.rules';
import { ReceiptDto } from '../../financial/cash-control/dto/receipt-part.dto';

const RESOURCE = 'quotation';
const UUID_ROUTE = ':id([0-9a-fA-F-]{36})';
// Os valores da conferência de crédito: sem ver valores, só os motivos
const CREDIT_MONEY_FIELDS = [
  'limit',
  'openBalance',
  'pendingApproved',
  'used',
  'available',
  'requested',
];

// O terceirizado avulso (LOOSE) existe já no START (T-5); processo e produto
// do catálogo dentro do item pedem a composição
const lineFeatures = (dto: ItemLineDto) =>
  dto.kind === 'LOOSE'
    ? ['outsourced_item', 'product_composition']
    : 'product_composition';

@ApiTags('Orçamentos')
@UseGuards(JwtAuthGuard, BlockLevelGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(`sale/${RESOURCE}`)
export class QuotationController {
  private readonly logger = new Logger(QuotationController.name);

  constructor(
    private readonly quotationService: QuotationService,
    private readonly abacService: AbacService,
    private readonly prisma: PrismaService,
    private readonly planControlService: PlanControlService,
    private readonly lines: QuotationLinesService,
    private readonly results: QuotationResultService,
    private readonly creditCheck: CreditCheckService,
    private readonly composed: ComposedItemService,
    private readonly assemblies: ProductAssemblyService,
    private readonly quickSale: QuickSaleService,
    private readonly followUp: FollowUpService,
  ) {}

  /**
   * Mexer nos itens: o dono do orçamento, e a venda que já está no caixa
   * (enviada ou cobrada) não muda mais (FC-11).
   */
  private async validateItemEdit(
    quotationId: string,
    user: Parameters<QuotationController['validateOwnership']>[1],
  ) {
    await this.validateOwnership(quotationId, user, 'edit');
    if (await isAtCashier(this.prisma, quotationId)) {
      throw new BadRequestException(QUICK_SALE_LOCKED);
    }
  }

  /**
   * O rascunho do item montado (ORC-11) como dono da composição: o
   * orçamento é desta empresa e do vendedor, o plano tem a composição e o
   * rascunho é deste orçamento.
   */
  private async composedCtx(req, quotationId: string, draftId: string) {
    if (!isUUID(quotationId, '4') || !isUUID(draftId, '4')) {
      throw new NotFoundException(DRAFT_NOT_FOUND);
    }
    await this.validateItemEdit(quotationId, req.user);
    await this.planControlService.enforceFeature(
      req.user.companyId,
      'product_composition',
    );
    const draft = await this.composed.draftOf(quotationId, draftId);
    return this.composed.draftCtx(draft.companyId, draft.id);
  }

  /**
   * Aba de orçamentos no cadastro de cliente (filtro por clientId) é feature
   * do plano Lite (client_additional_tabs). Impõe o paywall no backend, já que
   * o filtro por cliente só é usado por essa aba.
   */
  private async enforceClientTabsFeature(query: {
    companyId: string;
    clientId?: string;
  }) {
    if (query.clientId) {
      await this.planControlService.enforceFeature(
        query.companyId,
        'client_additional_tabs',
      );
    }
  }

  /**
   * Resolves the effective seller filter based on ABAC permissions.
   * Returns the employeeId if the user can only see their own quotations, or undefined if they can see all.
   */
  private async resolveSellerFilter(
    user: {
      userId: string;
      username: string;
      isAdmin: boolean;
      isSystemAdmin?: boolean;
      role?: string;
      employeeId?: string;
    },
    action: 'view' | 'edit' = 'view',
  ): Promise<string | undefined> {
    const canAccessOtherQuotations =
      await this.abacService.canAccessOtherSellers(user, action);

    if (!canAccessOtherQuotations && !user.isAdmin && user.employeeId) {
      return user.employeeId;
    }
    return undefined;
  }

  /**
   * Validates that the current user has access to the quotation for the given action.
   * Throws NotFoundException if ownership check fails.
   */
  private async validateOwnership(
    quotationId: string,
    user: {
      userId: string;
      username: string;
      isAdmin: boolean;
      isSystemAdmin?: boolean;
      role?: string;
      employeeId?: string;
      companyId: string;
    },
    action: 'view' | 'edit' = 'edit',
  ): Promise<void> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { companyId: true, sellerId: true },
    });

    const sellerFilter = await this.resolveSellerFilter(user, action);

    if (!quotation) {
      throw new NotFoundException('Orçamento não encontrado');
    }
    if (quotation.companyId !== user.companyId) {
      throw new ForbiddenException('Orçamento pertence a outra empresa');
    }

    if (sellerFilter && quotation.sellerId !== sellerFilter) {
      throw new ForbiddenException(
        'Você não tem permissão para editar orçamentos de outros vendedores',
      );
    }
  }
  @Post()
  @HasPermission('create', 'sale:quotation')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Cria um novo orçamento' })
  @ApiResponse({
    status: 201,
    description: 'Orçamento criado com sucesso.',
  })
  async create(@Body() createQuotationDto: CreateQuotationDto, @Req() req) {
    if (!req.user?.isAdmin) {
      delete createQuotationDto.createdAt;
      delete createQuotationDto.quotationNumber;
    }
    // Venda rápida é recurso de plano.
    if (createQuotationDto.quickSale === true) {
      await this.planControlService.enforceFeature(
        req.user.companyId,
        'quotation_quick_sale',
      );
    }
    return this.quotationService.create(
      createQuotationDto,
      req.user?.userId,
      req.user.companyId,
    );
  }

  // Cria a venda rápida com os padrões da configuração (ALT-22, VR-1, VR-2)
  @Post('quick-sale')
  @HasPermission('create', 'sale:quotation')
  @ObservePermissions(false)
  @RequireUnblocked()
  @ApiOperation({ summary: 'Cria a venda rápida com os padrões (ALT-22)' })
  async createQuickSale(@Req() req) {
    await this.planControlService.enforceFeature(
      req.user.companyId,
      'quotation_quick_sale',
    );
    return this.quickSale.create(req.user);
  }

  // Cobrar na hora, só à vista (VR-5): recebe e aprova junto. Vale para
  // qualquer orçamento cuja série fatura na frente de caixa (26/10/2026)
  @Post(':id/quick-sale/charge')
  @HasAnyPermission(
    { action: 'create', resource: 'sale:order' },
    { action: 'edit', resource: 'sale:quotation' },
  )
  @ObservePermissions(false)
  @RequireUnblocked()
  @MoneyFields('total', 'paid', 'amount')
  @ApiOperation({ summary: 'Cobra a venda na hora e aprova (VR-5)' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async chargeQuickSale(
    @Param('id') id: string,
    @Body() dto: ReceiptDto,
    @Req() req,
  ) {
    if (!isUUID(id, '4'))
      throw new NotFoundException('Orçamento não encontrado');
    await this.validateOwnership(id, req.user, 'edit');
    return this.quickSale.charge(
      id,
      req.user,
      dto,
      await this.quickSale.actorOf(req.user),
    );
  }

  // A situação no caixa, para o vendedor acompanhar (a tela consulta a cada
  // 15 s): rota leve, sem o resto do orçamento
  @Get(':id/cash-status')
  @HasPermission('view', 'sale:quotation')
  @ObservePermissions(false)
  @MoneyFields('total', 'paid', 'amount')
  @ApiOperation({ summary: 'A situação da venda no caixa (FC-11)' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async cashStatus(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4'))
      throw new NotFoundException('Orçamento não encontrado');
    await this.validateOwnership(id, req.user, 'view');
    return this.quickSale.cashStatus(id, req.user.companyId);
  }

  @Post(':id/add-product')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Adiciona um produto a um orçamento' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async addProductToQuotation(
    @Param('id') id: string,
    @Body() addItemDto: AddItemDto,
    @Req() req,
  ) {
    await this.validateItemEdit(id, req.user);
    // A composição escolhida é recurso de plano (contrato, módulo 2)
    if (addItemDto.composition) {
      await this.planControlService.enforceFeature(
        req.user.companyId,
        'product_composition',
      );
    }
    return this.quotationService.addProductToQuotation(id, addItemDto);
  }

  // O material de venda direta como item (ORG-1, Fase 4.4)
  @Post(':id/add-material')
  @HasPermission('edit', 'sale:quotation')
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @ApiOperation({ summary: 'Acrescenta um material de venda direta' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async addMaterialItem(
    @Param('id') id: string,
    @Body() dto: AddMaterialItemDto,
    @Req() req,
  ) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateItemEdit(id, req.user);
    return this.quotationService.addMaterialItem(id, dto);
  }

  @Patch('update-material/:itemId')
  @HasAnyPermission(
    { action: 'edit', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:order' },
  )
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @ApiOperation({ summary: 'Muda a quantidade do item de material' })
  async updateMaterialItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateMaterialItemDto,
    @Req() req,
  ) {
    const quotationId =
      await this.quotationService.getQuotationIdByProductId(itemId);
    if (!quotationId) {
      throw new NotFoundException('Item não encontrado');
    }
    await this.validateItemEdit(quotationId, req.user);
    return this.quotationService.updateMaterialItem(itemId, dto);
  }

  /* -------------------------------- item montado na hora (ORC-11, 4.5) */

  @Post(':id/composed-draft')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Cria o rascunho do item montado na hora' })
  async createComposedDraft(
    @Param('id') id: string,
    @Body() dto: CreateComposedDraftDto,
    @Req() req,
  ) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateItemEdit(id, req.user);
    await this.planControlService.enforceFeature(
      req.user.companyId,
      'product_composition',
    );
    return this.composed.createDraft(id, dto);
  }

  @Patch(':id/composed-draft/:draftId')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Nome e medida do rascunho' })
  async updateComposedDraft(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Body() dto: CreateComposedDraftDto,
    @Req() req,
  ) {
    await this.composedCtx(req, id, draftId);
    return this.composed.updateDraft(id, draftId, dto);
  }

  // A composição do rascunho na medida pedida: o preço de venda de cada
  // etapa, só com valores, e nunca o custo (ORC-7)
  @Get(':id/composed-draft/:draftId/assembly')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'A composição do rascunho numa medida (mm)' })
  async readComposedDraft(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Query() query: AssemblyQueryDto,
    @Req() req,
  ) {
    const ctx = await this.composedCtx(req, id, draftId);
    const values = await canViewValues(req, this.abacService);
    const view = await this.assemblies.read(
      ctx,
      { ...query, variationId: undefined },
      { values },
    );
    return withoutCost(view);
  }

  @Get(':id/composed-draft/:draftId/assembly/next-step')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Processos para a próxima etapa do rascunho' })
  async composedNextStep(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Query() query: NextStepQueryDto,
    @Req() req,
  ) {
    return this.assemblies.nextStep(await this.composedCtx(req, id, draftId), {
      ...query,
      variationId: undefined,
    });
  }

  @Get(':id/composed-draft/:draftId/assembly/part-candidate')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Produtos que entram como parte no rascunho' })
  async composedPartCandidates(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Query() query: PartCandidateQueryDto,
    @Req() req,
  ) {
    return this.assemblies.partCandidates(
      await this.composedCtx(req, id, draftId),
      query,
    );
  }

  @Post(':id/composed-draft/:draftId/assembly/block')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Acrescenta uma etapa ao rascunho' })
  async addComposedBlock(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Body() dto: CreateBlockDto,
    @Req() req,
  ) {
    return withoutCost(
      await this.assemblies.addBlock(await this.composedCtx(req, id, draftId), {
        ...dto,
        variationId: undefined,
      }),
    );
  }

  @Patch(':id/composed-draft/:draftId/assembly/block/:blockId')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Ajusta a etapa do rascunho (ligações, processo)' })
  async updateComposedBlock(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Param('blockId') blockId: string,
    @Body() dto: UpdateBlockDto,
    @Req() req,
  ) {
    return withoutCost(
      await this.assemblies.updateBlock(
        await this.composedCtx(req, id, draftId),
        blockId,
        { ...dto, variationId: undefined },
      ),
    );
  }

  @Delete(':id/composed-draft/:draftId/assembly/block/:blockId')
  @HasPermission('edit', 'sale:quotation')
  @HttpCode(204)
  @ApiOperation({ summary: 'Tira a etapa do rascunho' })
  async removeComposedBlock(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Param('blockId') blockId: string,
    @Req() req,
  ) {
    await this.assemblies.removeBlock(
      await this.composedCtx(req, id, draftId),
      blockId,
    );
  }

  @Post(':id/add-composed')
  @HasPermission('edit', 'sale:quotation')
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @ApiOperation({ summary: 'Inclui o item montado na hora' })
  async addComposedItem(
    @Param('id') id: string,
    @Body() dto: AddComposedItemDto,
    @Req() req,
  ) {
    await this.composedCtx(req, id, dto.draftId);
    return this.composed.addComposed(id, dto);
  }

  @Patch('update-composed/:itemId')
  @HasAnyPermission(
    { action: 'edit', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:order' },
  )
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @ApiOperation({ summary: 'Refaz o item montado com o rascunho de agora' })
  async updateComposedItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateComposedItemDto,
    @Req() req,
  ) {
    const quotationId =
      await this.quotationService.getQuotationIdByProductId(itemId);
    if (!quotationId) {
      throw new NotFoundException('Item não encontrado');
    }
    await this.validateItemEdit(quotationId, req.user);
    return this.composed.updateComposed(itemId, dto);
  }

  // "Salvar como produto": cria cadastro, então pede também "Cria" em
  // produtos e a base de custos, sem a qual a composição não se edita
  @Post(':id/composed-draft/:draftId/save-as-product')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Salva o rascunho como produto em edição' })
  async saveComposedAsProduct(
    @Param('id') id: string,
    @Param('draftId') draftId: string,
    @Body() dto: SaveDraftAsProductDto,
    @Req() req,
  ) {
    await this.composedCtx(req, id, draftId);
    const canCreate = await this.abacService.hasPermission(
      req.user,
      'create',
      'product_settings:products',
    );
    if (!canCreate) {
      throw permissionDenied(['product_settings:products:create']);
    }
    await this.planControlService.enforceFeature(
      req.user.companyId,
      'cost_base',
    );
    return this.composed.saveAsProduct(id, draftId, dto);
  }

  @Patch('update-product/:productId')
  @HasAnyPermission(
    { action: 'edit', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:order' },
  )
  @ApiOperation({
    summary: 'Atualiza um produto dentro de um orçamento',
    description:
      'Atualiza os detalhes de um produto e seus itens dentro de um orçamento.',
  })
  @ApiResponse({
    status: 200,
    description: 'Produto atualizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro na validação dos dados.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento ou produto não encontrados.',
  })
  async updateProduct(
    @Param('productId') productId: string,
    @Body() updateQuotationProductDto: UpdateItemDto,
    @Req() req,
  ): Promise<QuotationProduct> {
    const quotationId =
      await this.quotationService.getQuotationIdByProductId(productId);
    if (!quotationId) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    await this.validateItemEdit(quotationId, req.user);
    if (updateQuotationProductDto.composition) {
      await this.planControlService.enforceFeature(
        req.user.companyId,
        'product_composition',
      );
    }

    const updatedProduct = await this.quotationService.updateProductInQuotation(
      productId,
      updateQuotationProductDto,
    );
    if (!updatedProduct) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    return updatedProduct;
  }

  @Post('duplicate-product/:productId')
  @HasAnyPermission(
    { action: 'create', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:quotation' },
  )
  @ApiOperation({
    summary: 'Duplica um produto dentro de um orçamento',
    description:
      'Duplica os detalhes de um produto e seus itens dentro de um orçamento.',
  })
  @ApiResponse({
    status: 200,
    description: 'Produto atualizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro na validação dos dados.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento ou produto não encontrados.',
  })
  async duplicateProduct(
    @Param('productId') productId: string,
    @Req() req,
  ): Promise<QuotationProduct> {
    const quotationId =
      await this.quotationService.getQuotationIdByProductId(productId);
    if (!quotationId) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    await this.validateItemEdit(quotationId, req.user);

    const updatedProduct =
      await this.quotationService.duplicateProductInQuotation(productId);
    if (!updatedProduct) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    return updatedProduct;
  }

  @Delete('remove-product/:productId')
  @HasAnyPermission(
    { action: 'edit', resource: 'sale:quotation' },
    { action: 'delete', resource: 'sale:quotation' },
  )
  @ApiOperation({
    summary: 'Remove um produto de um orçamento',
    description: 'Remove um produto do orçamento especificado.',
  })
  @ApiResponse({
    status: 200,
    description: 'Produto removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento ou produto não encontrados.',
  })
  async deleteProduct(
    @Param('productId') productId: string,
    @Req() req,
  ): Promise<void> {
    const quotationId =
      await this.quotationService.getQuotationIdByProductId(productId);
    if (!quotationId) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    await this.validateItemEdit(quotationId, req.user);

    const isDeleted =
      await this.quotationService.removeProductFromQuotation(productId);
    if (!isDeleted) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
  }

  /* --------------------------------------------------------------------
   * Linhas acrescentadas dentro do item (ORC-5). Rotas novas: a permissão
   * já recusa, e o dinheiro sai só com `values:values:view` (ORC-7)
   * ------------------------------------------------------------------ */

  @Post(':id/item/:itemId/line/preview')
  @HttpCode(200)
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'O preço da linha antes de gravar' })
  async previewItemLine(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ItemLineDto,
    @Req() req,
  ) {
    await this.validateOwnership(id, req.user, 'edit');
    await this.planControlService.enforceFeature(
      req.user.companyId,
      lineFeatures(dto),
    );
    return this.lines.preview(
      id,
      itemId,
      dto,
      await canViewValues(req, this.abacService),
    );
  }

  @Post(':id/item/:itemId/line')
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Acrescenta uma linha ao item' })
  async addItemLine(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ItemLineDto,
    @Req() req,
  ) {
    await this.validateItemEdit(id, req.user);
    await this.planControlService.enforceFeature(
      req.user.companyId,
      lineFeatures(dto),
    );
    return this.lines.add(
      id,
      itemId,
      dto,
      await canViewValues(req, this.abacService),
    );
  }

  /* --------------------------------------------------------------------
   * O serviço terceirizado avulso como item do orçamento (T-6): nome,
   * fornecedor, quantidade e custo; já no START (outsourced_item)
   * ------------------------------------------------------------------ */

  @Post(':id/add-outsourced/preview')
  @HttpCode(200)
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'O preço sugerido do terceirizado avulso' })
  async previewOutsourcedItem(
    @Param('id') id: string,
    @Body() dto: PreviewOutsourcedItemDto,
    @Req() req,
  ) {
    await this.validateOwnership(id, req.user, 'edit');
    await this.planControlService.enforceFeature(req.user.companyId, [
      'outsourced_item',
      'product_composition',
    ]);
    return this.lines.previewOutsourced(
      id,
      dto,
      await canViewValues(req, this.abacService),
    );
  }

  @Post(':id/add-outsourced')
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Lança um serviço terceirizado como item' })
  async addOutsourcedItem(
    @Param('id') id: string,
    @Body() dto: AddOutsourcedItemDto,
    @Req() req,
  ) {
    await this.validateItemEdit(id, req.user);
    await this.planControlService.enforceFeature(req.user.companyId, [
      'outsourced_item',
      'product_composition',
    ]);
    return this.lines.addOutsourced(
      id,
      dto,
      await canViewValues(req, this.abacService),
    );
  }

  // Editar o terceirizado avulso (Lite 4, 29/10/2026): antes, só retirando
  // e lançando de novo
  @Get(':id/outsourced/:itemId')
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'O terceirizado avulso, para editar' })
  async getOutsourcedItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req,
  ) {
    await this.validateOwnership(id, req.user, 'edit');
    return this.lines.outsourcedOf(
      id,
      itemId,
      await canViewValues(req, this.abacService),
    );
  }

  @Patch(':id/outsourced/:itemId')
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Altera o terceirizado avulso' })
  async updateOutsourcedItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: AddOutsourcedItemDto,
    @Req() req,
  ) {
    await this.validateItemEdit(id, req.user);
    await this.planControlService.enforceFeature(req.user.companyId, [
      'outsourced_item',
      'product_composition',
    ]);
    return this.lines.updateOutsourced(
      id,
      itemId,
      dto,
      await canViewValues(req, this.abacService),
    );
  }

  /* --------------------------------------------------------------------
   * Resultado previsto da venda (ORC-8): tela de método, com permissão
   * própria (desligada no perfil de vendedor), valores e a base de custos.
   * O acesso fica no registro de atividade; a exportação, também no
   * histórico do orçamento (SEG-4)
   * ------------------------------------------------------------------ */

  private async assertResultAccess(id: string, req) {
    await this.validateOwnership(id, req.user, 'view');
    if (!(await canViewValues(req, this.abacService))) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
    await this.planControlService.enforceFeature(
      req.user.companyId,
      'cost_base',
    );
  }

  @Get(':id/result')
  @HasPermission('view', 'sale:quotation_result')
  @ObservePermissions(false)
  @ValuesOnly()
  @ApiOperation({ summary: 'O resultado previsto da venda' })
  async getResult(@Param('id') id: string, @Req() req) {
    await this.assertResultAccess(id, req);
    return this.results.result(id);
  }

  @Get(':id/result/export')
  @HasPermission('export', 'sale:quotation_result')
  @ObservePermissions(false)
  @ValuesOnly()
  @ApiOperation({ summary: 'O resultado previsto em PDF identificado' })
  async exportResult(
    @Param('id') id: string,
    @Req() req,
    @Res() res: Response,
  ) {
    await this.assertResultAccess(id, req);
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true },
    });
    const userName = user?.name || req.user.username || 'Usuário';
    const { file, name } = await this.results.exportPdf(id, {
      userName,
      at: new Date(),
    });
    await this.prisma.quotationHistory
      .create({
        data: {
          quotationId: id,
          action: 'RESULT_EXPORTED',
          description: `Resultado previsto exportado por ${userName}`,
          createdBy: req.user.userId,
          createdByName: userName,
        },
      })
      .catch((error) =>
        this.logger.error(
          `Exportação do resultado sem registro no histórico: ${error.message}`,
        ),
      );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(file);
  }

  // Retirar uma linha de dentro do registro é editar o registro
  @Delete(':id/item/:itemId/line/:lineId')
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Retira uma linha do item' })
  async removeItemLine(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('lineId') lineId: string,
    @Req() req,
  ) {
    await this.validateItemEdit(id, req.user);
    return this.lines.remove(
      id,
      itemId,
      lineId,
      await canViewValues(req, this.abacService),
    );
  }

  @Get()
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({ summary: 'Obtém a lista de todos os orçamentos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de orçamentos retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() query: FilterQuotationDto) {
    query.companyId = req.user.companyId;

    await this.enforceClientTabsFeature(query);

    const sellerFilter = await this.resolveSellerFilter(req.user);
    if (sellerFilter) {
      query.sellerId = sellerFilter;
    }

    return await this.quotationService.findAll(query);
  }

  @Get('export')
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @ApiOperation({
    summary: 'Obtém os orçamentos filtrados para exportação',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de orçamentos para exportação retornada com sucesso.',
  })
  async export(@Req() req, @Query() query: FilterQuotationDto) {
    const canExport = await this.abacService.hasPermission(
      req.user,
      'export',
      'sale:quotation',
    );

    if (!canExport) {
      throw new ForbiddenException('Sem permissão para exportar orçamentos');
    }

    query.companyId = req.user.companyId;

    await this.enforceClientTabsFeature(query);

    const sellerFilter = await this.resolveSellerFilter(req.user);
    if (sellerFilter) {
      query.sellerId = sellerFilter;
    }

    return await this.quotationService.findAllForExport(query);
  }

  @Get('contact-sources')
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({ summary: 'Obtém a lista de todas as fontes de contato' })
  @ApiResponse({
    status: 200,
    description: 'Lista de fontes de contato retornada com sucesso.',
    isArray: true,
  })
  async findAllContactSources(@Req() req) {
    return this.quotationService.findAllContactSources(req.user?.companyId);
  }

  @Get('quantity')
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os status de orçamentos',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de orçamentos retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    const sellerId = await this.resolveSellerFilter(req.user);
    return this.quotationService.findAllQuantity(companyId, sellerId);
  }

  @Post(':id/duplicate')
  @HasPermission('create', 'sale:quotation')
  @ApiOperation({ summary: 'Duplica um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiBody({
    description: 'Dados para duplicação do orçamento',
    type: DuplicateQuotationDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Orçamento duplicado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async duplicate(
    @Param('id') id: string,
    @Body() dto: DuplicateQuotationDto,
    @Req() req,
  ) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'view');

    const userId = req.user?.sub || req.user?.id;
    return this.quotationService.duplicate(id, dto, userId);
  }
  @Post(':id/approve')
  @HasAnyPermission(
    { action: 'create', resource: 'sale:order' },
    { action: 'edit', resource: 'sale:quotation' },
  )
  @RequireUnblocked()
  @ApiOperation({ summary: 'Aprova um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento aprovado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async approve(
    @Param('id') id: string,
    @Req() req,
    @Body() body?: { approvedAt?: string },
  ) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'edit');
    const approvedAt =
      req.user?.isAdmin && body?.approvedAt
        ? new Date(body.approvedAt)
        : undefined;
    // O terceirizado abaixo do custo só o administrador aprova (T-5)
    await this.quotationService.assertOutsourcedAboveCost(
      id,
      !!req.user?.isAdmin,
    );
    return this.quotationService.approve(id, req.user?.userId, approvedAt);
  }

  // Fora do contrato das telas (plano de 10/10, decisão D34): rota de
  // suporte para completar uma aprovação que ficou pela metade
  @Post(':id/approve/reprocess')
  @HasAnyPermission(
    { action: 'create', resource: 'sale:order' },
    { action: 'edit', resource: 'sale:quotation' },
  )
  @RequireUnblocked()
  @ApiOperation({
    summary: 'Completa a aprovação de uma venda já aprovada',
    description:
      'Cria a O.S., a agenda, o financeiro e as etapas de produção que faltarem, sem mudar status nem data de aprovação. Rodar de novo não duplica nada.',
  })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 201,
    description:
      'Passos completados (created) e os de depois da aprovação que falharam de novo (failed).',
  })
  @ApiResponse({
    status: 409,
    description: 'Venda não aprovada, ou O.S. cancelada.',
  })
  async reprocessApproval(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'edit');
    return this.quotationService.reprocessApproval(id, req.user?.userId);
  }

  @Post(':id/bill')
  @HasPermission('edit', 'production:delivery_schedule')
  @ApiOperation({ summary: 'Faturamento manual de um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento faturado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento não encontrado.',
  })
  async bill(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'edit');
    return this.quotationService.billQuotation(id);
  }

  // Registrar contato (CRM-1, 27/10/2026): grava o contato e, no mesmo
  // corpo, o próximo contato, o lembrete e o marcador
  @Post(':id/contact')
  @HasPermission('edit', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Registra um contato da negociação (CRM-1)' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async registerContact(
    @Param('id') id: string,
    @Body() dto: RegisterContactDto,
    @Req() req,
  ) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'edit');
    return this.followUp.registerContact(
      { userId: req.user.userId, companyId: req.user.companyId },
      id,
      dto,
    );
  }

  // A linha do tempo da negociação: contatos e eventos juntos (CRM-1)
  @Get(':id/contacts')
  @HasPermission('view', 'sale:quotation')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Contatos e eventos do orçamento (CRM-1)' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async contacts(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'view');
    return this.followUp.timeline(req.user.companyId, id);
  }

  @Post(':id/reject')
  @HasAnyPermission(
    { action: 'edit', resource: 'sale:quotation' },
    { action: 'delete', resource: 'sale:quotation' },
  )
  @ApiOperation({ summary: 'Rejeita um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento rejeitado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async reject(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @Req() req,
  ) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'edit');
    // O cadastro de motivos é recurso de plano (LITE). Com ele, o motivo é
    // obrigatório (decisão do produto, 24/10/2026); sem ele, rejeita livre.
    // Sem nenhum motivo de rejeição cadastrado, a tela não teria o que
    // oferecer: a rejeição segue livre até a empresa cadastrar um
    const hasReasons = await this.planControlService.hasFeature(
      req.user.companyId,
      'quotation_rejection_reasons',
    );
    const required =
      hasReasons &&
      (await this.prisma.reasons.count({
        where: { companyId: req.user.companyId, type: 'REJECTION' },
      })) > 0;
    if (required && !dto.reasonId) {
      throw new BadRequestException('Informe o motivo da rejeição');
    }
    if (dto.reasonId && !hasReasons) {
      await this.planControlService.enforceFeature(
        req.user.companyId,
        'quotation_rejection_reasons',
      );
    }
    return this.quotationService.reject(id, dto, req.user?.userId);
  }

  @Post(':id/finish')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Finaliza um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento finalizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async finish(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'edit');
    return await this.quotationService.finish(id, req.user?.userId);
  }

  @Post(':id/open')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Reabre um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento reaberto com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async open(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'edit');
    return this.quotationService.open(id, req.user?.userId);
  }

  // O aviso de crédito no orçamento (cliente bloqueado, condição fora das
  // permitidas, limite): concluir só avisa, a aprovação recusa (PO, 14/10)
  @Get(':id/credit')
  @MoneyFields(...CREDIT_MONEY_FIELDS)
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({ summary: 'Conferência de crédito do orçamento' })
  async credit(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'view');
    return this.creditCheck.quotationCredit(id);
  }

  // A situação do cliente ao escolhê-lo no orçamento, antes de gravar
  @Get('client-credit/:clientId')
  @MoneyFields(...CREDIT_MONEY_FIELDS)
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({ summary: 'Situação de crédito do cliente' })
  async clientCredit(@Param('clientId') clientId: string, @Req() req) {
    if (!isUUID(clientId, '4')) {
      throw new BadRequestException('Invalid id');
    }
    const credit = await this.creditCheck.clientCredit(
      req.user.companyId,
      clientId,
    );
    if (!credit) {
      throw new NotFoundException('Cliente não encontrado');
    }
    return credit;
  }

  @Get(UUID_ROUTE)
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({ summary: 'Obtém um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento retornado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento não encontrado.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado.',
  })
  async findOne(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }

    const quotation = await this.quotationService.findOne(id);

    if (!quotation) {
      throw new NotFoundException('Orçamento não encontrado');
    }

    if (quotation.companyId !== req.user.companyId) {
      throw new NotFoundException('Orçamento não encontrado');
    }

    const sellerFilter = await this.resolveSellerFilter(req.user);
    if (sellerFilter && quotation.sellerId !== sellerFilter) {
      throw new NotFoundException('Orçamento não encontrado');
    }

    return quotation;
  }

  @Patch(':id')
  @HasPermission('edit', 'sale:quotation')
  @ApiOperation({ summary: 'Atualiza um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiBody({
    description: 'Dados para atualização do orçamento',
    type: UpdateQuotationDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Orçamento atualizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async update(
    @Param('id') id: string,
    @Body() updateQuotationDto: UpdateQuotationDto,
    @Req() req,
  ) {
    if (!req.user?.isAdmin) {
      delete updateQuotationDto.createdAt;
      delete updateQuotationDto.approvedAt;
      delete updateQuotationDto.quotationNumber;
      // Trocar a série renumera o orçamento: só o admin da conta pode.
      delete updateQuotationDto.seriesId;
    }
    await this.validateOwnership(id, req.user, 'edit');
    // Transformar um orçamento em venda rápida é recurso de plano (o que já é
    // venda rápida segue editável).
    if (updateQuotationDto.quickSale === true) {
      const current = await this.prisma.quotation.findUnique({
        where: { id },
        select: { quickSale: true },
      });
      if (current && !current.quickSale) {
        await this.planControlService.enforceFeature(
          req.user.companyId,
          'quotation_quick_sale',
        );
      }
    }
    return await this.quotationService.update(
      id,
      updateQuotationDto,
      req.user?.userId,
      req.user.companyId,
    );
  }
  @Delete('delete-imported')
  @HasPermission('delete', 'sale:quotation')
  // Sem uso no front e destrutiva: já recusa, sem passar pelo modo observar
  @ObservePermissions(false)
  @ApiOperation({
    summary: 'Deleta todos os orçamentos importados para uma empresa',
  })
  @ApiResponse({
    status: 200,
    description: 'Orçamentos deletados com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao deletar os orçamentos.',
  })
  async deleteImportedQuotations(@Req() req) {
    const companyId = req.user.companyId;
    try {
      this.logger.log(`Deleting imported quotations for company ${companyId}`);
      return await this.quotationService.deleteImportedQuotations(companyId);
    } catch (error) {
      this.logger.error('Failed to delete imported quotations', error?.stack);
      throw error;
    }
  }

  @Delete(':id')
  @HasPermission('delete', 'sale:quotation')
  @ApiOperation({ summary: 'Remove um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento removido com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento não encontrado.',
  })
  async remove(@Param('id') id: string, @Req() req) {
    // Sem a conferência, inativava o orçamento de qualquer empresa
    await this.validateOwnership(id, req.user, 'edit');
    return this.quotationService.remove(id);
  }

  @Get(':id/pdf-data')
  @MoneyFields(...QUOTATION_MONEY_FIELDS)
  @HasAnyPermission(
    { action: 'view', resource: 'sale:quotation' },
    { action: 'view', resource: 'sale:order' },
    { action: 'view', resource: 'production:delivery_schedule' },
  )
  @ApiOperation({ summary: 'Obtém os dados do orçamento para geração de PDF' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Dados do orçamento para PDF retornados com sucesso.',
    content: {
      'application/json': {
        example: {
          company: {
            name: 'Empresa Exemplo Ltda',
            cnpj: '12.345.678/0001-90',
            email: 'contato@empresa.com',
            siteUrl: 'https://www.empresa.com',
            address: {
              street: 'Rua Exemplo',
              number: '123',
              complement: 'Sala 45',
              neighborhood: 'Centro',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '01234-567',
            },
            socialNetworks: {
              instagram: 'minhaempresa',
              facebook: 'minhaempresa',
              linkedin: 'minhaempresa',
            },
            logo: 'https://example.com/logo.png',
            textBeforeItems: 'Texto antes dos itens',
            textAfterItems: 'Texto depois dos itens',
          },
          client: {
            name: 'Cliente Exemplo',
            document: {
              type: 'CNPJ',
              value: '98.765.432/0001-10',
            },
            phone: '(11) 98765-4321',
            email: 'cliente@exemplo.com',
            notes: 'Observações gerais do cliente',
            financialNotes: 'Observações financeiras do cliente',
            address: {
              type: 'PRINCIPAL',
              street: 'Rua do Cliente',
              number: '456',
              complement: 'Apto 78',
              neighborhood: 'Jardim',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '04567-890',
            },
          },
          contact: {
            name: 'João Silva',
            phone: '(11) 91234-5678',
            email: 'joao.silva@exemplo.com',
            notes: 'Observações do contato',
          },
          quotation: {
            number: 12345,
            seriesCode: 'SERIE-001',
            description: 'Orçamento para projeto exemplo',
            seller: {
              name: 'Vendedor Exemplo',
              signature: 'https://example.com/signature.png',
            },
            createdAt: '2023-01-15T10:30:00Z',
            dueDate: '2023-02-15T10:30:00Z',
            approvedAt: '2023-01-20T14:45:00Z',
            finishedAt: '2023-02-10T09:15:00Z',
            status: 'DONE',
          },
          order: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            createdAt: '2023-01-20T14:45:00Z',
            status: 'IN_PRODUCTION',
            approvedAt: '2023-01-20T14:45:00Z',
          },
          items: [
            {
              id: '550e8400-e29b-41d4-a716-446655440001',
              image: 'https://example.com/product1.jpg',
              description: 'Produto Exemplo 1',
              composition: [
                {
                  id: '550e8400-e29b-41d4-a716-446655440002',
                  name: 'Componente 1',
                  quantity: 2,
                  unitPrice: 15000,
                  totalPrice: 30000,
                },
                {
                  id: '550e8400-e29b-41d4-a716-446655440003',
                  name: 'Componente 2',
                  quantity: 1,
                  unitPrice: 5000,
                  totalPrice: 5000,
                },
              ],
              totalQuantity: 1,
              totalUnitPrice: 35000,
              discount: {
                type: 'PERCENT',
                value: 10,
                discountedValue: 3500,
              },
              finalPrice: 31500,
            },
          ],
          delivery: {
            supplier: {
              name: 'Transportadora Exemplo',
              cnpj: '11.222.333/0001-44',
              notes: 'Observações da transportadora',
              financialNotes: 'Observações financeiras da transportadora',
            },
            daysAfterApproval: 15,
            freightCost: 2500,
            freightPrice: 3000,
            notes: 'Observações sobre a entrega',
            clientAddress: {
              type: 'PRINCIPAL',
              street: 'Rua do Cliente',
              number: '456',
              complement: 'Apto 78',
              neighborhood: 'Jardim',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '04567-890',
            },
          },
          payment: {
            condition: 'A Vista',
            method: 'PIX',
            description: 'Descrição das condições de pagamento',
            totalInstallments: 1,
            installments: [
              {
                number: '550e8400-e29b-41d4-a716-446655440004',
                dueDate: '2023-01-20T14:45:00Z',
                value: 31500,
                paymentMethod: 'PIX',
              },
            ],
            hasDownPayment: true,
            downPayment: {
              amount: 5000,
              dueDate: '2023-01-15T14:45:00Z',
              additionalFee: 0,
              paymentConditionId: '550e8400-e29b-41d4-a716-446655440005',
              paymentCondition: {
                id: '550e8400-e29b-41d4-a716-446655440005',
                name: 'PIX',
                paymentMethod: 'PIX',
              },
            },
          },
          total: {
            subtotal: 35000,
            totalDiscount: 3500,
            finalTotal: 31500,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento não encontrado.',
  })
  async getQuotationPdfData(
    @Param('id') id: string,
    @Req() req,
    // resumo · lista · valores (IP-12)
    @Query('detailLevel') detailLevel?: string,
  ) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    await this.validateOwnership(id, req.user, 'view');
    const values = await canViewValues(req, this.abacService);
    const itemDetails = await this.planControlService.hasFeature(
      req.user.companyId,
      'pdf_show_item_details',
    );
    return await this.quotationService.getQuotationPdfData(
      id,
      req.user.userId,
      {
        detailLevel: pdfDetailLevel(detailLevel, { values, itemDetails }),
        values,
      },
    );
  }
}
