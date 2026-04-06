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
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
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
  constructor(private readonly receivableService: ReceivableService) {}

  @Post()
  @HasPermission('create', 'financial:receivable')  @ApiOperation({ summary: 'Cria uma nova conta a receber com parcelas' })
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
  @HasPermission('view', 'financial:receivable')  @ApiOperation({ summary: 'Obtém a lista de todas as contas a receber' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas a receber retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() paginationDto: ReceivableFilterDto) {
    paginationDto.companyId = req.user.companyId;
    return await this.receivableService.findAll(paginationDto);
  }

  @Get(':id')
  @TenantResource('receivable')  @ApiOperation({ summary: 'Obtém uma conta a receber pelo ID' })
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
  @TenantResource('receivable')  @HasPermission('edit', 'financial:receivable')  @ApiOperation({ summary: 'Atualizar dados do título' })
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
    return this.receivableService.updateInstallments(
      id,
      updateReceivableInstallmentsDto,
      req.user.userId,
      req.user.name,
    );
  }
  @Patch(':id/cancel')
  @TenantResource('receivable')  @HasPermission('delete', 'financial:receivable')  @ApiOperation({
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
    return await this.receivableService.cancel(
      id,
      cancelReceivableDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Post(':id/undo-cancel')
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
    return await this.receivableService.undoCancel(
      id,
      undoCancelReceivableDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Patch('pay-installment/:installmentId')
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
    return this.receivableService.payInstallment(
      installmentId,
      payInstallmentDto,
      req.user.userId,
      req.user.name,
    );
  }

  @Patch('compensate/:installmentId')
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
  @TenantResource('receivable')  @HasPermission('delete', 'financial:receivable')  @ApiOperation({ summary: 'Remove uma conta a receber pelo ID' })
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

  @Get('installment/:installmentId/receipt-data')
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
    @Param('installmentId') installmentId: string,
    @Query('paidDate') paidDate?: string,
    @Query('paidAmount') paidAmount?: string,
  ): Promise<ReceiptDataResponseDto> {
    return this.receivableService.getReceiptData(
      installmentId,
      paidDate,
      paidAmount,
    );
  }
}
