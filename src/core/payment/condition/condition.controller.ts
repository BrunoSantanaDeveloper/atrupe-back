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
} from '@nestjs/common';
import { ConditionService } from './condition.service';
import { CreateConditionDto } from './dto/create-condition.dto';
import { UpdateConditionDto } from './dto/update-condition.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { ConditionFilterDto } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

const GROUP = 'payment';
const RESOURCE = 'condition';

@ApiTags('Condições de Pagamento')
@UseGuards(JwtAuthGuard)
@Controller(`${GROUP}/${RESOURCE}`)
export class ConditionController {
  constructor(private readonly conditionService: ConditionService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma nova condição de pagamento' })
  @ApiBody({
    description: 'Dados da nova condição de pagamento',
    type: CreateConditionDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Condição de pagamento criada com sucesso.',
  })
  create(@Body() createConditionDto: CreateConditionDto) {
    return this.conditionService.create(createConditionDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as condições de pagamento' })
  @ApiQuery({
    name: 'filter',
    description: 'Filtros opcionais para a busca de condições de pagamento',
    type: ConditionFilterDto,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de condições de pagamento retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: ConditionFilterDto) {
    return this.conditionService.findAll(filter);
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
  findOne(@Param('id') id: string) {
    return this.conditionService.findOne(id);
  }

  @Patch(':id')
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
  update(
    @Param('id') id: string,
    @Body() updateConditionDto: UpdateConditionDto,
  ) {
    return this.conditionService.update(id, updateConditionDto);
  }

  @Delete(':id')
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
  remove(@Param('id') id: string) {
    return this.conditionService.remove(id);
  }
}
