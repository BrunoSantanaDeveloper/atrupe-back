import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';

import { GetSalarySheetsDto } from './dto/salaries-filters.dto';
import { SalarySheetsService } from './salary-sheets.service';
import { AddSalaryItemDto } from './dto/create-salary.dto';
import {
  ToggleSalarySheetStatusDto,
  UpdateSalaryItemDto,
} from './dto/update-salary.dto';
import { GenerateSalarySheetsDto } from './dto/generate-salary-sheets.dto';

const RESOURCE = 'payroll';
const GROUP = 'financial';

@ApiTags('Folhas de pagamento')
// O TenantGuard confere que a folha (ou o item, pela folha) da rota é da
// empresa da sessão: salários e adiantamentos de outra empresa eram lidos,
// alterados e estornados pelo id
@UseGuards(JwtAuthGuard, PermissionsGuard, TenantGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class SalarySheetsController {
  constructor(private readonly salaryService: SalarySheetsService) {}

  @Post('')
  @ApiOperation({
    summary: 'Gera folhas de pagamento para uma lista de colaboradores',
    description:
      'Cria folhas de pagamento para os colaboradores especificados no mês/ano informado',
  })
  @ApiResponse({
    status: 201,
    description: 'Folhas de pagamento geradas com sucesso',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'number',
          description: 'Quantidade de folhas criadas com sucesso',
        },
        skipped: {
          type: 'number',
          description: 'Quantidade de folhas puladas (já existiam)',
        },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              employeeId: {
                type: 'string',
                description: 'ID do colaborador com erro',
              },
              reason: {
                type: 'string',
                description: 'Razão do erro',
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos',
  })
  async generateSalarySheets(@Req() req, @Body() dto: GenerateSalarySheetsDto) {
    return this.salaryService.generateSalarySheetForEmployees(
      dto,
      req.user.companyId,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Listar folhas de pagamento',
    description:
      'Retorna a lista de folhas de pagamento do mês/ano especificado',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de folhas de pagamento',
    schema: {
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              employee: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  role: { type: 'string' },
                },
              },
              totalSalary: { type: 'number' },
              balance: { type: 'number' },
              status: { type: 'string' },
            },
          },
        },
        count: { type: 'number', description: 'Total de registros' },
        page: { type: 'number', description: 'Página atual' },
        limit: { type: 'number', description: 'Itens por página' },
        totalPages: { type: 'number', description: 'Total de páginas' },
      },
    },
  })
  async getSalarySheets(@Req() req, @Query() query: GetSalarySheetsDto) {
    query.companyId = req.user.companyId;
    return this.salaryService.getSalarySheets(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Retornar folha de pagamento por ID',
    description:
      'Retorna os detalhes completos de uma folha de pagamento específica, incluindo movimentações financeiras relacionadas',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalhes da folha de pagamento com movimentações financeiras',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        month: { type: 'number' },
        year: { type: 'number' },
        status: { type: 'string' },
        employee: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
        balance: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              amount: { type: 'number' },
              description: { type: 'string' },
              payable: {
                type: 'object',
                description:
                  'Conta a pagar relacionada (apenas para adiantamentos)',
                properties: {
                  id: { type: 'string' },
                  description: { type: 'string' },
                  totalAmount: { type: 'number' },
                  installments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        installmentNumber: { type: 'number' },
                        amount: { type: 'number' },
                        status: { type: 'string' },
                        transaction: {
                          type: 'object',
                          description: 'Transação financeira da parcela',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        movements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              amount: { type: 'number' },
              status: { type: 'string' },
              paidDate: { type: 'string', format: 'date-time' },
              paymentMethod: { type: 'object' },
            },
          },
        },
        financialTransactions: {
          type: 'array',
          description:
            'Todas as transações financeiras relacionadas à folha de pagamento',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: {
                type: 'string',
                enum: [
                  'INCOME',
                  'OUTCOME',
                  'TRANSFER_INCOME',
                  'TRANSFER_OUTCOME',
                ],
              },
              amount: { type: 'number' },
              description: { type: 'string' },
              transactionDate: { type: 'string', format: 'date-time' },
              status: {
                type: 'string',
                enum: ['COMPLETED', 'PENDING'],
                description:
                  'Status da transação: COMPLETED para transações efetivadas, PENDING para adiantamentos não pagos',
              },
              relatedPayable: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  description: { type: 'string' },
                },
              },
              cashRegister: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  description: { type: 'string' },
                  bankAccount: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Folha de pagamento não encontrada',
  })
  @TenantResource('payroll')
  async getSalarySheet(@Param('id') id: string) {
    return this.salaryService.getSalarySheetById(id);
  }

  @Get(':id/pdf-data')
  @ApiOperation({
    summary: 'Obtém os dados da folha de pagamento para geração de PDF',
    description:
      'Retorna os dados estruturados necessários para construção do PDF da folha de pagamento',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da folha de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Dados da folha de pagamento para PDF retornados com sucesso.',
    content: {
      'application/json': {
        example: {
          company: {
            name: 'Nome da Empresa',
            cnpj: '12.345.678/0001-90',
            email: 'empresa@exemplo.com',
            logo: 'https://exemplo.com/logo.png',
            address: {
              street: 'Rua Exemplo',
              number: '123',
              neighborhood: 'Centro',
              city: 'São Paulo',
              state: 'SP',
            },
          },
          employeeName: 'Nome do Funcionário',
          reference: '3/25',
          items: [
            {
              id: 'uuid-do-item-1',
              description: 'Salário Base',
              type: 'INCREASE',
              amount: 250000,
            },
            {
              id: 'uuid-do-item-2',
              description: 'INSS',
              type: 'DISCOUNT',
              amount: 30000,
            },
            {
              id: 'uuid-do-item-3',
              description: 'Adiantamento',
              type: 'ADVANCE',
              amount: 55000,
            },
          ],
          netSalary: 220000,
          payment: {
            dueDate: '2025-03-01',
            paidAt: '2025-03-01',
            amountPaid: 165000,
            paymentMethod: 'PIX',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Folha de pagamento não encontrada.',
  })
  @TenantResource('payroll')
  async getSalarySheetPdfData(@Param('id') id: string, @Req() req) {
    return await this.salaryService.getSalarySheetPdfData(id, req.user.userId);
  }

  @Get('item/:itemId/advance-pdf-data')
  @ApiOperation({
    summary: 'Obtém os dados de um adiantamento específico para geração de PDF',
    description:
      'Retorna os dados estruturados de um item de adiantamento específico para construção do PDF',
  })
  @ApiParam({
    name: 'itemId',
    required: true,
    description: 'ID do item de adiantamento da folha de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Dados do adiantamento para PDF retornados com sucesso.',
    content: {
      'application/json': {
        example: {
          company: {
            name: 'Nome da Empresa',
            cnpj: '12.345.678/0001-90',
            email: 'empresa@exemplo.com',
            logo: 'https://exemplo.com/logo.png',
            address: {
              street: 'Rua Exemplo',
              number: '123',
              neighborhood: 'Centro',
              city: 'São Paulo',
              state: 'SP',
            },
          },
          employeeName: 'Nome do Funcionário',
          reference: '3/25',
          items: [
            {
              id: 'uuid-do-item-1',
              description: 'Adiantamento Salarial',
              type: 'ADVANCE',
              amount: 55000,
            },
          ],
          netSalary: 55000,
          payables: [
            {
              id: 'payable-uuid',
              description: 'Folha 03/2025 - Adiantamento Salarial',
              totalAmount: 55000,
              installments: [
                {
                  id: 'installment-uuid',
                  installmentNumber: 1,
                  dueDate: '2025-03-01',
                  amount: 55000,
                  status: 'PENDING',
                  paidDate: null,
                  paidAmount: null,
                  paymentMethod: null,
                },
              ],
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido ou item não é um adiantamento.',
  })
  @ApiResponse({
    status: 404,
    description: 'Item da folha de pagamento não encontrado.',
  })
  @TenantResource('payrollItem', 'itemId', 'payroll')
  async getAdvanceItemPdfData(@Param('itemId') itemId: string, @Req() req) {
    return await this.salaryService.getAdvanceItemPdfData(
      itemId,
      req.user.userId,
    );
  }

  @Post('item/:payrollId')
  @ApiOperation({
    summary: 'Adicionar item à folha de pagamento',
    description:
      'Adiciona um novo item (acréscimo, desconto ou adiantamento) à folha de pagamento',
  })
  @ApiParam({
    name: 'payrollId',
    required: true,
    description: 'ID da folha de pagamento',
  })
  @ApiResponse({
    status: 201,
    description: 'Item adicionado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou folha não está aberta',
  })
  @TenantResource('payroll', 'payrollId')
  async addSalaryItem(
    @Param('payrollId') payrollId: string,
    @Body() addSalaryItemDto: AddSalaryItemDto,
  ) {
    return await this.salaryService.addSalaryItem(payrollId, addSalaryItemDto);
  }

  @Patch('item/:itemId')
  @ApiOperation({
    summary: 'Atualizar item da folha de pagamento',
    description: 'Atualiza um item existente na folha de pagamento',
  })
  @ApiParam({
    name: 'itemId',
    required: true,
    description: 'ID do item a ser atualizado',
  })
  @ApiResponse({
    status: 200,
    description: 'Item atualizado com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Item não encontrado',
  })
  @TenantResource('payrollItem', 'itemId', 'payroll')
  async updateSalaryItem(
    @Param('itemId') itemId: string,
    @Body() updateSalaryItemDto: UpdateSalaryItemDto,
  ) {
    return await this.salaryService.updateSalaryItem(
      itemId,
      updateSalaryItemDto,
    );
  }

  @Delete('item/:itemId')
  @ApiOperation({
    summary: 'Excluir item da folha de pagamento',
    description:
      'Remove um item (acréscimo, desconto ou adiantamento) da folha de pagamento. Para adiantamentos, exclui também a despesa financeira associada.',
  })
  @ApiParam({
    name: 'itemId',
    required: true,
    description: 'ID do item a ser excluído',
  })
  @ApiResponse({
    status: 200,
    description: 'Item excluído com sucesso',
  })
  @ApiResponse({
    status: 400,
    description:
      'Item não pode ser excluído (adiantamento já pago ou folha não está aberta)',
  })
  @ApiResponse({
    status: 404,
    description: 'Item não encontrado',
  })
  @TenantResource('payrollItem', 'itemId', 'payroll')
  async deleteSalaryItem(@Param('itemId') itemId: string) {
    return await this.salaryService.deleteSalaryItem(itemId);
  }

  @Post('item/:itemId/cancel-advance')
  @ApiOperation({
    summary: 'Cancelar adiantamento pago',
    description:
      'Estorna o pagamento de um adiantamento já pago, cancela a despesa e remove o item da folha.',
  })
  @ApiParam({
    name: 'itemId',
    required: true,
    description: 'ID do item de adiantamento a ser cancelado',
  })
  @ApiResponse({
    status: 200,
    description: 'Adiantamento cancelado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Item não é um adiantamento ou erro no cancelamento',
  })
  @TenantResource('payrollItem', 'itemId', 'payroll')
  async cancelAdvance(@Param('itemId') itemId: string) {
    return await this.salaryService.cancelAdvance(itemId);
  }

  @Patch('toggle')
  @ApiOperation({
    summary: 'Alternar status da folha de pagamento',
    description: 'Altera o status da folha de pagamento entre aberta e fechada',
  })
  @ApiResponse({
    status: 200,
    description: 'Status alterado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Status inválido ou folha não encontrada',
  })
  async toggleStatus(@Req() req, @Body() dto: ToggleSalarySheetStatusDto) {
    return this.salaryService.toggleSalarySheetStatus(dto, req.user.companyId);
  }
}
