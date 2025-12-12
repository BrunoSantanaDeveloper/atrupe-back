import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { ProductFiscalService } from './product-fiscal.service';
import {
  CreateProductFiscalDataDto,
  UpdateProductFiscalDataDto,
} from './dtos/product-fiscal.dto';

@ApiTags('Fiscal - Dados Fiscais de Produto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/product')
export class ProductFiscalController {
  constructor(private readonly productFiscalService: ProductFiscalService) {}

  @Get(':productId')
  @ApiOperation({ summary: 'Obter dados fiscais de um produto' })
  async findByProductId(@Param('productId') productId: string) {
    return this.productFiscalService.findByProductId(productId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar dados fiscais de um produto' })
  async create(@Body() dto: CreateProductFiscalDataDto) {
    return this.productFiscalService.create(dto);
  }

  @Put(':productId')
  @ApiOperation({ summary: 'Atualizar dados fiscais de um produto' })
  async update(
    @Param('productId') productId: string,
    @Body() dto: UpdateProductFiscalDataDto,
  ) {
    return this.productFiscalService.update(productId, dto);
  }

  @Post('upsert')
  @ApiOperation({ summary: 'Criar ou atualizar dados fiscais de um produto' })
  async upsert(@Body() dto: CreateProductFiscalDataDto) {
    return this.productFiscalService.upsert(dto);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Deletar dados fiscais de um produto' })
  async delete(@Param('productId') productId: string) {
    return this.productFiscalService.delete(productId);
  }
}
