import { Controller, Get, UseGuards, Query, Req, Param } from '@nestjs/common';
import { FlowService } from './flow.service';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { FinancialFlowFilterDTO } from './dto/filter.dto';
import { PlanControlService } from 'src/core/plan/plan-control.service';
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
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class FlowController {
  constructor(
    private readonly flowService: FlowService,
    private readonly planControl: PlanControlService,
  ) {}

  /**
   * O fluxo filtrado por cliente ou fornecedor é a aba Financeiro do
   * cadastro, recurso de plano. O fluxo da empresa (sem esse filtro) é livre.
   */
  private async enforceEntityTabs(
    companyId: string,
    filter: FinancialFlowFilterDTO,
  ) {
    if (filter.clientId) {
      await this.planControl.enforceFeature(
        companyId,
        'client_additional_tabs',
      );
    }
    if (filter.supplierId) {
      await this.planControl.enforceFeature(
        companyId,
        'supplier_additional_tabs',
      );
    }
  }

  @Get()
  @HasAnyPermission({ action: 'view', resource: 'financial:flow' })
  @ApiOperation({ summary: 'Obtém a lista de todos os fluxos financeiros' })
  @ApiResponse({
    status: 200,
    description: 'Lista de fluxos financeiros retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() filter: FinancialFlowFilterDTO) {
    filter.companyId = req.user.companyId;
    await this.enforceEntityTabs(req.user.companyId, filter);
    return this.flowService.findAll(filter);
  }

  @Get('export')
  @HasAnyPermission({ action: 'export', resource: 'financial:flow' })
  @ApiOperation({
    summary: 'ObtÃ©m os fluxos financeiros filtrados para exportaÃ§Ã£o',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de fluxos financeiros para exportaÃ§Ã£o retornada com sucesso.',
  })
  async export(@Req() req, @Query() filter: FinancialFlowFilterDTO) {
    filter.companyId = req.user.companyId;
    await this.enforceEntityTabs(req.user.companyId, filter);
    return this.flowService.findAllForExport(filter);
  }

  @Get('totals')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:flow' },
    { action: 'view', resource: 'dashboard:financial' },
  )
  @ApiOperation({ summary: 'Obtém os totais de todos os fluxos financeiros' })
  @ApiResponse({
    status: 200,
    description: 'Valores totais de fluxos financeiros retornada com sucesso.',
    isArray: true,
  })
  async findAllTotals(@Req() req, @Query() filter: FinancialFlowFilterDTO) {
    filter.companyId = req.user.companyId;
    await this.enforceEntityTabs(req.user.companyId, filter);
    return this.flowService.findAllTotals(filter);
  }

  @Get('receivable/:id/details')
  @HasAnyPermission({ action: 'view', resource: 'financial:flow' })
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
  @HasAnyPermission({ action: 'view', resource: 'financial:flow' })
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
  @HasAnyPermission({ action: 'view', resource: 'financial:flow' })
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
