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
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RoleFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

const RESOURCE = 'role';

@ApiTags('Cargos')
@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo Cargo' })
  @ApiBody({
    description: 'Dados da novo Cargo',
    type: CreateRoleDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Cargo criada com sucesso.',
  })
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.roleService.create(createRoleDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os cargos' })
  @ApiQuery({ name: 'filter', type: RoleFilterDTO, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de cargos retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: RoleFilterDTO) {
    return this.roleService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um Cargo pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Cargo' })
  @ApiResponse({
    status: 200,
    description: 'Cargo retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cargo não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um Cargo pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Cargo' })
  @ApiBody({
    description: 'Dados para atualização da Cargo',
    type: UpdateRoleDto,
    examples: {
      example: {
        summary: 'Exemplo de payload para atualização de Cargo',
        value: {
          name: 'Updated Admin',
          sectorId: '456e7890-e12d-34a6-b789-567890123456',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Cargo atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cargo não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.roleService.update(+id, updateRoleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um Cargo pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Cargo' })
  @ApiResponse({
    status: 200,
    description: 'Cargo removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cargo não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.roleService.remove(+id);
  }
}
