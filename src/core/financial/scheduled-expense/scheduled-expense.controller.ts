import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ScheduledExpenseService } from './scheduled-expense.service';
import { CreateScheduledExpenseDto } from './dto/create-scheduled-expense.dto';
import { UpdateScheduledExpenseDto } from './dto/update-scheduled-expense.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';

const RESOURCE = 'scheduled-expense';
const GROUP = 'financial';

@ApiTags('Despesas Agendadas')
@UseGuards(JwtAuthGuard)
@Controller(`${GROUP}/${RESOURCE}`)
export class ScheduledExpenseController {
  constructor(
    private readonly scheduledExpenseService: ScheduledExpenseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma nova despesa agendada' })
  @ApiBody({
    description: 'Dados da nova despesa agendada',
    type: CreateScheduledExpenseDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Despesa agendada criada com sucesso.',
  })
  create(@Body() createScheduledExpenseDto: CreateScheduledExpenseDto) {
    return this.scheduledExpenseService.create(createScheduledExpenseDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as despesas agendadas' })
  @ApiResponse({
    status: 200,
    description: 'Lista de despesas agendadas retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.scheduledExpenseService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma despesa agendada pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da despesa agendada',
  })
  @ApiResponse({
    status: 200,
    description: 'Despesa agendada retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Despesa agendada não encontrada.',
  })
  findOne(@Param('id') id: string) {
    return this.scheduledExpenseService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma despesa agendada pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da despesa agendada',
  })
  @ApiBody({
    description: 'Dados para atualização da despesa agendada',
    type: CreateScheduledExpenseDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Despesa agendada atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Despesa agendada não encontrada.',
  })
  update(
    @Param('id') id: string,
    @Body() updateScheduledExpenseDto: UpdateScheduledExpenseDto,
  ) {
    return this.scheduledExpenseService.update(id, updateScheduledExpenseDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma despesa agendada pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da despesa agendada',
  })
  @ApiResponse({
    status: 200,
    description: 'Despesa agendada removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Despesa agendada não encontrada.',
  })
  remove(@Param('id') id: string) {
    return this.scheduledExpenseService.remove(id);
  }
}
