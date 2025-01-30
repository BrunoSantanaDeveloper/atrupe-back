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
} from '@nestjs/common';
import { PayableService } from './payable.service';

import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
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
} from './dto/update-payable.dto';
import { ReceivableFilterDto } from '../receivable/dto/receivable-filter.dto';
import { CompensateDto } from '../receivable/dto/create-receivable.dto';

const RESOURCE = 'payable';
const GROUP = 'financial';

@ApiTags('Contas a Pagar')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class PayableController {
  constructor(private readonly payableService: PayableService) {}

  @Post()
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
    return this.payableService.create(createPayableDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as contas a pagar' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas a pagar retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() paginationDto: ReceivableFilterDto) {
    paginationDto.companyId = req.user.companyId;
    return await this.payableService.findAll(paginationDto);
  }

  @Get(':id')
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

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar dados do título' })
  @ApiParam({
    name: 'id',
    description: 'ID do título',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiResponse({ status: 200, description: 'Título atualizado com sucesso.' })
  @ApiResponse({ status: 404, description: 'Título não encontrado.' })
  async updateTitle(@Param('id') id: string, @Body() dto: UpdatePayableDto) {
    return await this.payableService.updateTitle(id, dto);
  }

  @Patch(':id/upsert-installments')
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
    @Param('id') id: string,
    @Body()
    updatePayableInstallmentsDto: UpdatePayableInstallmentsDto,
  ) {
    return this.payableService.updateInstallments(
      id,
      updatePayableInstallmentsDto,
    );
  }
  @Patch(':id/cancel')
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
    @Param('id') id: string,
    @Body() cancelPayableDto: CancelPayableDto,
  ) {
    return await this.payableService.cancel(id, cancelPayableDto);
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
    @Param('installmentId') installmentId: string,
    @Body() payInstallmentDto: PayInstallmentDto,
  ) {
    return this.payableService.payInstallment(installmentId, payInstallmentDto);
  }

  @Patch('compensate/:installmentId')
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
  async undoPaymentInstallment(@Param('installmentId') installmentId: string) {
    return this.payableService.undoPaymentInstallment(installmentId);
  }

  @Delete(':id')
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
}
