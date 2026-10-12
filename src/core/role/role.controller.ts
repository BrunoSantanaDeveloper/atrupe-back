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
  HttpException,
} from '@nestjs/common';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { RoleFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'role';

/**
 * Configurações > Empresa e sistema > Cargos, com as chaves que a tela usa.
 * Sem elas, qualquer usuário logado editava pela API as permissões do
 * próprio cargo.
 */
const PERMISSION = 'company_settings:roles';

@ApiTags('Roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @HasPermission('create', PERMISSION)
  @ApiOperation({ summary: 'Cria um nova Role' })
  @ApiResponse({
    status: 201,
    description: 'Role criada com sucesso.',
  })
  async create(@Req() req, @Body() createRoleDto: CreateRoleDto) {
    createRoleDto.companyId = req.user.companyId;
    try {
      return await this.roleService.create(createRoleDto, req.user);
    } catch (error) {
      // As recusas do service (setor de outra empresa, acesso total) saem
      // como vieram; só o erro do banco vira 400
      if (error instanceof HttpException) throw error;
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  // Sem permissão: "Meu perfil" e o cadastro de colaborador listam os
  // cargos para qualquer usuário. A lista é só da empresa da sessão.
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
  @HasPermission('view', PERMISSION)
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
  findOne(@Req() req, @Param('id') id: string) {
    return this.roleService.findOne(id, req.user.companyId);
  }

  @Patch(':id')
  @HasPermission('edit', PERMISSION)
  @ApiOperation({ summary: 'Atualiza um Role pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Role' })
  @ApiResponse({
    status: 200,
    description: 'Role atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Role não encontrado.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    return await this.roleService.update(id, updateRoleDto, req.user);
  }

  @Delete(':id')
  @HasPermission('delete', PERMISSION)
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
  remove(@Req() req, @Param('id') id: string) {
    return this.roleService.remove(id, req.user.companyId);
  }
}
