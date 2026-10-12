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
} from '@nestjs/common';
import { QuotationService } from './quotation.service';
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

const RESOURCE = 'quotation';
const UUID_ROUTE = ':id([0-9a-fA-F-]{36})';

@ApiTags('Orçamentos')
@UseGuards(JwtAuthGuard, BlockLevelGuard)
@ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class QuotationController {
  private readonly logger = new Logger(QuotationController.name);

  constructor(
    private readonly quotationService: QuotationService,
    private readonly abacService: AbacService,
    private readonly prisma: PrismaService,
    private readonly planControlService: PlanControlService,
  ) {}

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
    return this.quotationService.create(createQuotationDto, req.user?.userId);
  }

  @Post(':id/add-product')
  @ApiOperation({ summary: 'Adiciona um produto a um orçamento' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async addProductToQuotation(
    @Param('id') id: string,
    @Body() addItemDto: AddItemDto,
    @Req() req,
  ) {
    await this.validateOwnership(id, req.user, 'edit');
    return this.quotationService.addProductToQuotation(id, addItemDto);
  }

  @Patch('update-product/:productId')
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
    await this.validateOwnership(quotationId, req.user, 'edit');

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
    await this.validateOwnership(quotationId, req.user, 'edit');

    const updatedProduct =
      await this.quotationService.duplicateProductInQuotation(productId);
    if (!updatedProduct) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    return updatedProduct;
  }

  @Delete('remove-product/:productId')
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
    await this.validateOwnership(quotationId, req.user, 'edit');

    const isDeleted =
      await this.quotationService.removeProductFromQuotation(productId);
    if (!isDeleted) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
  }

  @Get()
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

    const userId = req.user?.sub || req.user?.id;
    return this.quotationService.duplicate(id, dto, userId);
  }
  @Post(':id/approve')
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
    return this.quotationService.approve(id, req.user?.userId, approvedAt);
  }

  // Fora do contrato das telas (plano de 10/10, decisão D34): rota de
  // suporte para completar uma aprovação que ficou pela metade
  @Post(':id/approve/reprocess')
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
  async bill(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return this.quotationService.billQuotation(id);
  }

  @Post(':id/reject')
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
    // Rejeitar com motivo (cadastro de motivos) é recurso de plano; sem motivo
    // é livre.
    if (dto.reasonId) {
      await this.planControlService.enforceFeature(
        req.user.companyId,
        'quotation_rejection_reasons',
      );
    }
    return this.quotationService.reject(id, dto, req.user?.userId);
  }

  @Post(':id/finish')
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

  @Get(UUID_ROUTE)
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
    );
  }
  @Delete('delete-imported')
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
  remove(@Param('id') id: string) {
    return this.quotationService.remove(id);
  }

  @Get(':id/pdf-data')
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
  async getQuotationPdfData(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return await this.quotationService.getQuotationPdfData(id, req.user.userId);
  }
}
