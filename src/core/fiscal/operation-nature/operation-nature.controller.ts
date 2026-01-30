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
import { OperationNatureService } from './operation-nature.service';
import {
  CreateOperationNatureDto,
  UpdateOperationNatureDto,
} from './operation-nature.dto';

@ApiTags('Fiscal - Naturezas de Operação')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/naturezas') // Note: Path updated as per plan
export class OperationNatureController {
  constructor(private readonly service: OperationNatureService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas as Naturezas de Operação da empresa' })
  async getAll(@Req() req) {
    return this.service.getAll(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter Natureza por ID' })
  @ApiParam({ name: 'id', description: 'ID da Natureza' })
  async getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar nova Natureza' })
  async create(@Req() req, @Body() dto: CreateOperationNatureDto) {
    return this.service.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar Natureza' })
  @ApiParam({ name: 'id', description: 'ID da Natureza' })
  async update(@Param('id') id: string, @Body() dto: UpdateOperationNatureDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir Natureza' })
  @ApiParam({ name: 'id', description: 'ID da Natureza' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
