import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { QuotationTag } from '@prisma/client';
import { CreateStatusQuotationDto } from './dto/create-status.dto';
import { StatusService } from './status.service';
import { UpdateStatusQuotationDto } from './dto/update-status.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';

@ApiTags('Status de Orçamento')
@Controller('sale/status')
@ApiBearerAuth()
// Listar é livre (a lista de orçamentos usa); criar, editar e excluir status é recurso de plano.
@UseGuards(JwtAuthGuard, TenantGuard)
export class StatusController {
  constructor(private readonly statusQuotationService: StatusService) {}

  @Post()
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_status_configuration')
  @ApiOperation({ summary: 'Criar um novo status de orçamento' })
  @ApiResponse({
    status: 201,
    description: 'Status de orçamento criado com sucesso.',
  })
  create(
    @Body() createStatusQuotationDto: CreateStatusQuotationDto,
    @Req() req,
  ): Promise<QuotationTag> {
    createStatusQuotationDto.companyId = req.user.companyId;
    return this.statusQuotationService.create(createStatusQuotationDto);
  }

  @ApiOperation({ summary: 'Listar todos os status de orçamento' })
  @ApiResponse({ status: 200, description: 'Lista de status de orçamento.' })
  @Get()
  async findAll(@Req() req, @Query() filter: BaseFilterDTO): Promise<any> {
    filter.companyId = req.user.companyId;
    return await this.statusQuotationService.findAll(filter);
  }

  @Get(':id')
  @TenantResource('quotationTag')
  @ApiOperation({ summary: 'Buscar um status de orçamento específico' })
  @ApiResponse({ status: 200, description: 'Status de orçamento encontrado.' })
  @ApiResponse({
    status: 404,
    description: 'Status de orçamento não encontrado.',
  })
  findOne(@Param('id') id: string): Promise<QuotationTag> {
    return this.statusQuotationService.findOne(id);
  }

  @Patch(':id')
  @TenantResource('quotationTag')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_status_configuration')
  @ApiOperation({ summary: 'Atualizar um status de orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Status de orçamento atualizado com sucesso.',
  })
  update(
    @Param('id') id: string,
    @Body() updateStatusQuotationDto: UpdateStatusQuotationDto,
  ): Promise<QuotationTag> {
    return this.statusQuotationService.update(id, updateStatusQuotationDto);
  }

  @Delete(':id')
  @TenantResource('quotationTag')
  @UseGuards(FeatureGuard)
  @RequiresFeature('quotation_status_configuration')
  @ApiOperation({ summary: 'Remover um status de orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Status de orçamento removido com sucesso.',
  })
  remove(@Param('id') id: string): Promise<QuotationTag> {
    return this.statusQuotationService.remove(id);
  }
}
