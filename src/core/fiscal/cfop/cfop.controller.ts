import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CfopService } from './cfop.service';
import { CreateCfopDto, UpdateCfopDto } from './cfop.dto';

@ApiTags('Fiscal - CFOPs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/cfops')
export class CfopController {
  constructor(private readonly cfopService: CfopService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos os CFOPs da empresa' })
  async getAll(@Req() req) {
    return this.cfopService.getAll(req.user.companyId);
  }

  @Get('active')
  @ApiOperation({ summary: 'Listar CFOPs ativos da empresa' })
  async getActive(@Req() req) {
    return this.cfopService.getActive(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter CFOP por ID' })
  @ApiParam({ name: 'id', description: 'ID do CFOP' })
  async getById(@Param('id') id: string) {
    return this.cfopService.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar novo CFOP' })
  async create(@Req() req, @Body() dto: CreateCfopDto) {
    return this.cfopService.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar CFOP' })
  @ApiParam({ name: 'id', description: 'ID do CFOP' })
  async update(@Param('id') id: string, @Body() dto: UpdateCfopDto) {
    return this.cfopService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir CFOP' })
  @ApiParam({ name: 'id', description: 'ID do CFOP' })
  async delete(@Param('id') id: string) {
    return this.cfopService.delete(id);
  }
}
