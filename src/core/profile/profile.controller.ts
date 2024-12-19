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
import { ProfileService } from './profile.service';
import {
  AddEmployeeOnProfileDto,
  CreateProfileDto,
} from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

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

@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}
  @ApiTags('Gerenciamento dos perfis')
  @Get('employees')
  @ApiOperation({ summary: 'Lista os funcionários sem Perfil' })
  async listEmployess(@Req() req) {
    const companyId = req.user.companyId;
    return await this.profileService.listEmployeesWithoutProfile(companyId);
  }

  @ApiTags('Gerenciamento dos perfis')
  @Post('employees/:profileId')
  @ApiOperation({ summary: 'Adiciona um perfil ao funcionário' })
  async addEmployee(
    @Param('profileId') profileId: string,
    @Body() dto: AddEmployeeOnProfileDto,
  ) {
    return await this.profileService.addEmployee(profileId, dto);
  }

  @ApiTags('Gerenciamento dos perfis')
  @Delete('employees/:employeeId')
  @ApiOperation({ summary: 'Remove um perfil do funcionário' })
  async removeEmployee(@Param('employeeId') employeeId: string) {
    return this.profileService.removeEmployee(employeeId);
  }

  @ApiTags('Perfil de vendedor')
  @Post()
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
    try {
      return await this.profileService.create(createProfileDto);
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  @ApiTags('Perfil de vendedor')
  @Get()
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
  findOne(@Param('id') id: string) {
    return this.profileService.findOne(id);
  }

  @ApiTags('Perfil de vendedor')
  @Patch(':id')
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
    @Param('id') id: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return await this.profileService.update(id, updateProfileDto);
  }

  @ApiTags('Perfil de vendedor')
  @Delete(':id')
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
  remove(@Param('id') id: string) {
    return this.profileService.remove(id);
  }
}
