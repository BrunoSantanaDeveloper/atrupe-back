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
import { ConditionFilterDto } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const GROUP = 'payment';
const RESOURCE = 'condition';

@ApiTags('Condições de Pagamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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
  create(@Req() req, @Body() createConditionDto: CreateConditionDto) {
    createConditionDto.companyId = req.user.companyId;
    return this.conditionService.create(createConditionDto);
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
