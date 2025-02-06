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
  create(@Body() createScheduledExpenseDto: CreateScheduledExpenseDto) {
    return this.scheduledExpenseService.create(createScheduledExpenseDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as despesas fixas' })
  @ApiResponse({
    status: 200,
    description: 'Lista de despesas fixas retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    // filter.companyId = req.user.companyId;
    return this.scheduledExpenseService.findAll();
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
  findOne(@Param('id') id: string) {
    return this.scheduledExpenseService.findOne(id);
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
    type: CreateScheduledExpenseDto,
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
  ) {
    return this.scheduledExpenseService.update(id, updateScheduledExpenseDto);
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
  remove(@Param('id') id: string) {
    return this.scheduledExpenseService.remove(id);
  }
}
