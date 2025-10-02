import { Controller, Get, UseGuards, Query, Req, Param } from '@nestjs/common';
import { FlowService } from './flow.service';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FinancialFlowFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';

const RESOURCE = 'flow';
const GROUP = 'financial';

@ApiTags('Fluxo Financeiro')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class FlowController {
  constructor(private readonly flowService: FlowService) {}

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os fluxos financeiros' })
  @ApiResponse({
    status: 200,
    description: 'Lista de fluxos financeiros retornada com sucesso.',
    isArray: true,
  })
  findAll(@Req() req, @Query() filter: FinancialFlowFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.flowService.findAll(filter);
  }

  @Get('totals')
  @ApiOperation({ summary: 'Obtém os totais de todos os fluxos financeiros' })
  @ApiResponse({
    status: 200,
    description: 'Valores totais de fluxos financeiros retornada com sucesso.',
    isArray: true,
  })
  findAllTotals(@Req() req, @Query() filter: FinancialFlowFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.flowService.findAllTotals(filter);
  }

  @Get('receivable/:id/details')
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
  async getReceivableDetails(@Param('id') id: string) {
    // Usar o ReceivableService para buscar detalhes completos
    return this.flowService.getReceivableDetails(id);
  }

  @Get('payable/:id/details')
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
  async getPayableDetails(@Param('id') id: string) {
    // Usar o PayableService para buscar detalhes completos
    return this.flowService.getPayableDetails(id);
  }

  @Get('overdue/last-7-days')
  @ApiOperation({
    summary:
      'Verifica se existem contas atrasadas nos últimos 7 dias e retorna a data da mais antiga',
  })
  @ApiResponse({
    status: 200,
    description: 'Informações sobre contas atrasadas retornadas com sucesso.',
  })
  async getOverdueAccountsLast7Days(@Req() req) {
    return this.flowService.getOverdueAccountsLast7Days(req.user.companyId);
  }
}
