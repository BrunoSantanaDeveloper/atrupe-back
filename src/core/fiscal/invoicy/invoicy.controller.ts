import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { InvoicyService } from './invoicy.service';
import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
} from './dtos/invoicy-config.dto';

@ApiTags('Fiscal - Invoicy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/invoicy')
export class InvoicyController {
  constructor(private readonly invoicyService: InvoicyService) {}

  @Get('config')
  @ApiOperation({ summary: 'Obter configuração do Invoicy' })
  async getConfig(@Req() req) {
    return this.invoicyService.getConfig(req.user.companyId);
  }

  @Post('config')
  @ApiOperation({ summary: 'Criar configuração do Invoicy' })
  async createConfig(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.createConfig(req.user.companyId, dto);
  }

  @Put('config')
  @ApiOperation({ summary: 'Atualizar configuração do Invoicy' })
  async updateConfig(@Req() req, @Body() dto: UpdateInvoicyConfigDto) {
    return this.invoicyService.updateConfig(req.user.companyId, dto);
  }

  @Post('config/upsert')
  @ApiOperation({ summary: 'Criar ou atualizar configuração do Invoicy' })
  async upsertConfig(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.upsertConfig(req.user.companyId, dto);
  }

  @Delete('config')
  @ApiOperation({ summary: 'Deletar configuração do Invoicy' })
  async deleteConfig(@Req() req) {
    return this.invoicyService.deleteConfig(req.user.companyId);
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Testar conexão com a API do Invoicy' })
  async testConnection(@Req() req) {
    const success = await this.invoicyService.testConnection(
      req.user.companyId,
    );
    return { success };
  }
}
