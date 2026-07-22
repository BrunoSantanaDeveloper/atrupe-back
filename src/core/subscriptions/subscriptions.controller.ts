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
  UseInterceptors,
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
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { ListTrialCompaniesDto } from './dto/list-trial-companies.dto';
import { ListIncompleteRegistrationsDto } from './dto/list-incomplete-registrations.dto';
import { ListActiveClientsDto } from './dto/list-active-clients.dto';
import { UpdateActiveClientDto } from './dto/update-active-client.dto';
import { SyncAddressDto } from './dto/sync-address.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { ChangePlanAdminDto } from './dto/change-plan-admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
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
    return await this.adminDashboardService.listActiveClients(
      query.page,
      query.limit,
      query.status,
      query.search,
      query.sort,
    );
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
    summary: 'Sincroniza status da subscription com Asaas (apenas SystemAdmin)',
    description:
      'Verifica o status do pagamento diretamente no Asaas e atualiza a subscription local se necessário. Útil quando webhook ou cronjob falham.',
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
  async syncWithAsaas(@Param('companyId') companyId: string) {
    return await this.subscriptionsService.checkAndSyncSubscriptionStatus(
      companyId,
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
      req.user.id,
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

  @Get('active')
  @ApiOperation({ summary: 'Get active subscription for company' })
  @ApiResponse({
    status: 200,
    description: 'Active subscription found',
  })
  @ApiResponse({ status: 404, description: 'No active subscription found' })
  async getActive(@Req() req) {
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

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create a new subscription' })
  @ApiResponse({
    status: 201,
    description: 'Subscription created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Customer or Plan not found' })
  @ApiResponse({
    status: 409,
    description: 'Request already being processed (duplicate idempotency key)',
  })
  async create(
    @Body() createSubscriptionDto: CreateSubscriptionDto,
    @Req() req,
  ) {
    createSubscriptionDto.companyId = req.user.companyId;
    return await this.subscriptionsService.create(createSubscriptionDto, req);
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

  @Patch('change-plan')
  @ApiOperation({
    summary:
      'Troca o plano da assinatura atual da empresa (in-place). Disponível mesmo com a conta bloqueada por inadimplência — a cobrança em aberto é preservada e continua sendo o que restaura o acesso.',
  })
  @ApiResponse({ status: 200, description: 'Plano alterado com sucesso' })
  @ApiResponse({
    status: 400,
    description: 'Plano indisponível, sem preço ou igual ao atual',
  })
  @ApiResponse({
    status: 404,
    description: 'Assinatura ou plano não encontrado',
  })
  async changePlan(@Body() changePlanDto: UpgradeSubscriptionDto, @Req() req) {
    return await this.subscriptionsService.changePlan(
      req.user.companyId,
      changePlanDto.planId,
    );
  }

  @Patch(':id/upgrade')
  @ApiOperation({ summary: 'Upgrade subscription to a new plan' })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiResponse({
    status: 200,
    description: 'Subscription upgraded successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subscription or Plan not found' })
  async upgrade(
    @Param('id') subscriptionId: string,
    @Body() upgradeDto: UpgradeSubscriptionDto,
    @Req() req,
  ) {
    return await this.subscriptionsService.upgrade(
      subscriptionId,
      upgradeDto.planId,
      req,
    );
  }

  @Patch(':id/modules/:moduleId')
  @ApiOperation({ summary: 'Add module to subscription' })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiParam({ name: 'moduleId', description: 'Module ID to add' })
  @ApiQuery({
    name: 'couponCode',
    required: false,
    description: 'Código do cupom de desconto',
  })
  @ApiResponse({
    status: 200,
    description: 'Module added successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subscription or Module not found' })
  async addModule(
    @Param('id') subscriptionId: string,
    @Param('moduleId') moduleId: string,
    @Query('couponCode') couponCode: string,
    @Req() req,
  ) {
    return await this.subscriptionsService.addModule(
      subscriptionId,
      moduleId,
      req,
      couponCode,
    );
  }

  @Delete(':id/modules/:moduleId')
  @ApiOperation({ summary: 'Remove module from subscription' })
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
    return await this.subscriptionsService.removeModule(
      subscriptionId,
      moduleId,
      req,
    );
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
    return await this.subscriptionsService.cancelSubscription(
      subscriptionId,
      cancelDto,
      req.user.companyId,
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
