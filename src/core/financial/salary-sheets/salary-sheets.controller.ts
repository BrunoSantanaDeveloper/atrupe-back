import {
  Body,
  Controller,
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
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { GetSalarySheetsDto } from './dto/salaries-filters.dto';
import { SalarySheetsService } from './salary-sheets.service';
import {
  AddPaymentMovementDto,
  AddSalaryItemDto,
  PaySalaryMovementDto,
} from './dto/create-salary.dto';
import {
  ToggleSalarySheetStatusDto,
  UpdateSalaryItemDto,
  UpdateEmployeeSalaryDto,
} from './dto/update-salary.dto';

const RESOURCE = 'salary-sheets';
const GROUP = 'financial';

@ApiTags('Folhas de pagamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class SalarySheetsController {
  constructor(private readonly salaryService: SalarySheetsService) {}

  @Post('generate')
  @ApiOperation({
    summary: 'Gerar folha de pagamento para o mês',
    description:
      'Gera folhas de pagamento vazias para todos os colaboradores ativos do mês especificado',
  })
  @ApiResponse({
    status: 201,
    description: 'Folha de pagamento gerada com sucesso',
  })
  async generateSalarySheet() {
    await this.salaryService.generateSalarySheetForMonth();
    return { message: 'Folha de pagamento gerada com sucesso' };
  }

  @Post(':salarySheetId/open')
  @ApiOperation({
    summary: 'Abrir folha de pagamento',
    description:
      'Abre uma folha de pagamento vazia e cria o item de salário base',
  })
  @ApiResponse({
    status: 200,
    description: 'Folha de pagamento aberta com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Folha de pagamento não encontrada ou já está aberta',
  })
  async openSalarySheet(@Param('salarySheetId') salarySheetId: string) {
    return await this.salaryService.openSalarySheet(salarySheetId);
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
      'Retorna os detalhes completos de uma folha de pagamento específica',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalhes da folha de pagamento',
  })
  @ApiResponse({
    status: 404,
    description: 'Folha de pagamento não encontrada',
  })
  async getSalarySheet(@Param('id') id: string) {
    return this.salaryService.getSalarySheetById(id);
  }

  @Post('item')
  @ApiOperation({
    summary: 'Adicionar item à folha de pagamento',
    description:
      'Adiciona um novo item (acréscimo, desconto ou adiantamento) à folha de pagamento',
  })
  @ApiResponse({
    status: 201,
    description: 'Item adicionado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou folha não está aberta',
  })
  async addSalaryItem(@Body() addSalaryItemDto: AddSalaryItemDto) {
    return await this.salaryService.addSalaryItem(addSalaryItemDto);
  }

  @Patch('item')
  @ApiOperation({
    summary: 'Atualizar item da folha de pagamento',
    description: 'Atualiza um item existente na folha de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Item atualizado com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Item não encontrado',
  })
  async updateSalaryItem(@Body() updateSalaryItemDto: UpdateSalaryItemDto) {
    return await this.salaryService.updateSalaryItem(updateSalaryItemDto);
  }

  @Patch('toggle-status')
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
  async toggleStatus(@Body() dto: ToggleSalarySheetStatusDto) {
    return this.salaryService.toggleSalarySheetStatus(dto);
  }

  @Post('movement')
  @ApiOperation({
    summary: 'Adicionar movimentação de pagamento',
    description:
      'Adiciona uma nova movimentação de pagamento à folha de pagamento',
  })
  @ApiResponse({
    status: 201,
    description: 'Movimentação adicionada com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou folha não encontrada',
  })
  async addMovement(@Body() dto: AddPaymentMovementDto) {
    return this.salaryService.addPaymentMovement(dto);
  }

  @Patch('movement/pay')
  @ApiOperation({
    summary: 'Realizar pagamento de movimentação',
    description: 'Registra o pagamento de uma movimentação de salário',
  })
  @ApiResponse({
    status: 200,
    description: 'Pagamento registrado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Movimentação já paga ou dados inválidos',
  })
  async payMovement(@Body() dto: PaySalaryMovementDto) {
    return this.salaryService.payMovement(dto);
  }

  @Patch('employee/salary')
  @ApiOperation({
    summary: 'Atualizar salário base do colaborador',
    description:
      'Atualiza o salário base de um colaborador e reflete a mudança na folha de pagamento atual',
  })
  @ApiResponse({
    status: 200,
    description: 'Salário base atualizado com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Colaborador não encontrado',
  })
  async updateEmployeeSalary(@Body() dto: UpdateEmployeeSalaryDto) {
    return this.salaryService.updateEmployeeSalary(dto);
  }
}
