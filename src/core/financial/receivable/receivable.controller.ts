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
import { CreateReceivableDto } from './dto/create-receivable.dto';
import {
  AddInstallmentArrayDto,
  UpdateReceivableDto,
  UpdateReceivableInstallmentDto,
} from './dto/update-receivable.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

const RESOURCE = 'receivable';
const GROUP = 'financial';

@ApiTags('Contas a Receber')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class ReceivableController {
  constructor(private readonly receivableService: ReceivableService) {}

  @Post()
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
    return this.receivableService.create(createReceivableDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as contas a receber' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas a receber retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() paginationDto: BaseFilterDTO) {
    return this.receivableService.findAll(paginationDto);
  }

  @Get(':id')
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

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar dados do título' })
  @ApiParam({
    name: 'id',
    description: 'ID do título',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiResponse({ status: 200, description: 'Título atualizado com sucesso.' })
  @ApiResponse({ status: 404, description: 'Título não encontrado.' })
  async updateTitle(@Param('id') id: string, @Body() dto: UpdateReceivableDto) {
    return await this.receivableService.updateTitle(id, dto);
  }

  @Post(':id/installments')
  @ApiOperation({ summary: 'Adicionar novas parcelas ao título' })
  @ApiParam({
    name: 'id',
    description: 'ID do título',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiResponse({
    status: 201,
    description: 'Parcelas adicionadas com sucesso.',
  })
  @ApiResponse({ status: 404, description: 'Título não encontrado.' })
  async addInstallments(
    @Param('id') id: string,
    @Body() newInstallments: AddInstallmentArrayDto,
  ) {
    return await this.receivableService.addInstallments(id, newInstallments);
  }

  @Patch(':id/installments/:installmentId')
  @ApiOperation({ summary: 'Atualizar parcelas do título' })
  @ApiParam({
    name: 'id',
    description: 'ID do título',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiParam({
    name: 'installmentId',
    description: 'ID da parcela',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiResponse({
    status: 200,
    description: 'Parcelas atualizadas com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Título ou parcela não encontrados.',
  })
  async updateInstallments(
    @Param('id') id: string,
    @Param('installmentId') installmentId: string,
    @Body() installments: UpdateReceivableInstallmentDto,
  ) {
    return await this.receivableService.updateInstallments(
      id,
      installmentId,
      installments,
    );
  }
  @Patch(':id/cancel')
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
  async cancel(@Param('id') id: string) {
    return await this.receivableService.cancel(id);
  }
  @Delete(':id/installments/:installmentId')
  @ApiOperation({ summary: 'Remover parcelas do título' })
  @ApiParam({
    name: 'id',
    description: 'ID do título',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiParam({
    name: 'installmentId',
    description: 'ID da parcela',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @ApiResponse({ status: 200, description: 'Parcelas removidas com sucesso.' })
  @ApiResponse({
    status: 404,
    description: 'Título ou parcela não encontrados.',
  })
  async removeInstallments(
    @Param('id') id: string,
    @Param('installmentId') installmentId: string,
  ) {
    return await this.receivableService.removeInstallment(id, installmentId);
  }

  @Delete(':id')
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
}
