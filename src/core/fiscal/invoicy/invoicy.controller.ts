import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { InvoicyService } from './invoicy.service';
import { FiscalIssuerReadinessService } from './fiscal-issuer-readiness.service';
import { FiscalIssuerActivationService } from './fiscal-issuer-activation.service';
import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
  SetCscDto,
  SetAccessKeyDto,
  SetNfceNumberingDto,
} from './dtos/invoicy-config.dto';
import { ActivateEnvironmentDto } from './dtos/activate-environment.dto';
import { FiscalEnvironment } from '@prisma/client';

@ApiTags('Fiscal - Emissores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fiscal/emissores')
export class EmissoresController {
  constructor(
    private readonly invoicyService: InvoicyService,
    private readonly readinessService: FiscalIssuerReadinessService,
    private readonly activationService: FiscalIssuerActivationService,
  ) {}

  @Get()
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Listar todos os emissores da empresa' })
  async getAll(@Req() req) {
    return this.invoicyService.getAllByCompany(req.user.companyId);
  }

  @Get('default')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Obter emissor padrão da empresa' })
  async getDefault(@Req() req) {
    return this.invoicyService.getDefault(req.user.companyId);
  }

  @Get(':id')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Obter emissor por ID' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async getById(@Req() req, @Param('id') id: string) {
    await this.invoicyService.verifyOwnership(id, req.user.companyId);
    return this.invoicyService.getById(id);
  }

  @Post()
  @HasPermission('create', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar novo emissor' })
  async create(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Atualizar emissor' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateInvoicyConfigDto,
  ) {
    await this.invoicyService.verifyOwnership(id, req.user.companyId);
    return this.invoicyService.update(id, dto);
  }

  @Delete(':id')
  @HasPermission('delete', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Excluir emissor' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async delete(@Req() req, @Param('id') id: string) {
    await this.invoicyService.verifyOwnership(id, req.user.companyId);
    return this.invoicyService.delete(id);
  }

  @Post(':id/set-default')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Definir emissor como padrão' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async setDefault(@Req() req, @Param('id') id: string) {
    return this.invoicyService.setDefault(id, req.user.companyId);
  }

  @Post(':id/test-connection')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Testar conexão com a API do Invoicy' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async testConnection(@Req() req, @Param('id') id: string) {
    await this.invoicyService.verifyOwnership(id, req.user.companyId);
    const success = await this.invoicyService.testConnection(id);
    return { success };
  }

  @Patch(':id/certificate')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Atualizar certificado digital do emissor' })
  @ApiParam({ name: 'id', description: 'ID do emissor' })
  async updateCertificate(
    @Req() req,
    @Param('id') id: string,
    @Body()
    body: {
      certificate: string;
      certificatePassword: string;
      certificateType?: string;
    },
  ) {
    await this.invoicyService.verifyOwnership(id, req.user.companyId);
    return this.invoicyService.updateCertificate(
      id,
      body.certificate,
      body.certificatePassword,
      body.certificateType,
      req.user.userId,
      req.user.username,
    );
  }

  @Post(':invoicyConfigId/environments/:environment/csc')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Configurar CSC para um ambiente do emissor' })
  @ApiParam({ name: 'invoicyConfigId', description: 'ID do emissor' })
  @ApiParam({ name: 'environment', enum: FiscalEnvironment })
  async setCsc(
    @Req() req,
    @Param('invoicyConfigId') invoicyConfigId: string,
    @Param('environment') environment: FiscalEnvironment,
    @Body() body: SetCscDto,
  ) {
    if (!body?.cscId || !body?.cscToken) {
      throw new BadRequestException('cscId e cscToken são obrigatórios');
    }
    await this.invoicyService.verifyOwnership(
      invoicyConfigId,
      req.user.companyId,
    );
    return this.invoicyService.setCsc(
      invoicyConfigId,
      environment,
      body.cscId,
      body.cscToken,
      req.user.userId,
      req.user.username,
    );
  }

  @Delete(':invoicyConfigId/environments/:environment/csc')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Remover CSC de um ambiente do emissor' })
  @ApiParam({ name: 'invoicyConfigId', description: 'ID do emissor' })
  @ApiParam({ name: 'environment', enum: FiscalEnvironment })
  async deleteCsc(
    @Req() req,
    @Param('invoicyConfigId') invoicyConfigId: string,
    @Param('environment') environment: FiscalEnvironment,
  ) {
    await this.invoicyService.verifyOwnership(
      invoicyConfigId,
      req.user.companyId,
    );
    return this.invoicyService.deleteCsc(
      invoicyConfigId,
      environment,
      req.user.userId,
      req.user.username,
    );
  }

  @Post(':invoicyConfigId/environments/:environment/access-key')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Configurar access key Invoicy para um ambiente' })
  @ApiParam({ name: 'invoicyConfigId', description: 'ID do emissor' })
  @ApiParam({ name: 'environment', enum: FiscalEnvironment })
  async setAccessKey(
    @Req() req,
    @Param('invoicyConfigId') invoicyConfigId: string,
    @Param('environment') environment: FiscalEnvironment,
    @Body() body: SetAccessKeyDto,
  ) {
    if (!body?.accessKey) {
      throw new BadRequestException('accessKey é obrigatória');
    }
    await this.invoicyService.verifyOwnership(
      invoicyConfigId,
      req.user.companyId,
    );
    return this.invoicyService.setAccessKey(
      invoicyConfigId,
      environment,
      body.accessKey,
      req.user.userId,
      req.user.username,
    );
  }

  @Patch(':invoicyConfigId/environments/:environment/numbering')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({
    summary: 'Configurar série e numeração de NFC-e para um ambiente',
  })
  @ApiParam({ name: 'invoicyConfigId', description: 'ID do emissor' })
  @ApiParam({ name: 'environment', enum: FiscalEnvironment })
  async setNfceNumbering(
    @Req() req,
    @Param('invoicyConfigId') invoicyConfigId: string,
    @Param('environment') environment: FiscalEnvironment,
    @Body() body: SetNfceNumberingDto,
  ) {
    await this.invoicyService.verifyOwnership(
      invoicyConfigId,
      req.user.companyId,
    );
    return this.invoicyService.setNfceNumbering(
      invoicyConfigId,
      environment,
      body.nfceSeries,
      body.nfceNextNumber,
      req.user.userId,
      req.user.username,
    );
  }

  @Get(':invoicyConfigId/environments/:environment/readiness')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Verificar prontidão do emissor para um ambiente' })
  @ApiParam({ name: 'invoicyConfigId', description: 'ID do emissor' })
  @ApiParam({ name: 'environment', enum: FiscalEnvironment })
  async getReadiness(
    @Req() req,
    @Param('invoicyConfigId') invoicyConfigId: string,
    @Param('environment') environment: FiscalEnvironment,
    @Query('docType') docType?: 'NFE' | 'NFSE' | 'NFCE',
  ) {
    await this.invoicyService.verifyOwnership(
      invoicyConfigId,
      req.user.companyId,
    );
    return this.readinessService.checkFullReadiness(
      req.user.companyId,
      invoicyConfigId,
      environment,
      docType,
    );
  }

  @Post(':invoicyConfigId/environments/:environment/test-connection')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Testar autenticação do emissor em um ambiente' })
  @ApiParam({ name: 'invoicyConfigId', description: 'ID do emissor' })
  @ApiParam({ name: 'environment', enum: FiscalEnvironment })
  async testConnectionForEnvironment(
    @Req() req,
    @Param('invoicyConfigId') invoicyConfigId: string,
    @Param('environment') environment: FiscalEnvironment,
  ) {
    await this.invoicyService.verifyOwnership(
      invoicyConfigId,
      req.user.companyId,
    );
    const success = await this.readinessService.checkConnection(
      req.user.companyId,
      environment,
    );
    return { success };
  }

  @Post(':invoicyConfigId/environments/:environment/activate')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Ativar ambiente do emissor' })
  @ApiParam({ name: 'invoicyConfigId', description: 'ID do emissor' })
  @ApiParam({ name: 'environment', enum: FiscalEnvironment })
  async activateEnvironment(
    @Req() req,
    @Param('invoicyConfigId') invoicyConfigId: string,
    @Param('environment') environment: FiscalEnvironment,
    @Body() dto: ActivateEnvironmentDto,
  ) {
    await this.invoicyService.verifyOwnership(
      invoicyConfigId,
      req.user.companyId,
    );
    return this.activationService.activate(
      req.user.companyId,
      invoicyConfigId,
      environment,
      {
        idempotencyKey: dto.idempotencyKey,
        confirmFiscalValidity: dto.confirmFiscalValidity,
        docType: dto.docType,
        actorUserId: req.user.userId,
        actorUserName: req.user.username,
      },
    );
  }
}

// Mantém o controller legado para compatibilidade
@ApiTags('Fiscal - Invoicy (Legado)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fiscal/invoicy')
export class InvoicyController {
  constructor(private readonly invoicyService: InvoicyService) {}

  @Get('config')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({
    summary: 'Obter configuração do Invoicy (legado - usa emissor padrão)',
  })
  async getConfig(@Req() req) {
    return this.invoicyService.getConfig(req.user.companyId);
  }

  @Post('config')
  @HasPermission('create', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar configuração do Invoicy (legado)' })
  async createConfig(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.create(req.user.companyId, dto);
  }

  @Put('config')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Atualizar configuração do Invoicy (legado)' })
  async updateConfig(@Req() req, @Body() dto: UpdateInvoicyConfigDto) {
    const defaultEmissor = await this.invoicyService.getDefault(
      req.user.companyId,
    );
    if (!defaultEmissor) {
      throw new BadRequestException('Nenhum emissor padrão encontrado');
    }
    return this.invoicyService.update(defaultEmissor.id, dto);
  }

  @Post('config/upsert')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({
    summary: 'Criar ou atualizar configuração do Invoicy (legado)',
  })
  async upsertConfig(@Req() req, @Body() dto: CreateInvoicyConfigDto) {
    return this.invoicyService.upsertConfig(req.user.companyId, dto);
  }

  @Delete('config')
  @HasPermission('delete', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Deletar configuração do Invoicy (legado)' })
  async deleteConfig(@Req() req) {
    const defaultEmissor = await this.invoicyService.getDefault(
      req.user.companyId,
    );
    if (!defaultEmissor) {
      throw new BadRequestException('Nenhum emissor padrão encontrado');
    }
    return this.invoicyService.delete(defaultEmissor.id);
  }

  @Post('test-connection')
  @HasPermission('view', 'nota_fiscal:config')
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
