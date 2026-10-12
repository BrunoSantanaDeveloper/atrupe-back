import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
  Req,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CreateSaleSeriesDto } from './dto/create-series.dto';
import { SaleSeriesService } from './series.service';
import { UpdateSaleSeriesDto } from './dto/update-serie.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { SeriesFilterDTO } from './dto/series-filter.dto';

/**
 * Configurações > Vendas > Séries de venda: a tela pede edit para criar,
 * alterar, inativar e apagar os dados de treinamento. As leituras ficam sem
 * permissão, porque o orçamento lista as séries para qualquer vendedor.
 */
const PERMISSION = 'sales_settings:series';

@ApiTags('Série de vendas')
@Controller('sale/series')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SaleSeriesController {
  constructor(private readonly saleSeriesService: SaleSeriesService) {}

  @ApiOperation({ summary: 'Create a new sale series' })
  @ApiResponse({ status: 201, description: 'Sale series created successfully' })
  @Post()
  @HasPermission('edit', PERMISSION)
  async create(@Req() req, @Body() createSaleSeriesDto: CreateSaleSeriesDto) {
    createSaleSeriesDto.companyId = req.user.companyId;
    return await this.saleSeriesService.create(createSaleSeriesDto);
  }

  @ApiOperation({ summary: 'Get all sale series' })
  @ApiResponse({ status: 200, description: 'List of sale series' })
  @Get()
  async findAll(@Req() req, @Query() filter: SeriesFilterDTO) {
    filter.companyId = req.user.companyId;
    filter.employeeId = req.user.employeeId;
    filter.isAdmin = req.user.isAdmin;
    return await this.saleSeriesService.findAll(filter);
  }

  @ApiOperation({ summary: 'Get a sale series by ID' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series details' })
  @Get(':id')
  async findOne(@Req() req, @Param('id') id: string) {
    return await this.saleSeriesService.findOne(id, req.user.companyId);
  }

  @ApiOperation({ summary: 'Update a sale series by ID' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series updated successfully' })
  @Patch(':id')
  @HasPermission('edit', PERMISSION)
  update(
    @Param('id') id: string,
    @Body() updateSaleSeriesDto: UpdateSaleSeriesDto,
    @Req() req,
  ) {
    if (
      updateSaleSeriesDto.currentBudgetNumber !== undefined &&
      !req.user?.isAdmin
    ) {
      throw new ForbiddenException(
        'Somente administradores podem alterar o número atual do orçamento.',
      );
    }

    return this.saleSeriesService.update(
      id,
      req.user.companyId,
      updateSaleSeriesDto,
      req.user?.isAdmin,
    );
  }

  @ApiOperation({ summary: 'Inactivate a sale series by ID' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({
    status: 200,
    description: 'Sale series inactivated successfully',
  })
  @Delete(':id')
  @HasPermission('edit', PERMISSION)
  remove(@Req() req, @Param('id') id: string) {
    return this.saleSeriesService.remove(id, req.user.companyId);
  }

  @ApiOperation({ summary: 'Delete a sale series by ID and purge data' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series deleted successfully' })
  @Delete('purge/:id')
  @HasPermission('edit', PERMISSION)
  async purge(@Req() req, @Param('id') id: string) {
    return this.saleSeriesService.removeTrainingSerieData(
      id,
      req.user.companyId,
    );
  }
}
