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
import { ConditionService } from './condition.service';
import { CreateConditionDto } from './dto/create-condition.dto';
import { UpdateConditionDto } from './dto/update-condition.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { PlanControlService } from 'src/core/plan/plan-control.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { ConditionFilterDto } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

/**
 * Configurações > Financeiro > Condições de pagamento, com as chaves que a
 * tela usa. As leituras ficam sem permissão: o orçamento e os formulários
 * financeiros leem as condições para qualquer vendedor.
 */
const PERMISSION = 'financial_settings:payment_methods';

@ApiTags('Condições de Pagamento')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller('payment-condition')
export class ConditionController {
  constructor(
    private readonly conditionService: ConditionService,
    private readonly planControl: PlanControlService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Taxa da operadora e repasse são recurso de plano. Só vale para taxa
   * informada (diferente de zero) que muda o que está gravado na parcela: uma
   * condição com taxa antiga segue editável sem o recurso.
   */
  private async enforceOperatorFee(
    companyId: string,
    installments:
      | { operatorFeeRate?: number; operatorFeeTransfer?: number }[]
      | undefined,
    conditionId?: string,
  ) {
    const list = installments ?? [];
    const withFee = (i: {
      operatorFeeRate?: number;
      operatorFeeTransfer?: number;
    }) =>
      Number(i?.operatorFeeRate || 0) !== 0 ||
      Number(i?.operatorFeeTransfer || 0) !== 0;
    if (!list.some(withFee)) return;

    if (conditionId) {
      const stored = await this.prisma.installment.findMany({
        where: { paymentConditionId: conditionId },
      });
      const changed = list.some((item, index) => {
        if (!withFee(item)) return false;
        const before = stored.find((s) => s.installment === index + 1);
        return (
          !before ||
          before.operatorFeeRate !== Number(item.operatorFeeRate || 0) ||
          before.operatorFeeTransfer !== Number(item.operatorFeeTransfer || 0)
        );
      });
      if (!changed) return;
    }
    await this.planControl.enforceFeature(
      companyId,
      'payment_condition_operator_fee',
    );
  }

  @Post()
  @HasPermission('create', PERMISSION)
  @ApiOperation({ summary: 'Cria uma nova condição de pagamento' })
  @ApiBody({
    description: 'Dados da nova condição de pagamento',
    type: CreateConditionDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Condição de pagamento criada com sucesso.',
  })
  async create(@Req() req, @Body() createConditionDto: CreateConditionDto) {
    createConditionDto.companyId = req.user.companyId;
    await this.enforceOperatorFee(
      req.user.companyId,
      createConditionDto.installments,
    );
    return this.conditionService.create(createConditionDto);
  }

  @Get('in-use')
  @ApiOperation({
    summary: 'Obtém a lista de todas as condições de pagamento em uso',
    description:
      'Lista todas as condições de pagamento que possuem pelo menos uma receita ou despesa associada',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de condições de pagamento em uso retornada com sucesso.',
    isArray: true,
  })
  async findInUse(@Req() req) {
    const companyId = req.user.companyId;
    return await this.conditionService.findInUse(companyId);
  }

  @Get('available/:type')
  @ApiOperation({
    summary: 'Obtém a lista de todas as condições de pagamento disponíveis',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de condições de pagamento retornada com sucesso.',
    isArray: true,
  })
  async findAvailable(@Req() req, @Param('type') type: string) {
    const companyId = req.user.companyId;
    return await this.conditionService.findAvailable(companyId, type);
  }

  @Get()
  @ApiOperation({
    summary: 'Obtém a lista de todas as condições de pagamento',
    description:
      'Lista condições de pagamento com opção de agrupamento por método. Por padrão, retorna lista simples (grouped=false). Use grouped=true para agrupar por método.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de condições de pagamento retornada com sucesso.',
    isArray: true,
  })
  findAll(@Req() req, @Query() filter: ConditionFilterDto) {
    filter.companyId = req.user.companyId;
    return this.conditionService.findAll(filter);
  }
  @Get('down-condition')
  @ApiOperation({ summary: 'Obtém a lista de todas as condições de pagamento' })
  @ApiResponse({
    status: 200,
    description: 'Lista de condições de pagamento retornada com sucesso.',
    isArray: true,
  })
  findDownPayment(@Req() req) {
    const companyId = req.user.companyId;
    return this.conditionService.findDownPayment(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma condição de pagamento pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da condição de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Condição de pagamento retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Condição de pagamento não encontrada.',
  })
  findOne(@Req() req, @Param('id') id: string) {
    return this.conditionService.findOne(id, req.user.companyId);
  }

  @Patch(':id')
  @HasPermission('edit', PERMISSION)
  @ApiOperation({ summary: 'Atualiza uma condição de pagamento pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da condição de pagamento',
  })
  @ApiBody({
    description: 'Dados para atualização da condição de pagamento',
    type: CreateConditionDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Condição de pagamento atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Condição de pagamento não encontrada.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateConditionDto: UpdateConditionDto,
  ) {
    // Antes da taxa: a conferência dela lê as parcelas gravadas pelo id
    await this.conditionService.findOne(id, req.user.companyId);
    await this.enforceOperatorFee(
      req.user.companyId,
      updateConditionDto.installments,
      id,
    );
    return this.conditionService.update(
      id,
      req.user.companyId,
      updateConditionDto,
    );
  }

  @Delete(':id')
  // A tela mostra "Desativar" para quem edita; delete também vale
  @HasAnyPermission(
    { action: 'edit', resource: PERMISSION },
    { action: 'delete', resource: PERMISSION },
  )
  @ApiOperation({ summary: 'Remove uma condição de pagamento pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da condição de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Condição de pagamento removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Condição de pagamento não encontrada.',
  })
  remove(@Req() req, @Param('id') id: string) {
    return this.conditionService.remove(id, req.user.companyId);
  }
}
