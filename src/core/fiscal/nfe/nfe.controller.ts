import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import {
  NfeService,
  EmitNfeDto,
  CancelNfeDto,
  CorrectionDto,
} from './nfe.service';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { IsString, IsOptional, IsNotEmpty, MinLength } from 'class-validator';

// DTOs for validation
export class EmitNfeFromOrderDto implements EmitNfeDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsOptional()
  operationNature?: string;

  @IsString()
  @IsOptional()
  additionalInfo?: string;
}

export class CancelNfeRequestDto implements CancelNfeDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(15, { message: 'Reason must be at least 15 characters' })
  reason: string;
}

export class CorrectionRequestDto implements CorrectionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(15, { message: 'Correction must be at least 15 characters' })
  correction: string;
}

export class NfeFilterDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}

@ApiTags('NF-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/nfe')
export class NfeController {
  constructor(private readonly nfeService: NfeService) {}

  @Post('emit')
  @ApiOperation({ summary: 'Emitir NF-e a partir de uma Ordem de Serviço' })
  @ApiBody({ type: EmitNfeFromOrderDto })
  async emitFromOrder(@Req() req: any, @Body() dto: EmitNfeFromOrderDto) {
    return this.nfeService.emitFromOrder(
      req.user.companyId,
      req.user.id,
      dto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar NF-e da empresa' })
  async findAll(@Req() req: any, @Query() filters: NfeFilterDto) {
    return this.nfeService.findAll(req.user.companyId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar detalhes da NF-e' })
  async findOne(@Req() req: any, @Param('id') id: string) {
    return this.nfeService.findOne(id, req.user.companyId);
  }

  @Get(':id/danfe')
  @ApiOperation({ summary: 'Obter URL do DANFE' })
  async getDanfe(@Req() req: any, @Param('id') id: string) {
    const url = await this.nfeService.getDanfeUrl(id, req.user.companyId);
    return { url };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar NF-e autorizada' })
  @ApiBody({ type: CancelNfeRequestDto })
  async cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CancelNfeRequestDto,
  ) {
    return this.nfeService.cancel(id, req.user.companyId, dto);
  }

  @Post(':id/correction')
  @ApiOperation({ summary: 'Criar Carta de Correção' })
  @ApiBody({ type: CorrectionRequestDto })
  async createCorrection(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CorrectionRequestDto,
  ) {
    return this.nfeService.createCorrection(id, req.user.companyId, dto);
  }
}
