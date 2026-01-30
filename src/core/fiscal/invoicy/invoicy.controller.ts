import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { InvoicyService } from './invoicy.service';
import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
} from './dtos/invoicy-config.dto';

@ApiTags('Fiscal - Emissores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/emissores')
export class EmissoresController {
  constructor(private readonly invoicyService: InvoicyService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos os emissores da empresa' })
  async getAll(@Req() req) {
    return this.invoicyService.getAllByCompany(req.user.companyId);
  }

  @Get('default')
  @ApiOperation({ summary: 'Obter emissor padrão da empresa' })
  async getDefault(@Req() req) {
    return this.invoicyService.getDefault(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter emissor por ID' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async getById(@Param('id') id: string) {
    return this.invoicyService.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar novo emissor' })
  async create(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar emissor' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async update(@Param('id') id: string, @Body() dto: UpdateInvoicyConfigDto) {
    return this.invoicyService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir emissor' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async delete(@Param('id') id: string) {
    return this.invoicyService.delete(id);
  }

  @Post(':id/set-default')
  @ApiOperation({ summary: 'Definir emissor como padrão' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async setDefault(@Req() req, @Param('id') id: string) {
    return this.invoicyService.setDefault(id, req.user.companyId);
  }

  @Post(':id/test-connection')
  @ApiOperation({ summary: 'Testar conexão com a API do Invoicy' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async testConnection(@Param('id') id: string) {
    const success = await this.invoicyService.testConnection(id);
    return { success };
  }
}

// Mantém o controller legado para compatibilidade
@ApiTags('Fiscal - Invoicy (Legado)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/invoicy')
export class InvoicyController {
  constructor(private readonly invoicyService: InvoicyService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Obter configuração do Invoicy (legado - usa emissor padrão)',
  })
  async getConfig(@Req() req) {
    return this.invoicyService.getConfig(req.user.companyId);
  }

  @Post('config')
  @ApiOperation({ summary: 'Criar configuração do Invoicy (legado)' })
  async createConfig(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.createConfig(req.user.companyId, dto);
  }

  @Put('config')
  @ApiOperation({ summary: 'Atualizar configuração do Invoicy (legado)' })
  async updateConfig(@Req() req, @Body() dto: UpdateInvoicyConfigDto) {
    return this.invoicyService.updateConfig(req.user.companyId, dto);
  }

  @Post('config/upsert')
  @ApiOperation({
    summary: 'Criar ou atualizar configuração do Invoicy (legado)',
  })
  async upsertConfig(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.upsertConfig(req.user.companyId, dto);
  }

  @Delete('config')
  @ApiOperation({ summary: 'Deletar configuração do Invoicy (legado)' })
  async deleteConfig(@Req() req) {
    return this.invoicyService.deleteConfig(req.user.companyId);
  }

  @Post('test-connection')
  @ApiOperation({
    summary:
      'Testar conexão com a API do Invoicy (legado - usa emissor padrão)',
  })
  async testConnection(@Req() req) {
    const defaultEmissor = await this.invoicyService.getDefault(
      req.user.companyId,
    );
    if (!defaultEmissor) {
      return { success: false };
    }
    const success = await this.invoicyService.testConnection(defaultEmissor.id);
    return { success };
  }
}
