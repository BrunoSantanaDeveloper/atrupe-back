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
import { SeriesFilterDTO } from './dto/series-filter.dto';

@ApiTags('Série de vendas')
@Controller('sale/series')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
    return await this.saleSeriesService.findAll(filter);
  }

  @ApiOperation({ summary: 'Get a sale series by ID' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series details' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.saleSeriesService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a sale series by ID' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series updated successfully' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateSaleSeriesDto: UpdateSaleSeriesDto,
  ) {
    return this.saleSeriesService.update(id, updateSaleSeriesDto);
  }

  @ApiOperation({ summary: 'Delete a sale series by ID' })
  @ApiParam({ name: 'id', description: 'ID of the sale series' })
  @ApiResponse({ status: 200, description: 'Sale series deleted successfully' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.saleSeriesService.remove(id);
  }
}
