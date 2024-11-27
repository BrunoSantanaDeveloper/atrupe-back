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
  Request,
} from '@nestjs/common';
import { SectorService } from './sector.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SectorFilterDto } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'sector';

@ApiTags('Setores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class SectorController {
  constructor(private readonly sectorService: SectorService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo setor' })
  @ApiBody({
    description: 'Dados do novo setor',
    type: CreateSectorDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Setor criado com sucesso.',
  })
  create(@Request() req, @Body() createSectorDto: CreateSectorDto) {
    createSectorDto.companyId = req.user.companyId;
    return this.sectorService.create(createSectorDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os setores' })
  @ApiQuery({ name: 'filter', type: SectorFilterDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de setores retornada com sucesso.',
    isArray: true,
  })
  findAll(@Req() req, @Query() filter: SectorFilterDto) {
    filter.companyId = req.user.companyId;
    return this.sectorService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um setor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do setor' })
  @ApiResponse({
    status: 200,
    description: 'Setor retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Setor não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.sectorService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um setor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do setor' })
  @ApiBody({
    description: 'Dados para atualização do setor',
    type: UpdateSectorDto,
    examples: {
      example: {
        summary: 'Exemplo de payload para atualização de setor',
        value: {
          name: 'Tecnologia',
          icon: 'icon.png',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Setor atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Setor não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateSectorDto: UpdateSectorDto) {
    return this.sectorService.update(id, updateSectorDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um setor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do setor' })
  @ApiResponse({
    status: 200,
    description: 'Setor removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Setor não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.sectorService.remove(id);
  }
}
