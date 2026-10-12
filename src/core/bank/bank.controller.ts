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
  BadGatewayException,
} from '@nestjs/common';
import { BankService } from './bank.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankAccountDto, UpdateBankDto } from './dto/update-bank.dto';
import { CreateBankAccountDto } from './dto/create-account.dto';
import { AccountService } from './account.service';
import { BankAccountFilterDTO } from './dto/filter-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { PlanControlService } from '../plan/plan-control.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';
import { SystemAdminGuard } from 'src/core/auth/guards/system-admin.guard';

const RESOURCE = 'bank';

@ApiTags('Banco e Conta bancária')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class BankController {
  constructor(
    private readonly bankService: BankService,
    private readonly accountService: AccountService,
    private readonly planControl: PlanControlService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * O controle de caixa da conta e o tipo "provisionar" são recursos de
   * plano. Só a MUDANÇA é verificada: sem o recurso, a conta continua
   * editável (nome, descrição, condições aceitas) com o que já tinha.
   */
  private async enforceAccountFeatures(
    companyId: string,
    dto: UpdateBankAccountDto,
    accountId?: string,
  ) {
    const stored = accountId
      ? await this.prisma.bankAccount.findFirst({
          where: { id: accountId },
          include: { bankAccountCashControl: true },
        })
      : null;

    if (
      dto.cashControl !== undefined &&
      dto.cashControl !== null &&
      !!dto.cashControl !== (stored?.cashControl ?? false)
    ) {
      const allowed = await this.planControl.hasFeature(
        companyId,
        'bank_account_cash_control_switch',
      );
      if (!allowed) {
        // Sem o recurso, a mudança é ignorada e a conta mantém o que tinha. A
        // tela antiga mandava sempre "true" ao editar; recusar (403) quebraria
        // a edição da conta no Start.
        delete dto.cashControl;
      }
    }

    const provisionAdded = (dto.bankAccountCashControl ?? []).some((entry) => {
      const before = stored?.bankAccountCashControl.find(
        (c) =>
          (entry.id && c.id === entry.id) ||
          c.paymentConditionId === entry.paymentConditionId,
      );
      return (
        (entry.incomeType === 'PROVISION' &&
          before?.incomeType !== 'PROVISION') ||
        (entry.paymentType === 'PROVISION' &&
          before?.paymentType !== 'PROVISION')
      );
    });
    if (provisionAdded) {
      await this.planControl.enforceFeature(
        companyId,
        'bank_account_provision',
      );
    }
  }

  //---------------------------------------------------------------------------------
  // Bank
  //---------------------------------------------------------------------------------

  @Post()
  // O cadastro de bancos é um só para todas as empresas: só o superadmin
  // escreve (nenhuma tela das empresas escreve)
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Cria um novo banco' })
  @ApiBody({
    description: 'Dados do novo banco',
    type: CreateBankDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Banco criado com sucesso.',
  })
  create(@Body() createBankDto: CreateBankDto) {
    return this.bankService.create(createBankDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os bancos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de bancos retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.bankService.findAll();
  }

  @Get('condition/:paymentCondition')
  @TenantResource('paymentCondition', 'paymentCondition')
  @ApiOperation({
    summary: 'Obtém a lista de todos os bancos por condição de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de bancos retornada com sucesso.',
    isArray: true,
  })
  findAllByCondition(@Param('paymentCondition') paymentCondition: string) {
    return this.bankService.findAllByCondition(paymentCondition);
  }

  //---------------------------------------------------------------------------------
  // Account
  //---------------------------------------------------------------------------------

  @Get('account/in-use')
  @ApiOperation({
    summary:
      'Obtém a lista de contas bancárias que estão sendo utilizadas em lançamentos',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas bancárias em uso retornada com sucesso.',
  })
  async getBankAccountsInUse(@Req() req) {
    return this.bankService.getBankAccountsInUse(req.user.companyId);
  }

  @Post('account')
  @ApiOperation({ summary: 'Cria uma nova conta bancária' })
  @ApiBody({
    description: 'Dados da nova conta bancária',
    type: CreateBankAccountDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Conta bancária criada com sucesso.',
  })
  @UseGuards(FeatureGuard)
  @RequiresFeature('bank_account_creation')
  async createAccount(@Req() req, @Body() dto: CreateBankAccountDto) {
    if (req.user.companyId === null) {
      throw new BadGatewayException('Usuário não possui empresa vinculada');
    }
    await this.enforceAccountFeatures(req.user.companyId, dto);
    dto.companyId = req.user.companyId;
    return await this.accountService.create(dto);
  }

  @Get('account')
  @ApiOperation({ summary: 'Obtém a lista de todas as contas bancárias' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas bancárias retornada com sucesso.',
    isArray: true,
  })
  async listAccounts(@Req() req, @Query() filter: BankAccountFilterDTO) {
    filter.companyId = req.user.companyId;
    return await this.accountService.findAll(filter);
  }

  @Patch('account/:accountId')
  @TenantResource('bankAccount', 'accountId')
  @ApiOperation({ summary: 'Atualiza uma conta bancária pelo ID' })
  @ApiParam({
    name: 'accountId',
    required: true,
    description: 'ID da conta bancária',
  })
  @ApiBody({
    description: 'Dados para atualização da conta bancária',
    type: CreateBankAccountDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Conta bancária atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta bancária não encontrada.',
  })
  async updateAccount(
    @Req() req,
    @Param('accountId') accountId: string,
    @Body() updateBankAccountDto: UpdateBankAccountDto,
  ) {
    await this.enforceAccountFeatures(
      req.user.companyId,
      updateBankAccountDto,
      accountId,
    );
    return await this.accountService.update(accountId, updateBankAccountDto);
  }

  @Delete('account/:accountId')
  @TenantResource('bankAccount', 'accountId')
  @ApiOperation({ summary: 'Remove uma conta bancária pelo ID' })
  @ApiParam({
    name: 'accountId',
    required: true,
    description: 'ID da conta bancária',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta bancária removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta bancária não encontrada.',
  })
  @UseGuards(FeatureGuard)
  @RequiresFeature('bank_account_delete')
  async removeAccount(@Param('accountId') accountId: string) {
    return await this.accountService.remove(accountId);
  }

  //---------------------------------------------------------------------------------
  // Wildcard
  //---------------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um banco pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do banco' })
  @ApiResponse({
    status: 200,
    description: 'Banco retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Banco não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.bankService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Atualiza um banco pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do banco' })
  @ApiBody({
    description: 'Dados para atualização do banco',
    type: CreateBankDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Banco atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Banco não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateBankDto: UpdateBankDto) {
    return this.bankService.update(id, updateBankDto);
  }

  @Delete(':id')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Remove um banco pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do banco' })
  @ApiResponse({
    status: 200,
    description: 'Banco removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Banco não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.bankService.remove(id);
  }
}
