import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FiscalConfigService } from './fiscal-config.service';
import { CreateInvoicyConfigDto } from './dto/create-invoicy-config.dto';
import { UpdateInvoicyConfigDto } from './dto/update-invoicy-config.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';

@ApiTags('Configurações Fiscais')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/config')
export class FiscalConfigController {
  constructor(private readonly configService: FiscalConfigService) {}

  @Post()
  @ApiOperation({ summary: 'Cria configuração Invoicy para a empresa' })
  @ApiResponse({ status: 201, description: 'Configuração criada' })
  @ApiResponse({ status: 409, description: 'Configuração já existe' })
  create(@Req() req: any, @Body() dto: CreateInvoicyConfigDto) {
    const companyId = req.user.companyId;
    return this.configService.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Busca configuração da empresa' })
  @ApiResponse({ status: 200, description: 'Configuração encontrada' })
  @ApiResponse({ status: 404, description: 'Configuração não encontrada' })
  findByCompany(@Req() req: any) {
    const companyId = req.user.companyId;
    return this.configService.findByCompany(companyId);
  }

  @Put()
  @ApiOperation({ summary: 'Atualiza configuração' })
  @ApiResponse({ status: 200, description: 'Configuração atualizada' })
  update(@Req() req: any, @Body() dto: UpdateInvoicyConfigDto) {
    const companyId = req.user.companyId;
    return this.configService.update(companyId, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove configuração' })
  @ApiResponse({ status: 200, description: 'Configuração removida' })
  remove(@Req() req: any) {
    const companyId = req.user.companyId;
    return this.configService.remove(companyId);
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Testa conexão com Invoicy' })
  @ApiResponse({ status: 200, description: 'Resultado do teste' })
  testConnection(@Body() dto: TestConnectionDto) {
    return this.configService.testConnection(dto.cnpj, dto.partnerKey, dto.accessKey);
  }
}
