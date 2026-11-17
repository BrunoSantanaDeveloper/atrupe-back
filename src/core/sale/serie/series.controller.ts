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
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';
import { SeriesFilterDTO } from './dto/series-filter.dto';

@ApiTags('Série de vendas')
@Controller('sale/series')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
export class SaleSeriesController {
  constructor(private readonly saleSeriesService: SaleSeriesService) {}

  @ApiOperation({ summary: 'Create a new sale series' })
  @ApiResponse({ status: 201, description: 'Sale series created successfully' })
  @Post()
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
  @TenantResource('saleSeries')
  async findOne(@Param('id') id: string) {
    return await this.saleSeriesService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a sale series by ID' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series updated successfully' })
  @Patch(':id')
  @TenantResource('saleSeries')
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
  @TenantResource('saleSeries')
  remove(@Param('id') id: string) {
    return this.saleSeriesService.remove(id);
  }

  @ApiOperation({ summary: 'Delete a sale series by ID and purge data' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series deleted successfully' })
  @Delete('purge/:id')
  @TenantResource('saleSeries')
  async purge(@Param('id') id: string) {
    return this.saleSeriesService.removeTrainingSerieData(id);
  }
}
