import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ScheduledExpenseService } from './scheduled-expense.service';
import {
  CreateScheduledExpenseDto,
  LaunchScheduledExpenseDto,
  ScheduledExpenseFilterDto,
} from './dto/create-scheduled-expense.dto';
import { UpdateScheduledExpenseDto } from './dto/update-scheduled-expense.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'scheduled-expense';
const GROUP = 'financial';

@ApiTags('Despesas Fixas')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(`${GROUP}/${RESOURCE}`)
export class ScheduledExpenseController {
  constructor(
    private readonly scheduledExpenseService: ScheduledExpenseService,
  ) {}

  @Post()
  @HasPermission('create', 'financial_settings:fixed_expenses')
  @ApiOperation({ summary: 'Cria uma nova despesa fixa' })
  @ApiBody({
    description: 'Dados da nova despesa fixa',
    type: CreateScheduledExpenseDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Despesa fixa criada com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos fornecidos.',
  })
  create(
    @Body() createScheduledExpenseDto: CreateScheduledExpenseDto,
    @Req() req,
  ) {
    return this.scheduledExpenseService.create(
      createScheduledExpenseDto,
      req.user.companyId,
    );
  }

  @Get('quantity')
  @HasPermission('view', 'financial_settings:fixed_expenses')
  @ApiOperation({
    summary: 'Obtém a quantidade de despesas fixas agrupadas por status',
  })
  @ApiResponse({
    status: 200,
    description: 'Quantidade de despesas fixas agrupadas por status.',
    schema: {
      type: 'object',
      properties: {
        ACTIVE: { type: 'number', example: 32 },
        INACTIVE: { type: 'number', example: 0 },
        TOTAL: { type: 'number', example: 32 },
      },
    },
  })
  getQuantity(@Req() req) {
    return this.scheduledExpenseService.count(req.user.companyId);
  }

  @Get('by-level1/:level1')
  @HasPermission('view', 'financial_settings:fixed_expenses')
  @ApiOperation({ summary: 'Obtém despesas fixas por nível 1 da natureza' })
  @ApiParam({
    name: 'level1',
    required: true,
    description: 'Nível 1 da natureza (receivable ou payable)',
    enum: ['receivable', 'payable'],
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de despesas fixas por nível 1.',
    isArray: true,
  })
  findByLevel1(
    @Param('level1') level1: string,
    @Query('status') status: string,
    @Req() req,
  ) {
    return this.scheduledExpenseService.findAllByLevel1(
      req.user.companyId,
      level1,
      status,
    );
  }

  @Get('by-level2/:level1/:level2')
  @HasPermission('view', 'financial_settings:fixed_expenses')
  @ApiOperation({ summary: 'Obtém despesas fixas por nível 1 e 2 da natureza' })
  @ApiParam({
    name: 'level1',
    required: true,
    description: 'Nível 1 da natureza',
  })
  @ApiParam({
    name: 'level2',
    required: true,
    description: 'Nível 2 da natureza',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de despesas fixas por nível 1 e 2.',
    isArray: true,
  })
  findByLevel2(
    @Param('level1') level1: string,
    @Param('level2') level2: string,
    @Query('status') status: string,
    @Req() req,
  ) {
    return this.scheduledExpenseService.findAllByLevel2(
      req.user.companyId,
      level1,
      level2,
      status,
    );
  }

  @Get('by-nature/:natureCode')
  @HasPermission('view', 'financial_settings:fixed_expenses')
  @ApiOperation({ summary: 'Obtém despesas fixas por código da natureza' })
  @ApiParam({
    name: 'natureCode',
    required: true,
    description: 'Código da natureza',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de despesas fixas por código da natureza.',
    isArray: true,
  })
  findByNatureCode(
    @Param('natureCode') natureCode: string,
    @Query('status') status: string,
    @Req() req,
  ) {
    return this.scheduledExpenseService.findAllByNatureCode(
      req.user.companyId,
      natureCode,
      status,
    );
  }

  @Get('grouped-by-supplier')
  @HasPermission('view', 'financial:fixed_expense')
  @ApiOperation({
    summary: 'Obtém despesas fixas agrupadas por fornecedor',
    description:
      'Lista as despesas agendadas agrupadas por fornecedor para um mês/ano específico, similar às folhas de pagamento. Se não informado, usa mês/ano atual.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de fornecedores com suas despesas agendadas.',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', example: 5 },
        totalPages: { type: 'number', example: 1 },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid' },
              name: { type: 'string', example: 'Fornecedor XYZ' },
              email: { type: 'string', example: 'fornecedor@email.com' },
              phone: { type: 'string', example: '(11) 99999-9999' },
              month: {
                type: 'number',
                example: 1,
                description: 'Mês de referência (1-12)',
              },
              year: {
                type: 'number',
                example: 2024,
                description: 'Ano de referência',
              },
              totalExpenses: { type: 'number', example: 3 },
              activeExpenses: { type: 'number', example: 2 },
              inactiveExpenses: { type: 'number', example: 1 },
              totalAmount: { type: 'number', example: 1500.0 },
              totalLaunched: {
                type: 'number',
                example: 2,
                description: 'Total de despesas lançadas no período',
              },
              totalNotLaunched: {
                type: 'number',
                example: 1,
                description: 'Total de despesas não lançadas no período',
              },
              items: {
                type: 'array',
                description: 'Lista de despesas agendadas do fornecedor',
              },
            },
          },
        },
      },
    },
  })
  findAllGroupedBySupplier(
    @Query() filter: ScheduledExpenseFilterDto,
    @Req() req,
  ) {
    return this.scheduledExpenseService.findAllGroupedBySupplier(
      filter,
      req.user.companyId,
    );
  }

  @Get()
  @HasPermission('view', 'financial_settings:fixed_expenses')
  @ApiOperation({ summary: 'Obtém a lista de todas as despesas fixas' })
  @ApiResponse({
    status: 200,
    description: 'Lista de despesas fixas retornada com sucesso.',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', example: 1 },
        totalPages: { type: 'number', example: 1 },
        data: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  findAll(@Query() filter: ScheduledExpenseFilterDto, @Req() req) {
    return this.scheduledExpenseService.findAll(filter, req.user.companyId);
  }

  @Get(':id')
  @HasPermission('view', 'financial_settings:fixed_expenses')
  @ApiOperation({ summary: 'Obtém uma despesa fixa pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da despesa fixa',
  })
  @ApiResponse({
    status: 200,
    description: 'Despesa fixa retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Despesa fixa não encontrada.',
  })
  findOne(@Param('id') id: string, @Req() req) {
    return this.scheduledExpenseService.findOne(id, req.user.companyId);
  }

  @Patch(':id')
  @HasPermission('edit', 'financial_settings:fixed_expenses')
  @ApiOperation({ summary: 'Atualiza uma despesa fixa pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da despesa fixa',
  })
  @ApiBody({
    description: 'Dados para atualização da despesa fixa',
    type: UpdateScheduledExpenseDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Despesa fixa atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Despesa fixa não encontrada.',
  })
  update(
    @Param('id') id: string,
    @Body() updateScheduledExpenseDto: UpdateScheduledExpenseDto,
    @Req() req,
  ) {
    return this.scheduledExpenseService.update(
      id,
      updateScheduledExpenseDto,
      req.user.companyId,
    );
  }

  @Delete(':id')
  @HasPermission('delete', 'financial_settings:fixed_expenses')
  // Sem uso no front e destrutiva: já recusa, sem passar pelo modo observar
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Remove uma despesa fixa pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da despesa fixa',
  })
  @ApiResponse({
    status: 200,
    description: 'Despesa fixa removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Despesa fixa não encontrada.',
  })
  remove(@Param('id') id: string, @Req() req) {
    return this.scheduledExpenseService.remove(id, req.user.companyId);
  }

  @Post('launch')
  @HasAnyPermission(
    { action: 'create', resource: 'financial:fixed_expense' },
    { action: 'edit', resource: 'financial:fixed_expense' },
  )
  @ApiOperation({
    summary: 'Lança despesas agendadas como contas a pagar',
    description:
      'Converte múltiplas despesas agendadas em contas a pagar com base nos dados do modal de lançamento',
  })
  @ApiBody({
    description: 'Dados do lançamento das despesas',
    type: LaunchScheduledExpenseDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Despesas agendadas lançadas com sucesso.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Despesas lançadas com sucesso' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              scheduledExpenseId: { type: 'string' },
              success: { type: 'boolean' },
              payable: { type: 'object', description: 'Conta a pagar criada' },
              installment: { type: 'object', description: 'Parcela criada' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos fornecidos.',
  })
  launchScheduledExpenses(
    @Body() launchData: LaunchScheduledExpenseDto,
    @Req() req,
  ) {
    return this.scheduledExpenseService.launchScheduledExpenses(
      launchData,
      req.user.companyId,
    );
  }
}
