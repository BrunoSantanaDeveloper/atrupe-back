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
  BadRequestException,
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
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'role';

@ApiTags('Roles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um nova Role' })
  @ApiBody({
    description: 'Dados da nova Role',
    type: CreateRoleDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Role criada com sucesso.',
  })
  async create(@Req() req, @Body() createRoleDto: CreateRoleDto) {
    createRoleDto.companyId = req.user.companyId;
    try {
      return await this.roleService.create(createRoleDto);
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os cargos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de cargos retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: RoleFilterDTO, @Req() req) {
    filter.companyId = req.user.companyId;
    return this.roleService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um Role pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Role' })
  @ApiResponse({
    status: 200,
    description: 'Role retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Role não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um Role pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Role' })
  @ApiBody({
    description: 'Dados para atualização da Role',
    type: UpdateRoleDto,
    examples: {
      example: {
        summary: 'Exemplo de payload para atualização de Role',
        value: {
          name: 'Updated Admin',
          sectorId: '456e7890-e12d-34a6-b789-567890123456',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Role atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Role não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.roleService.update(+id, updateRoleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um Role pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Role' })
  @ApiResponse({
    status: 200,
    description: 'Role removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Role não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.roleService.remove(id);
  }
}
