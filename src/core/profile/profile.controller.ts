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
import { ProfileService } from './profile.service';
import {
  AddEmployeeOnProfileDto,
  CreateProfileDto,
} from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

const RESOURCE = 'profile';

/**
 * Configurações > Vendas > Perfil de vendedor. As mesmas chaves que a tela
 * usa: sem elas, qualquer usuário logado mudava pela API a comissão e o
 * desconto máximo do próprio perfil.
 */
const PERMISSION = 'sales_settings:seller_profile';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}
  @ApiTags('Gerenciamento dos perfis')
  @Get('employees')
  @HasPermission('edit', PERMISSION)
  @ApiOperation({ summary: 'Lista os funcionários sem Perfil' })
  async listEmployess(@Req() req) {
    const companyId = req.user.companyId;
    return await this.profileService.listEmployeesWithoutProfile(companyId);
  }

  @ApiTags('Gerenciamento dos perfis')
  @Post('employees/:profileId')
  @HasPermission('edit', PERMISSION)
  @ApiOperation({ summary: 'Adiciona um perfil ao funcionário' })
  async addEmployee(
    @Req() req,
    @Param('profileId') profileId: string,
    @Body() dto: AddEmployeeOnProfileDto,
  ) {
    return await this.profileService.addEmployee(
      profileId,
      req.user.companyId,
      dto,
    );
  }

  @ApiTags('Gerenciamento dos perfis')
  @Delete('employees/:employeeId')
  @HasPermission('delete', PERMISSION)
  @ApiOperation({ summary: 'Remove um perfil do funcionário' })
  async removeEmployee(@Req() req, @Param('employeeId') employeeId: string) {
    return this.profileService.removeEmployee(employeeId, req.user.companyId);
  }

  @ApiTags('Perfil de vendedor')
  @Post()
  @HasPermission('create', PERMISSION)
  @ApiOperation({ summary: 'Cria um novo Perfil' })
  @ApiBody({
    description: 'Dados da novo Perfil',
    type: CreateProfileDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Perfil criada com sucesso.',
  })
  async create(@Req() req, @Body() createProfileDto: CreateProfileDto) {
    createProfileDto.companyId = req.user.companyId;
    return await this.profileService.create(createProfileDto);
  }

  @ApiTags('Perfil de vendedor')
  @Get()
  // A edição da série de venda lista os perfis para escolher os permitidos
  @HasAnyPermission(
    { action: 'view', resource: PERMISSION },
    { action: 'edit', resource: 'sales_settings:series' },
  )
  @ApiOperation({ summary: 'Obtém a lista de todos os cargos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de cargos retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Query() filter: BaseFilterDTO, @Req() req) {
    filter.companyId = req.user.companyId;
    return await this.profileService.findAll(filter);
  }
  @ApiTags('Perfil de vendedor')
  @Get(':id')
  @HasPermission('view', PERMISSION)
  @ApiOperation({ summary: 'Obtém um Perfil pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Perfil' })
  @ApiResponse({
    status: 200,
    description: 'Perfil retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Perfil não encontrado.',
  })
  findOne(@Req() req, @Param('id') id: string) {
    return this.profileService.findOne(id, req.user.companyId);
  }

  @ApiTags('Perfil de vendedor')
  @Patch(':id')
  @HasPermission('edit', PERMISSION)
  @ApiOperation({ summary: 'Atualiza um Perfil pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Perfil' })
  @ApiBody({
    description: 'Dados para atualização da Perfil',
    type: UpdateProfileDto,
    examples: {
      example: {
        summary: 'Exemplo de payload para atualização de Perfil',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Perfil atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Perfil não encontrado.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return await this.profileService.update(
      id,
      req.user.companyId,
      updateProfileDto,
    );
  }

  @ApiTags('Perfil de vendedor')
  @Delete(':id')
  @HasPermission('delete', PERMISSION)
  @ApiOperation({ summary: 'Remove um Perfil pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Perfil' })
  @ApiResponse({
    status: 200,
    description: 'Perfil removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Perfil não encontrado.',
  })
  async remove(@Req() req, @Param('id') id: string) {
    return await this.profileService.remove(id, req.user.companyId);
  }
}
