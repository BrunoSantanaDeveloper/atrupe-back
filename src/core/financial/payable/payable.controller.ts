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
import { PayableService } from './payable.service';
import { CreatePayableDto } from './dto/create-payable.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';

const RESOURCE = 'payable';
const GROUP = 'financial';

@ApiTags('Contas a Pagar')
@UseGuards(JwtAuthGuard)
@Controller(`${GROUP}/${RESOURCE}`)
export class PayableController {
  constructor(private readonly payableService: PayableService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma nova conta a pagar' })
  @ApiBody({
    description: 'Dados da nova conta a pagar',
    type: CreatePayableDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Conta a pagar criada com sucesso.',
  })
  create(@Body() createPayableDto: CreatePayableDto) {
    return this.payableService.create(createPayableDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as contas a pagar' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas a pagar retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.payableService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma conta a pagar pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da conta a pagar' })
  @ApiResponse({
    status: 200,
    description: 'Conta a pagar retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta a pagar não encontrada.',
  })
  findOne(@Param('id') id: string) {
    return this.payableService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma conta a pagar pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da conta a pagar' })
  @ApiBody({
    description: 'Dados para atualização da conta a pagar',
    type: CreatePayableDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Conta a pagar atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta a pagar não encontrada.',
  })
  update(@Param('id') id: string, @Body() updatePayableDto: UpdatePayableDto) {
    return this.payableService.update(id, updatePayableDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma conta a pagar pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da conta a pagar' })
  @ApiResponse({
    status: 200,
    description: 'Conta a pagar removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta a pagar não encontrada.',
  })
  remove(@Param('id') id: string) {
    return this.payableService.remove(id);
  }
}
