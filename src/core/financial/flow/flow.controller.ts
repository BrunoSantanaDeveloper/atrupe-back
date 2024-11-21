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
import { FlowService } from './flow.service';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FinancialFlowFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

const RESOURCE = 'flow';
const GROUP = 'financial';

@ApiTags('Fluxo Financeiro')
@UseGuards(JwtAuthGuard)
@Controller(`${GROUP}/${RESOURCE}`)
export class FlowController {
  constructor(private readonly flowService: FlowService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo fluxo financeiro' })
  @ApiBody({
    description: 'Dados do novo fluxo financeiro',
    type: CreateFlowDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Fluxo financeiro criado com sucesso.',
  })
  create(@Body() createFlowDto: CreateFlowDto) {
    return this.flowService.create(createFlowDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os fluxos financeiros' })
  @ApiQuery({ name: 'filter', type: FinancialFlowFilterDTO, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de fluxos financeiros retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: FinancialFlowFilterDTO) {
    return this.flowService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um fluxo financeiro pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do fluxo financeiro',
  })
  @ApiResponse({
    status: 200,
    description: 'Fluxo financeiro retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fluxo financeiro não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.flowService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um fluxo financeiro pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do fluxo financeiro',
  })
  @ApiBody({
    description: 'Dados para atualização do fluxo financeiro',
    type: CreateFlowDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Fluxo financeiro atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fluxo financeiro não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateFlowDto: UpdateFlowDto) {
    return this.flowService.update(id, updateFlowDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um fluxo financeiro pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do fluxo financeiro',
  })
  @ApiResponse({
    status: 200,
    description: 'Fluxo financeiro removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Fluxo financeiro não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.flowService.remove(id);
  }
}
