import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { ProductFiscalService, ProductFiscalDataDto } from './product-fiscal.service';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  IsString,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class ProductFiscalDataRequestDto implements ProductFiscalDataDto {
  @IsString()
  @IsOptional()
  productCode?: string;

  @IsString()
  @IsOptional()
  commercialUnit?: string;

  @IsString()
  @IsOptional()
  ncm?: string;

  @IsString()
  @IsOptional()
  cean?: string;

  @IsString()
  @IsOptional()
  icmsOrigin?: string;

  @IsString()
  @IsOptional()
  icmsCst?: string;

  @IsNumber()
  @IsOptional()
  icmsRate?: number;

  @IsNumber()
  @IsOptional()
  icmsCreditRate?: number;

  @IsString()
  @IsOptional()
  icmsBaseModality?: string;

  @IsString()
  @IsOptional()
  pisCst?: string;

  @IsNumber()
  @IsOptional()
  pisRate?: number;

  @IsString()
  @IsOptional()
  cofinsCst?: string;

  @IsNumber()
  @IsOptional()
  cofinsRate?: number;

  @IsString()
  @IsOptional()
  ipiFramework?: string;

  @IsString()
  @IsOptional()
  ipiCst?: string;

  @IsNumber()
  @IsOptional()
  ipiRate?: number;

  @IsString()
  @IsOptional()
  cfopInState?: string;

  @IsString()
  @IsOptional()
  cfopOutState?: string;

  @IsString()
  @IsOptional()
  cfopExport?: string;
}

@ApiTags('Product Fiscal Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/product')
export class ProductFiscalController {
  constructor(private readonly productFiscalService: ProductFiscalService) {}

  @Get(':productId')
  @ApiOperation({ summary: 'Buscar dados fiscais do produto' })
  async findByProductId(@Req() req: any, @Param('productId') productId: string) {
    return this.productFiscalService.findByProductId(
      productId,
      req.user.companyId,
    );
  }

  @Post(':productId')
  @ApiOperation({ summary: 'Criar ou atualizar dados fiscais do produto' })
  @ApiBody({ type: ProductFiscalDataRequestDto })
  async upsert(
    @Req() req: any,
    @Param('productId') productId: string,
    @Body() dto: ProductFiscalDataRequestDto,
  ) {
    return this.productFiscalService.upsert(
      productId,
      req.user.companyId,
      dto,
    );
  }

  @Put(':productId')
  @ApiOperation({ summary: 'Atualizar dados fiscais do produto' })
  @ApiBody({ type: ProductFiscalDataRequestDto })
  async update(
    @Req() req: any,
    @Param('productId') productId: string,
    @Body() dto: ProductFiscalDataRequestDto,
  ) {
    return this.productFiscalService.upsert(
      productId,
      req.user.companyId,
      dto,
    );
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Remover dados fiscais do produto' })
  async delete(@Req() req: any, @Param('productId') productId: string) {
    return this.productFiscalService.delete(productId, req.user.companyId);
  }
}
