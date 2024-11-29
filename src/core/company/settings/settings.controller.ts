import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
  Patch,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateReasonDto } from './dto/create-setting.dto';
import { UpdateReasonDto } from './dto/update-setting.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

const RESOURCE = 'cancel-reason';
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
@ApiTags('Configurações de motivo de cancelamento ou rejeição')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @ApiOperation({ summary: 'Criar motivo de rejeição ou cancelamento' })
  @ApiResponse({ status: 201, description: 'Motivo criado com sucesso' })
  @ApiResponse({ status: 400, description: 'Requisição inválida' })
  @Post()
  create(@Req() req, @Body() createReasonDto: CreateReasonDto) {
    createReasonDto.companyId = req.user.companyId;
    return this.settingsService.create(createReasonDto);
  }
  @ApiOperation({
    summary: 'Listar motivos de rejeição ou cancelamento por tipo',
  })
  @ApiResponse({ status: 200, description: 'Motivos listados com sucesso' })
  @Get()
  async findAll(@Req() req, @Query() filter: BaseFilterDTO) {
    filter.companyId = req.user.companyId;

    return await this.settingsService.findAllByType(filter);
  }

  @ApiOperation({ summary: 'Editar motivo de rejeição ou cancelamento' })
  @ApiResponse({ status: 200, description: 'Motivo atualizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Requisição inválida' })
  @ApiParam({ name: 'id', description: 'ID do motivo' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateReasonDto: UpdateReasonDto) {
    return this.settingsService.update(id, updateReasonDto);
  }

  @ApiOperation({ summary: 'Remover motivo de rejeição ou cancelamento' })
  @ApiResponse({ status: 200, description: 'Motivo removido com sucesso' })
  @ApiParam({ name: 'id', description: 'ID do motivo' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.settingsService.remove(id);
  }
}
