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
import { CreateProfileDto } from './dto/create-profile.dto';
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
import { ProfileFilterDTO } from './dto/filter.dto';

const RESOURCE = 'profile';

@ApiTags('Cargos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo Cargo' })
  @ApiBody({
    description: 'Dados da novo Cargo',
    type: CreateProfileDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Cargo criada com sucesso.',
  })
  async create(@Req() req, @Body() createProfileDto: CreateProfileDto) {
    console.log(req.user);
    createProfileDto.companyId = req.user.companyId;
    try {
      return await this.profileService.create(createProfileDto);
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
  async findAll(@Query() filter: ProfileFilterDTO, @Req() req) {
    filter.companyId = req.user.companyId;
    return await this.profileService.findAll(filter);
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
    return this.profileService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um Cargo pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da Cargo' })
  @ApiBody({
    description: 'Dados para atualização da Cargo',
    type: UpdateProfileDto,
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
  async update(
    @Param('id') id: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return await this.profileService.update(id, updateProfileDto);
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
    return this.profileService.remove(id);
  }

  @Get('employees/list')
  async listEmployess(@Req() req) {
    const companyId = req.user.companyId;
    return await this.profileService.listEmployees(companyId);
  }

  @Patch(':profileId/add/:employeeId')
  async addEmployee(
    @Param('profileId') profileId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return await this.profileService.addEmployee(profileId, employeeId);
  }

  @Patch('remove/:employeeId')
  async removeEmployee(@Param('employeeId') employeeId: string) {
    return this.profileService.removeEmployee(employeeId);
  }
}
