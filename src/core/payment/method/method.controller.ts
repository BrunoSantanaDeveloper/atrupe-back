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
import { MethodService } from './method.service';
import { CreateMethodDto } from './dto/create-method.dto';
import { UpdateMethodDto } from './dto/update-method.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

const GROUP = 'payment';
const RESOURCE = 'method';

@ApiTags('Métodos de Pagamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class MethodController {
  constructor(private readonly methodService: MethodService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo método de pagamento' })
  @ApiBody({
    description: 'Dados do novo método de pagamento',
    type: CreateMethodDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Método de pagamento criado com sucesso.',
  })
  create(@Req() req, @Body() createMethodDto: CreateMethodDto) {
    createMethodDto.companyId = req.user.companyId;
    return this.methodService.create(createMethodDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os métodos de pagamento' })
  @ApiResponse({
    status: 200,
    description: 'Lista de métodos de pagamento retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Query() filter: BaseFilterDTO, @Req() req) {
    filter.companyId = req.user.companyId;
    return await this.methodService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um método de pagamento pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do método de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Método de pagamento retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Método de pagamento não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.methodService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um método de pagamento pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do método de pagamento',
  })
  @ApiBody({
    description: 'Dados para atualização do método de pagamento',
    type: CreateMethodDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Método de pagamento atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Método de pagamento não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateMethodDto: UpdateMethodDto) {
    return this.methodService.update(id, updateMethodDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um método de pagamento pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do método de pagamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Método de pagamento removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Método de pagamento não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.methodService.remove(id);
  }
}
