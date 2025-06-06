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
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class ScheduledExpenseController {
  constructor(
    private readonly scheduledExpenseService: ScheduledExpenseService,
  ) {}

  @Post()
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

  @Get()
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
}
