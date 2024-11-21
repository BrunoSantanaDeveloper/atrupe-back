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
import { ReceivableService } from './receivable.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';

const RESOURCE = 'receivable';
const GROUP = 'financial';

@ApiTags('Contas a Receber')
@UseGuards(JwtAuthGuard)
@Controller(`${GROUP}/${RESOURCE}`)
export class ReceivableController {
  constructor(private readonly receivableService: ReceivableService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma nova conta a receber' })
  @ApiBody({
    description: 'Dados da nova conta a receber',
    type: CreateReceivableDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Conta a receber criada com sucesso.',
  })
  create(@Body() createReceivableDto: CreateReceivableDto) {
    return this.receivableService.create(createReceivableDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as contas a receber' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas a receber retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.receivableService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma conta a receber pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a receber retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta a receber não encontrada.',
  })
  findOne(@Param('id') id: string) {
    return this.receivableService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma conta a receber pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiBody({
    description: 'Dados para atualização da conta a receber',
    type: UpdateReceivableDto,
    examples: {
      example: {
        summary: 'Exemplo de payload para atualização de conta a receber',
        value: {
          amount: 1200.0,
          dueDate: '2023-07-15',
          description: 'Recebível atualizado de cliente',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a receber atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta a receber não encontrada.',
  })
  update(
    @Param('id') id: string,
    @Body() updateReceivableDto: UpdateReceivableDto,
  ) {
    return this.receivableService.update(id, updateReceivableDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma conta a receber pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da conta a receber',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a receber removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta a receber não encontrada.',
  })
  remove(@Param('id') id: string) {
    return this.receivableService.remove(id);
  }
}
