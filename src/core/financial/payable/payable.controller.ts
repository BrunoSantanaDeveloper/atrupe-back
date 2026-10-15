import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { PayableService } from './payable.service';

import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ValuesOnly } from 'src/core/auth/abac/money-fields.decorator';
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
import {
  CreatePayableDto,
  UpdatePayableInstallmentsDto,
} from './dto/create-payable.dto';
import {
  UpdatePayableDto,
  CancelPayableDto,
  PayInstallmentDto,
  UndoCancelPayableDto,
} from './dto/update-payable.dto';
import { PayableFilterDto } from './dto/payable-filter.dto';
import { CompensateDto } from '../receivable/dto/create-receivable.dto';

const RESOURCE = 'payable';
const GROUP = 'financial';

@ApiTags('Contas a Pagar')
@UseGuards(JwtAuthGuard, PermissionsGuard, TenantGuard)
@ApiBearerAuth()
// Tudo aqui é valor: sem values:values:view a rota é recusada (por
// enquanto só observa, ver ValuesVisibilityInterceptor)
@ValuesOnly()
@Controller(`${GROUP}/${RESOURCE}`)
export class PayableController {
  constructor(
    private readonly planControl: PlanControlService,
    private readonly payableService: PayableService,
    private readonly abacService: AbacService,
  ) {}

  @Post()
  @HasAnyPermission(
    { action: 'create', resource: 'financial:payable' },
    { action: 'create', resource: 'financial:flow' },
  )
  @ApiOperation({ summary: 'Cria uma nova conta a pagar com parcelas' })
  @ApiBody({
    description: 'Dados da nova conta a pagar',
    type: CreatePayableDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Conta a pagar criada com sucesso.',
  })
  create(@Req() req, @Body() createPayableDto: CreatePayableDto) {
    createPayableDto.companyId = req.user.companyId;
    return this.payableService.create(
      createPayableDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Get()
  @HasAnyPermission(
    { action: 'view', resource: 'financial:payable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({ summary: 'Obtém a lista de todas as contas a pagar' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas a pagar retornada com sucesso.',
    isArray: true,
  })
  // A lista é a tela "A pagar" do plano; as ações sobre um lançamento
  // (pagar, cancelar, editar) servem também ao fluxo financeiro e ficam livres.
  @UseGuards(FeatureGuard)
  @RequiresFeature('accounts_payable')
  async findAll(@Req() req, @Query() paginationDto: PayableFilterDto) {
    paginationDto.companyId = req.user.companyId;
    return await this.payableService.findAll(paginationDto);
  }

  @Get(':id')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:payable' },
    { action: 'view', resource: 'financial:flow' },
  )
  // Chave nova numa rota que estava livre: observar antes de recusar
  @ObservePermissions()
  @TenantResource('payable')
  @ApiOperation({ summary: 'Obtém uma conta a pagar pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a pagar',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a pagar retornada com sucesso.',
  })
  @ApiResponse({ status: 404, description: 'Conta a pagar não encontrada.' })
  findOne(@Param('id') id: string) {
    return this.payableService.findOne(id);
  }

  @Get(':id/history')
  @TenantResource('payable')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:payable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary: 'Obtém o histórico de alterações de uma conta a pagar',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a pagar',
  })
  @ApiResponse({
    status: 200,
    description: 'Histórico retornado com sucesso.',
  })
  getHistory(@Param('id') id: string) {
    return this.payableService.getHistory(id);
  }

  @Get(':id/details')
  @TenantResource('payable')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:payable' },
    { action: 'view', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary:
      'Obtém detalhes completos de uma conta a pagar com todas as parcelas',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a pagar',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalhes da conta a pagar retornados com sucesso.',
  })
  @ApiResponse({ status: 404, description: 'Conta a pagar não encontrada.' })
  async getDetails(@Param('id') id: string) {
    return this.payableService.findOne(id);
  }

  @Patch(':id')
  @TenantResource('payable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:payable' },
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
    @Body() dto: UpdatePayableDto,
  ) {
    return await this.payableService.updateTitle(
      id,
      dto,
      req.user.userId,
      req.user.name,
    );
  }

  @Patch(':id/upsert-installments')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:payable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  // Chave nova numa rota que estava livre: observar antes de recusar
  @ObservePermissions()
  @TenantResource('payable')
  @ApiResponse({
    status: 200,
    description: 'Parcelas adicionadas, editadas ou removidas com sucesso',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a pagar',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao processar as parcelas',
  })
  async upsertInstallments(
    @Req() req,
    @Param('id') id: string,
    @Body()
    updatePayableInstallmentsDto: UpdatePayableInstallmentsDto,
  ) {
    const user = req.user;
    const canEditFlow = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:flow',
    );
    const canEditPayable = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:payable',
    );
    if (!canEditFlow && !canEditPayable) {
      throw new ForbiddenException(
        'Sem permissão para editar parcelas desta conta a pagar.',
      );
    }
    return this.payableService.updateInstallments(
      id,
      updatePayableInstallmentsDto,
      user.userId,
      user.name,
    );
  }
  @Patch(':id/cancel')
  @TenantResource('payable')
  @HasAnyPermission(
    { action: 'delete', resource: 'financial:payable' },
    { action: 'delete', resource: 'financial:flow' },
  )
  @ApiOperation({
    summary: 'Cancela uma conta a pagar e suas parcelas pendentes',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a pagar',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a pagar cancelada com sucesso.',
  })
  async cancel(
    @Req() req,
    @Param('id') id: string,
    @Body() cancelPayableDto: CancelPayableDto,
  ) {
    // Motivo e observação ao cancelar são do plano; cancelar sem eles é livre.
    // Texto vazio conta como não informado (a tela sem o recurso manda '').
    if (
      cancelPayableDto.cancelReason?.trim() ||
      cancelPayableDto.cancelNotes?.trim()
    ) {
      await this.planControl.enforceFeature(
        req.user.companyId,
        'transaction_cancel_reasons',
      );
    }
    return await this.payableService.cancel(
      id,
      cancelPayableDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Post(':id/undo-cancel')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:payable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  // Chave nova numa rota que estava livre: observar antes de recusar
  @ObservePermissions()
  @TenantResource('payable')
  @ApiOperation({
    summary: 'Desfaz o cancelamento de uma conta a pagar',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a pagar',
  })
  @ApiResponse({
    status: 200,
    description: 'Cancelamento da conta a pagar desfeito com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro: conta não está cancelada ou possui parcelas pagas.',
  })
  async undoCancel(
    @Req() req,
    @Param('id') id: string,
    @Body() undoCancelPayableDto: UndoCancelPayableDto,
  ) {
    const user = req.user;
    const canEditFlow = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:flow',
    );
    const canEditPayable = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:payable',
    );
    if (!canEditFlow && !canEditPayable) {
      throw new ForbiddenException(
        'Sem permissão para desfazer cancelamento desta conta a pagar.',
      );
    }
    return await this.payableService.undoCancel(
      id,
      undoCancelPayableDto,
      user.userId,
      user.name,
    );
  }

  @Patch('pay-installment/:installmentId')
  @TenantResource('payableInstallment', 'installmentId', 'payable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:payable' },
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
    return this.payableService.payInstallment(
      installmentId,
      payInstallmentDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Patch('compensate/:installmentId')
  @TenantResource('payableInstallment', 'installmentId', 'payable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:payable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  async compensateInstallment(
    @Param('installmentId') installmentId: string,
    @Body() compensateDto: CompensateDto,
  ) {
    await this.payableService.compensateInstallment(
      installmentId,
      compensateDto,
    );
    return { message: 'Compensação realizada com sucesso.' };
  }

  @Patch('unpay-installment/:installmentId')
  @TenantResource('payableInstallment', 'installmentId', 'payable')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:payable' },
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
    return this.payableService.undoPaymentInstallment(
      installmentId,
      req.user.userId,
      req.user.name,
      !!req.user.isAdmin,
      req.body?.reason,
    );
  }

  @Delete(':id')
  @TenantResource('payable')
  @HasAnyPermission(
    { action: 'delete', resource: 'financial:payable' },
    { action: 'delete', resource: 'financial:flow' },
  )
  @ApiOperation({ summary: 'Remove uma conta a pagar pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a pagar',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a pagar removida com sucesso.',
  })
  @ApiResponse({ status: 404, description: 'Conta a pagar não encontrada.' })
  remove(@Param('id') id: string) {
    return this.payableService.remove(id);
  }

  /**
   * Endpoint dedicado para atualizar apenas a observação de uma conta a pagar.
   * Aceita tanto `financial:flow:edit` (visão do fluxo) quanto `financial:payable:edit`.
   */
  @Patch(':id/notes')
  @HasAnyPermission(
    { action: 'edit', resource: 'financial:payable' },
    { action: 'edit', resource: 'financial:flow' },
  )
  // Chave nova numa rota que estava livre: observar antes de recusar
  @ObservePermissions()
  @TenantResource('payable')
  @ApiOperation({ summary: 'Atualiza a observação de uma conta a pagar' })
  @ApiParam({ name: 'id', required: true, description: 'ID da conta a pagar' })
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
    const canEditPayable = await this.abacService.hasPermission(
      user,
      'edit',
      'financial:payable',
    );
    if (!canEditFlow && !canEditPayable) {
      throw new ForbiddenException(
        'Sem permissão para editar observações desta conta a pagar.',
      );
    }
    return this.payableService.updateTitle(
      id,
      { notes: body.notes } as any,
      user.userId,
      user.name,
    );
  }
}
