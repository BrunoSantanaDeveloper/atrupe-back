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
import { CashControlService } from './cash-control.service';
import { CreateCashControlDto } from './dto/create-cash-control.dto';
import { UpdateCashControlDto } from './dto/update-cash-control.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';

const RESOURCE = 'cash-control';
const GROUP = 'financial';

@ApiTags('Controle de Caixa')
@UseGuards(JwtAuthGuard)
@Controller(`${GROUP}/${RESOURCE}`)
export class CashControlController {
  constructor(private readonly cashControlService: CashControlService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo controle de caixa' })
  @ApiBody({
    description: 'Dados do novo controle de caixa',
    type: CreateCashControlDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Controle de caixa criado com sucesso.',
  })
  create(@Body() createCashControlDto: CreateCashControlDto) {
    return this.cashControlService.create(createCashControlDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os controles de caixa' })
  @ApiResponse({
    status: 200,
    description: 'Lista de controles de caixa retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.cashControlService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um controle de caixa pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do controle de caixa',
  })
  @ApiResponse({
    status: 200,
    description: 'Controle de caixa retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Controle de caixa não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.cashControlService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um controle de caixa pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do controle de caixa',
  })
  @ApiBody({
    description: 'Dados para atualização do controle de caixa',
    type: CreateCashControlDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Controle de caixa atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Controle de caixa não encontrado.',
  })
  update(
    @Param('id') id: string,
    @Body() updateCashControlDto: UpdateCashControlDto,
  ) {
    return this.cashControlService.update(id, updateCashControlDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um controle de caixa pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do controle de caixa',
  })
  @ApiResponse({
    status: 200,
    description: 'Controle de caixa removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Controle de caixa não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.cashControlService.remove(id);
  }
}
