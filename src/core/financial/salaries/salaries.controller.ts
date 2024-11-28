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
import { SalarySheetService } from './salaries.service';
import {
  AddPaymentMovementDto,
  AddSalaryItemDto,
  PaySalaryMovementDto,
} from './dto/create-salary.dto';
import {
  ToggleSalarySheetStatusDto,
  UpdateSalaryItemDto,
} from './dto/update-salary.dto';

const RESOURCE = 'salary-sheets';
const GROUP = 'financial';

@ApiTags('Folhas de pagamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class SalarySheetController {
  constructor(private readonly salaryService: SalarySheetService) {}
  @Post('generate')
  @ApiOperation({ summary: 'Gerar folha de pagamento para o mês' })
  @ApiResponse({
    status: 201,
    description: 'Folha de pagamento gerada com sucesso',
  })
  async generateSalarySheet(
    @Query('month') month: number,
    @Query('year') year: number,
    @Req() req,
  ) {
    if (month < 1 || month > 12) throw new Error('Invalid month');
    const companyId = req.user.companyId;
    await this.salaryService.generateSalarySheetForMonth(
      +month - 1,
      +year,
      companyId,
    );
    return { message: 'Folha de pagamento gerada com sucesso' };
  }

  @Post(':salarySheetId/open')
  async openSalarySheet(@Param('salarySheetId') salarySheetId: string) {
    return await this.salaryService.openSalarySheet(salarySheetId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar folhas de pagamento mensais' })
  @ApiResponse({
    status: 200,
    description: 'Lista de folhas de pagamento',
  })
  async getSalarySheets(@Req() req, @Query() query: GetSalarySheetsDto) {
    if (query.month) {
      query.month = +query.month - 1;
    }
    query.companyId = req.user.companyId;
    return this.salaryService.getSalarySheets(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retornar folha de pagamento por ID' })
  @ApiResponse({
    status: 200,
    description: 'Detalhes da folha de pagamento',
  })
  async getSalarySheet(@Param('id') id: string) {
    return this.salaryService.getSalarySheetById(id);
  }

  @Post('item')
  @ApiResponse({
    status: 201,
    description: 'Item de folha de pagamento criado com sucesso',
  })
  async addSalaryItem(@Body() addSalaryItemDto: AddSalaryItemDto) {
    return await this.salaryService.addSalaryItem(addSalaryItemDto);
  }

  @Patch('item')
  @ApiResponse({
    status: 200,
    description: 'Item de folha de pagamento atualizado com sucesso',
  })
  async updateSalaryItem(@Body() updateSalaryItemDto: UpdateSalaryItemDto) {
    return await this.salaryService.updateSalaryItem(updateSalaryItemDto);
  }

  @Patch('toggle-status')
  @ApiOperation({
    summary: 'Alternar o status da folha de pagamento (abrir/fechar).',
  })
  async toggleStatus(@Body() dto: ToggleSalarySheetStatusDto) {
    return this.salaryService.toggleSalarySheetStatus(dto);
  }

  @Post('movement')
  @ApiOperation({ summary: 'Adicionar uma nova movimentação de salário.' })
  async addMovement(@Body() dto: AddPaymentMovementDto) {
    return this.salaryService.addPaymentMovement(dto);
  }

  @Patch('movement/pay')
  @ApiOperation({
    summary: 'Realizar pagamento de uma movimentação de salário.',
  })
  async payMovement(@Body() dto: PaySalaryMovementDto) {
    return this.salaryService.payMovement(dto);
  }
}
