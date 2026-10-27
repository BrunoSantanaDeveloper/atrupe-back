import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Patch,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { CompanyManagementService } from './company-management.service';
import { SubscriptionBlockService } from './subscription-block.service';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { ListTrialCompaniesDto } from './dto/list-trial-companies.dto';
import { ListIncompleteRegistrationsDto } from './dto/list-incomplete-registrations.dto';
import { ListActiveClientsDto } from './dto/list-active-clients.dto';
import { UpdateActiveClientDto } from './dto/update-active-client.dto';
import { SyncAddressDto } from './dto/sync-address.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { ChangePlanAdminDto } from './dto/change-plan-admin.dto';
import { QuoteSubscriptionDto } from './dto/quote-subscription.dto';
import { SubscriptionQuoteService } from './pricing/subscription-quote.service';
import { ComplementsService } from './checkout/complements.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { BlockLevel } from '@prisma/client';

@ApiTags('subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly adminDashboardService: AdminDashboardService,
    private readonly companyManagementService: CompanyManagementService,
    private readonly subscriptionBlockService: SubscriptionBlockService,
    private readonly subscriptionQuoteService: SubscriptionQuoteService,
    private readonly complementsService: ComplementsService,
  ) {}

  @Get('incomplete-registrations')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'List incomplete registrations (unverified emails)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of incomplete registrations',
  })
  async listIncompleteRegistrations(
    @Query() query: ListIncompleteRegistrationsDto,
  ) {
    return await this.adminDashboardService.listIncompleteRegistrations(
      query.page,
      query.limit,
      query.sort,
      query.search,
    );
  }

  @Get('trial-companies/totals')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Get trial subscriptions totals by status' })
  @ApiResponse({
    status: 200,
    description: 'Trial subscriptions totals',
  })
  async getTrialTotals() {
    return await this.adminDashboardService.getTrialTotals();
  }

  @Get('trial-companies')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'List all companies with trial subscriptions' })
  @ApiResponse({
    status: 200,
    description: 'List of companies with trial subscriptions',
  })
  async listTrialCompanies(@Query() query: ListTrialCompaniesDto) {
    return await this.adminDashboardService.listTrialCompanies(
      query.page,
      query.limit,
      query.status,
      query.sort,
      query.search,
    );
  }

  @Get('active-clients/totals')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Get active clients totals by status' })
  @ApiResponse({
    status: 200,
    description: 'Active clients totals',
  })
  async getActiveTotals() {
    return await this.adminDashboardService.getActiveTotals();
  }

  @Get('active-clients')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'List all companies with active subscriptions (non-trial)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of companies with active subscriptions',
  })
  async listActiveClients(@Query() query: ListActiveClientsDto) {
    return await this.adminDashboardService.listActiveClients(query);
  }

  @Get('active-clients/export')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Lista de Gerenciar contas para exportar (apenas SystemAdmin)',
    description:
      'As mesmas contas e filtros da listagem, sem paginação: a planilha da equipe de cobrança.',
  })
  @ApiResponse({ status: 200, description: 'Contas filtradas' })
  async exportActiveClients(@Query() query: ListActiveClientsDto) {
    return await this.adminDashboardService.exportActiveClients(query);
  }

  @Get('active-clients/filters')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Opções dos filtros de Gerenciar contas (apenas SystemAdmin)',
    description:
      'Os módulos pagos (inclusive os que saíram de venda e seguem contratados) e as UFs dos endereços principais.',
  })
  @ApiResponse({ status: 200, description: 'Módulos e UFs' })
  async getAccountFilterOptions() {
    return await this.adminDashboardService.getAccountFilterOptions();
  }

  @Get('active-clients/:companyId/details')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Detalhe de uma conta para a cobrança (apenas SystemAdmin)',
    description:
      'Plano, módulos e usuários contratados, usuários em uso, últimas cobranças e mudanças de plano e de complementos.',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Detalhe da conta' })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada ou sem assinatura de plano pago',
  })
  async getAccountDetails(@Param('companyId') companyId: string) {
    return await this.adminDashboardService.getAccountDetails(companyId);
  }

  @Get('active-clients/:companyId/check-asaas')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Verifica status da subscription no Asaas (apenas SystemAdmin)',
    description:
      'Compara o status local com o status no Asaas sem fazer alterações. Útil para verificar antes de sincronizar.',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({
    status: 200,
    description: 'Status verificado',
  })
  async checkAsaasStatus(@Param('companyId') companyId: string) {
    return await this.subscriptionsService.checkAsaasStatus(companyId);
  }

  @Post('active-clients/:companyId/sync-asaas')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary:
      'Sincroniza cobranças e status da subscription com o Asaas (apenas SystemAdmin)',
    description:
      'Alinha as cobranças da empresa ao Asaas (cria as que faltam, atualiza status e baixa as removidas lá) e depois reavalia ativação e bloqueio. Devolve, em `charges`, quantas foram criadas, atualizadas e baixadas.',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({
    status: 200,
    description: 'Status sincronizado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao sincronizar status',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema',
  })
  async syncWithAsaas(@Param('companyId') companyId: string, @Req() req) {
    return await this.subscriptionsService.syncCompanyWithAsaas(
      companyId,
      req.user.userId,
    );
  }

  @Get('active-clients/:companyId/customer-address')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Retorna endereço do customer da empresa (SystemAdmin)',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Endereço retornado' })
  async getCustomerAddress(@Param('companyId') companyId: string) {
    return await this.companyManagementService.getCustomerAddress(companyId);
  }

  @Patch('active-clients/:companyId/sync-address-asaas')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Atualiza endereço do customer local e no Asaas (SystemAdmin)',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiBody({ type: SyncAddressDto })
  @ApiResponse({ status: 200, description: 'Endereço sincronizado' })
  async syncAddressToAsaas(
    @Param('companyId') companyId: string,
    @Body() dto: SyncAddressDto,
    @Req() req: any,
  ) {
    return await this.companyManagementService.syncCustomerAddressToAsaas(
      companyId,
      dto,
      req.user.userId,
    );
  }

  @Get('active-clients/:companyId/history')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Get subscription history for a company',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({
    status: 200,
    description: 'Subscription history retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Company or subscription not found',
  })
  async getCompanyHistory(@Param('companyId') companyId: string) {
    return await this.adminDashboardService.getCompanyHistory(companyId);
  }

  @Patch('active-clients/:companyId')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Atualiza dados de um cliente ativo (apenas SystemAdmin)',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiBody({
    description: 'Dados para atualizar o cliente',
    type: UpdateActiveClientDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Cliente atualizado com sucesso',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada',
  })
  async updateActiveClient(
    @Param('companyId') companyId: string,
    @Body() updateDto: UpdateActiveClientDto,
    @Req() req,
  ) {
    return await this.companyManagementService.updateActiveClient(
      companyId,
      updateDto,
      req.user.userId,
    );
  }

  @Patch('active-clients/:companyId/change-plan')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Troca o plano de uma empresa (apenas SystemAdmin)',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiBody({
    description: 'Novo plano e senha gerencial',
    type: ChangePlanAdminDto,
  })
  @ApiResponse({ status: 200, description: 'Plano alterado com sucesso' })
  @ApiResponse({
    status: 400,
    description: 'Plano indisponível, sem preço ou igual ao atual',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema',
  })
  @ApiResponse({
    status: 404,
    description: 'Assinatura ou plano não encontrado',
  })
  async changePlanAsAdmin(
    @Param('companyId') companyId: string,
    @Body() changePlanDto: ChangePlanAdminDto,
    @Req() req,
  ) {
    return await this.subscriptionsService.changePlanAsAdmin(
      companyId,
      changePlanDto.planId,
      changePlanDto.password,
      req.user.userId,
    );
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Orçamento da contratação',
    description:
      'Calcula o que seria cobrado (ciclo, módulos, usuários, cupom, crédito de evolução e parcelamento) sem criar nada. Usa o mesmo motor de preço da contratação.',
  })
  async quote(@Body() quoteDto: QuoteSubscriptionDto, @Req() req) {
    this.assertSubscriptionAdmin(req);
    return this.subscriptionQuoteService.quote(req.user.companyId, quoteDto);
  }

  @Get('plan-states')
  @ApiOperation({
    summary: 'Trilha de planos',
    description:
      'Estado de cada plano do Método para a empresa: concluído, atual, elegível, em breve ou bloqueado.',
  })
  async planStates(@Req() req) {
    this.assertSubscriptionAdmin(req);
    return this.subscriptionQuoteService.getPlanStates(req.user.companyId);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active subscription for company' })
  @ApiResponse({
    status: 200,
    description: 'Active subscription found',
  })
  @ApiResponse({ status: 404, description: 'No active subscription found' })
  async getActive(@Req() req) {
    this.assertSubscriptionAdmin(req);
    return await this.subscriptionsService.findActiveByCompanyId(
      req.user.companyId,
    );
  }

  @Post('check-status')
  @ApiOperation({
    summary: 'Check and sync subscription status with Asaas',
    description:
      'Verifica o status do pagamento diretamente no Asaas e atualiza a subscription local se o pagamento foi confirmado. Útil em ambientes sandbox onde o webhook pode não ser disparado automaticamente.',
  })
  @ApiResponse({
    status: 200,
    description: 'Status verificado e sincronizado',
    schema: {
      example: {
        status: 'activated',
        subscription: {
          id: 'sub_123',
          status: 'ACTIVE',
          plan: {
            name: 'Plano Pro',
          },
        },
        payment: {
          id: 'pay_123',
          status: 'CONFIRMED',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao verificar status',
  })
  async checkSubscriptionStatus(@Req() req) {
    this.assertSubscriptionAdmin(req);
    return await this.subscriptionsService.checkAndSyncSubscriptionStatus(
      req.user.companyId,
    );
  }

  @Post('assign-manual')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary:
      'Atribui o plano START manualmente a uma empresa (apenas SystemAdmin)',
  })
  @ApiBody({
    description: 'Dados para atribuir o plano START à empresa',
    type: AssignSubscriptionDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Plano START atribuído com sucesso',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema.',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada ou plano START não existe no sistema.',
  })
  async assignManual(@Body() assignDto: AssignSubscriptionDto, @Req() req) {
    return await this.companyManagementService.assignManual(
      assignDto,
      req.user.userId,
    );
  }

  @Patch(':id/extend-trial')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary:
      'Estende o período trial por mais 7 dias a partir de hoje (apenas SystemAdmin)',
  })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiBody({
    description: 'Senha do administrador para autorizar a extensão',
    type: ExtendTrialDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Trial period extended successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Only TRIAL subscriptions can be extended',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema.',
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async extendTrialPeriod(
    @Param('id') subscriptionId: string,
    @Body() extendTrialDto: ExtendTrialDto,
    @Req() req,
  ) {
    return await this.subscriptionsService.extendTrialPeriod(
      subscriptionId,
      extendTrialDto.password,
      req.user.userId,
    );
  }

  @Delete(':id/modules/:moduleId')
  @ApiOperation({
    summary: 'Retira um módulo da assinatura',
    description:
      'O acesso sai na hora e o valor sai das mensalidades ainda não pagas.',
  })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiParam({ name: 'moduleId', description: 'Module ID to remove' })
  @ApiResponse({
    status: 200,
    description: 'Module removed successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subscription or Module not found' })
  async removeModule(
    @Param('id') subscriptionId: string,
    @Param('moduleId') moduleId: string,
    @Req() req,
  ) {
    return await this.complementsService.removeModule(
      this.contractingUser(req),
      subscriptionId,
      moduleId,
    );
  }

  /**
   * A assinatura é do administrador (pacote de 26/10/2026, item 8): o cargo
   * não a concede mais. Ver, cotar, conferir o pagamento e cancelar pedem o
   * administrador; contratar, evoluir e retirar módulo seguem pedindo o
   * administrador principal (Usuário nº 1).
   */
  private assertSubscriptionAdmin(req) {
    if (req.user?.isAdmin || req.user?.isSystemAdmin) return;
    throw new ForbiddenException(
      'Só o administrador da conta vê e gerencia a assinatura',
    );
  }

  private contractingUser(req) {
    return {
      userId: req.user.userId,
      companyId: req.user.companyId,
      isAdmin: !!req.user.isAdmin,
    };
  }

  @Delete(':id/cancel')
  @ApiOperation({
    summary: 'Cancela a assinatura do usuário',
    description:
      'Cancela a subscription no Asaas e marca como CANCELED no banco. Registra motivo e feedback no histórico.',
  })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiBody({
    description: 'Motivo e feedback do cancelamento',
    type: CancelSubscriptionDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Assinatura cancelada com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Subscription não pode ser cancelada (status inválido)',
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription não encontrada',
  })
  async cancelSubscription(
    @Param('id') subscriptionId: string,
    @Body() cancelDto: CancelSubscriptionDto,
    @Req() req,
  ) {
    this.assertSubscriptionAdmin(req);
    return await this.subscriptionsService.cancelSubscription(
      subscriptionId,
      cancelDto,
      req.user.companyId,
      req.user.userId,
    );
  }

  @Delete(':companyId/delete-account')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Exclui uma conta completamente do sistema (apenas SystemAdmin)',
    description:
      'Remove permanentemente uma empresa e todos os seus dados relacionados. Esta ação é irreversível.',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID to delete' })
  @ApiBody({
    description: 'Senha do administrador para autorizar a exclusão',
    type: DeleteAccountDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Conta excluída permanentemente com sucesso',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada',
  })
  async deleteAccount(
    @Param('companyId') companyId: string,
    @Body() deleteDto: DeleteAccountDto,
    @Req() req,
  ) {
    return await this.companyManagementService.deleteCompany(
      companyId,
      deleteDto.password,
      req.user.userId,
    );
  }

  // ============== Blocked Companies Endpoints ==============

  @Get('blocked-companies')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Lista empresas bloqueadas ou inativas (apenas SystemAdmin)',
  })
  @ApiQuery({ name: 'status', enum: ['PARTIAL', 'FULL'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de empresas bloqueadas',
  })
  async listBlockedCompanies(@Query('status') status?: BlockLevel) {
    return await this.subscriptionBlockService.listBlockedCompanies(status);
  }

  @Post('blocked-companies/:companyId/unblock')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Desbloqueia uma empresa manualmente (apenas SystemAdmin)',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({
    status: 200,
    description: 'Empresa desbloqueada com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada',
  })
  async unblockCompany(@Param('companyId') companyId: string, @Req() req) {
    return await this.subscriptionBlockService.manualUnblock(
      companyId,
      req.user.userId,
    );
  }

  @Get('blocked-companies/:companyId/status')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary: 'Obtém status de bloqueio de uma empresa (apenas SystemAdmin)',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({
    status: 200,
    description: 'Status de bloqueio da empresa',
  })
  async getBlockStatus(@Param('companyId') companyId: string) {
    return await this.subscriptionBlockService.getBlockStatus(companyId);
  }

  @Post('blocked-companies/run-check')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({
    summary:
      'Executa verificação completa (bloqueio + desbloqueio) manualmente (apenas SystemAdmin)',
    description:
      'Executa o mesmo fluxo do cron: bloqueia inadimplentes e desbloqueia quem já pagou.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verificação executada com sucesso',
  })
  async runBlockCheck() {
    return await this.subscriptionBlockService.handleCron();
  }

  @Get('my-payments')
  @ApiOperation({
    summary: 'Lista pagamentos da assinatura do usuário logado',
    description:
      'Retorna lista paginada de pagamentos vinculados à subscription ativa da empresa do usuário.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Lista de pagamentos',
  })
  async getMyPayments(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.subscriptionsService.listPaymentsByCompanyId(
      req.user.companyId,
      Number(page) || 1,
      Number(limit) || 10,
    );
  }

  @Get('my-pending-payment')
  @ApiOperation({
    summary: 'Obtém URL de pagamento pendente para a empresa do usuário logado',
    description:
      'Retorna a URL de pagamento (invoice) do Asaas se houver pagamento pendente ou em atraso.',
  })
  @ApiResponse({
    status: 200,
    description: 'URL de pagamento pendente',
  })
  async getMyPendingPayment(@Req() req) {
    const user = req.user;
    const companyId = user.companyId;
    if (!companyId) {
      return { paymentUrl: null, dueDate: null };
    }
    return await this.subscriptionBlockService.getPendingPaymentUrl(companyId);
  }
}
