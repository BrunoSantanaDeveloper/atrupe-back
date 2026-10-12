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
import { MethodService } from './method.service';
import { CreateMethodDto } from './dto/create-method.dto';
import { UpdateMethodDto } from './dto/update-method.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { SystemAdminGuard } from 'src/core/auth/guards/system-admin.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

/**
 * A forma de pagamento não é da empresa: o cadastro é um só para todas.
 * Renomear ou desativar muda a forma de todas as empresas, então fica com o
 * superadmin; nenhuma tela das empresas faz isso. Criar segue aberto a quem
 * cuida das condições de pagamento, porque o formulário da condição cria a
 * forma que falta (ao criar e ao editar a condição).
 */
const CONDITIONS_PERMISSION = 'financial_settings:payment_methods';

@ApiTags('Métodos de Pagamento')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller('payment-method')
export class MethodController {
  constructor(private readonly methodService: MethodService) {}

  @Post()
  @HasAnyPermission(
    { action: 'create', resource: CONDITIONS_PERMISSION },
    { action: 'edit', resource: CONDITIONS_PERMISSION },
  )
  @ApiOperation({ summary: 'Cria um novo método de pagamento' })
  @ApiBody({
    description: 'Dados do novo método de pagamento',
    type: CreateMethodDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Método de pagamento criado com sucesso.',
  })
  create(@Body() createMethodDto: CreateMethodDto) {
    return this.methodService.create(createMethodDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os métodos de pagamento' })
  @ApiResponse({
    status: 200,
    description: 'Lista de métodos de pagamento retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Query() filter: BaseFilterDTO) {
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
  @UseGuards(SystemAdminGuard)
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
  @UseGuards(SystemAdminGuard)
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
