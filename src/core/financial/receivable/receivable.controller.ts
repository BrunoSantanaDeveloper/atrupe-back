import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ReceivableService } from './receivable.service';
import {
  CompensateDto,
  CreateReceivableDto,
  UpdateReceivableInstallmentsDto,
} from './dto/create-receivable.dto';
import {
  CancelReceivableDto,
  PayInstallmentDto,
  UpdateReceivableDto,
  UndoCancelReceivableDto,
} from './dto/update-receivable.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { AbacService } from 'src/core/auth/abac/abac.service';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import { PlanControlService } from 'src/core/plan/plan-control.service';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ReceivableFilterDto } from './dto/receivable-filter.dto';
import { ReceiptDataResponseDto } from './dto/receipt-data.dto';

const RESOURCE = 'receivable';
const GROUP = 'financial';

@ApiTags('Contas a Receber')
@UseGuards(JwtAuthGuard, PermissionsGuard, TenantGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class ReceivableController {
  constructor(
    private readonly planControl: PlanControlService,
    private readonly receivableService: ReceivableService,
    private readonly abacService: AbacService,
  ) {}

  @Post()
  @HasAnyPermission(
    { action: 'create', resource: 'financial:receivable' },
    { action: 'create', resource: 'financial:flow' },
  )
  @ApiOperation({ summary: 'Cria uma nova conta a receber com parcelas' })
  @ApiBody({
    description: 'Dados da nova conta a receber',
    type: CreateReceivableDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Conta a receber criada com sucesso.',
  })
  create(@Req() req, @Body() createReceivableDto: CreateReceivableDto) {
    createReceivableDto.companyId = req.user.companyId;
    return this.receivableService.create(
      createReceivableDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Get()
  @HasAnyPermission(
    { action: 'view', resource: 'financial:receivable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({ summary: 'Obtém a lista de todas as contas a receber' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas a receber retornada com sucesso.',
    isArray: true,
  })
  // A lista é a tela "A receber" do plano; as ações sobre um lançamento
  // (pagar, cancelar, editar) servem também ao fluxo financeiro e ficam livres.
  @UseGuards(FeatureGuard)
  @RequiresFeature('accounts_receivable')
  async findAll(@Req() req, @Query() paginationDto: ReceivableFilterDto) {
    paginationDto.companyId = req.user.companyId;
    return await this.receivableService.findAll(paginationDto);
  }

  @Get('batch-receipt-data')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:receivable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary:
      'Retorna dados para gerar um recibo agrupado de múltiplas parcelas',
  })
  @ApiResponse({
    status: 200,
    description: 'Dados do recibo retornados com sucesso.',
    type: ReceiptDataResponseDto,
  })
  getBatchReceiptData(
    @Req() req,
    @Query('installmentIds') installmentIds: string | string[],
  ): Promise<ReceiptDataResponseDto> {
    const ids = Array.isArray(installmentIds)
      ? installmentIds
      : (installmentIds || '').split(',').filter(Boolean);
    return this.receivableService.getBatchReceiptData(
      ids,
      req.user.userId,
      req.user.companyId,
    );
  }

  @Get('installment/:installmentId/receipt-data')
  @TenantResource('receivableInstallment', 'installmentId', 'receivable')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:receivable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary: 'Retorna os dados formatados para gerar um recibo de uma parcela',
  })
  @ApiParam({
    name: 'installmentId',
    required: true,
    description: 'ID da parcela',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Dados do recibo retornados com sucesso.',
    type: ReceiptDataResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Parcela não encontrada.' })
  getReceiptData(
    @Req() req,
    @Param('installmentId') installmentId: string,
    @Query('paidDate') paidDate?: string,
    @Query('paidAmount') paidAmount?: string,
  ): Promise<ReceiptDataResponseDto> {
    return this.receivableService.getReceiptData(
      installmentId,
      paidDate,
      paidAmount,
      req.user.userId,
    );
  }

  @Get(':id')
  @TenantResource('receivable')
  @ApiOperation({ summary: 'Obtém uma conta a receber pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a receber retornada com sucesso.',
  })
  @ApiResponse({ status: 404, description: 'Conta a receber não encontrada.' })
  findOne(@Param('id') id: string) {
    return this.receivableService.findOne(id);
  }

  @Get(':id/history')
  @TenantResource('receivable')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:receivable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary: 'Obtém o histórico de alterações de uma conta a receber',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Histórico retornado com sucesso.',
  })
  getHistory(@Param('id') id: string) {
    return this.receivableService.getHistory(id);
  }

  @Get(':id/details')
  @TenantResource('receivable')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:receivable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary:
      'Obtém detalhes completos de uma conta a receber com todas as parcelas',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalhes da conta a receber retornados com sucesso.',
  })
  @ApiResponse({ status: 404, description: 'Conta a receber não encontrada.' })
  async getDetails(@Param('id') id: string) {
    return this.receivableService.findOne(id);
  }

  @Patch(':id')
  @TenantResource('receivable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:receivable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  @ApiOperation({ summary: 'Atualizar dados do título' })
  @ApiParam({
    name: 'id',
    description: 'ID do título',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiResponse({ status: 200, description: 'Título atualizado com sucesso.' })
  @ApiResponse({ status: 404, description: 'Título não encontrado.' })
  async updateTitle(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
  ) {
    return await this.receivableService.updateTitle(
      id,
      dto,
      req.user.userId,
      req.user.name,
    );
  }

  @Patch(':id/upsert-installments')
  @TenantResource('receivable')
  @ApiResponse({
    status: 200,
    description: 'Parcelas adicionadas, editadas ou removidas com sucesso',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao processar as parcelas',
  })
  async upsertInstallments(
    @Req() req,
    @Param('id') id: string,
    @Body()
    updateReceivableInstallmentsDto: UpdateReceivableInstallmentsDto,
  ) {
    const user = req.user;
    const canEditFlow = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:flow',
    );
    const canEditReceivable = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:receivable',
    );
    if (!canEditFlow && !canEditReceivable) {
      throw new ForbiddenException(
        'Sem permissão para editar parcelas desta conta a receber.',
      );
    }
    return this.receivableService.updateInstallments(
      id,
      updateReceivableInstallmentsDto,
      user.userId,
      user.name,
    );
  }
  @Patch(':id/cancel')
  @TenantResource('receivable')
  @HasAnyPermission(
    { action: 'delete', resource: 'financial:receivable' },
    { action: 'delete', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary: 'Cancela uma conta a receber e suas parcelas pendentes',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a receber cancelada com sucesso.',
  })
  async cancel(
    @Req() req,
    @Param('id') id: string,
    @Body() cancelReceivableDto: CancelReceivableDto,
  ) {
    // Motivo e observação ao cancelar são do plano; cancelar sem eles é livre.
    // Texto vazio conta como não informado (a tela sem o recurso manda '').
    if (
      cancelReceivableDto.cancelReason?.trim() ||
      cancelReceivableDto.cancelNotes?.trim()
    ) {
      await this.planControl.enforceFeature(
        req.user.companyId,
        'transaction_cancel_reasons',
      );
    }
    return await this.receivableService.cancel(
      id,
      cancelReceivableDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Post(':id/undo-cancel')
  @TenantResource('receivable')
  @ApiOperation({
    summary: 'Desfaz o cancelamento de uma conta a receber',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Cancelamento da conta a receber desfeito com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro: conta não está cancelada ou possui parcelas pagas.',
  })
  async undoCancel(
    @Req() req,
    @Param('id') id: string,
    @Body() undoCancelReceivableDto: UndoCancelReceivableDto,
  ) {
    const user = req.user;
    const canEditFlow = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:flow',
    );
    const canEditReceivable = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:receivable',
    );
    if (!canEditFlow && !canEditReceivable) {
      throw new ForbiddenException(
        'Sem permissão para desfazer cancelamento desta conta a receber.',
      );
    }
    return await this.receivableService.undoCancel(
      id,
      undoCancelReceivableDto,
      user.userId,
      user.name,
    );
  }

  @Patch('pay-installment/:installmentId')
  @TenantResource('receivableInstallment', 'installmentId', 'receivable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:receivable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  @ApiResponse({
    status: 200,
    description: 'Parcela paga com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao pagar a parcela',
  })
  @ApiParam({
    name: 'installmentId',
    required: true,
    description: 'ID da parcela a ser paga',
  })
  async payInstallment(
    @Req() req,
    @Param('installmentId') installmentId: string,
    @Body() payInstallmentDto: PayInstallmentDto,
  ) {
    // Registrar a diferença (valor pago diferente da parcela) é do plano.
    if (
      (payInstallmentDto.difference != null &&
        Number(payInstallmentDto.difference) !== 0) ||
      payInstallmentDto.differenceNatureId ||
      payInstallmentDto.differenceCategoryId
    ) {
      await this.planControl.enforceFeature(
        req.user.companyId,
        'payment_difference',
      );
    }
    return this.receivableService.payInstallment(
      installmentId,
      payInstallmentDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Patch('compensate/:installmentId')
  @TenantResource('receivableInstallment', 'installmentId', 'receivable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:receivable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  async compensateInstallment(
    @Param('installmentId') installmentId: string,
    @Body() compensateDto: CompensateDto,
  ) {
    await this.receivableService.compensateInstallment(
      installmentId,
      compensateDto,
    );
    return { message: 'Compensação realizada com sucesso.' };
  }

  @Patch('unpay-installment/:installmentId')
  @TenantResource('receivableInstallment', 'installmentId', 'receivable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:receivable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  @ApiResponse({
    status: 200,
    description: 'Parcela paga com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao pagar a parcela',
  })
  @ApiParam({
    name: 'installmentId',
    required: true,
    description: 'ID da parcela a ser paga',
  })
  async undoPaymentInstallment(
    @Req() req,
    @Param('installmentId') installmentId: string,
  ) {
    return this.receivableService.undoPaymentInstallment(
      installmentId,
      req.user.userId,
      req.user.name,
    );
  }

  @Delete(':id')
  @TenantResource('receivable')
  @HasAnyPermission(
    { action: 'delete', resource: 'financial:receivable' },
    { action: 'delete', resource: 'financial:flow' },
  )
  @ApiOperation({ summary: 'Remove uma conta a receber pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a receber removida com sucesso.',
  })
  @ApiResponse({ status: 404, description: 'Conta a receber não encontrada.' })
  remove(@Param('id') id: string) {
    return this.receivableService.remove(id);
  }

  /**
   * Endpoint dedicado para atualizar apenas a observação de uma conta a receber.
   * Aceita tanto `financial:flow:edit` (visão do fluxo) quanto `financial:receivable:edit`.
   */
  @Patch(':id/notes')
  @TenantResource('receivable')
  @ApiOperation({ summary: 'Atualiza a observação de uma conta a receber' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Observação atualizada com sucesso.',
  })
  @ApiResponse({ status: 403, description: 'Sem permissão.' })
  async updateNotes(
    @Req() req,
    @Param('id') id: string,
    @Body() body: { notes?: string | null },
  ) {
    const user = req.user;
    const canEditFlow = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:flow',
    );
    const canEditReceivable = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:receivable',
    );
    if (!canEditFlow && !canEditReceivable) {
      throw new ForbiddenException(
        'Sem permissão para editar observações desta conta a receber.',
      );
    }
    return this.receivableService.updateTitle(
      id,
      { notes: body.notes } as any,
      user.userId,
      user.name,
    );
  }
}
