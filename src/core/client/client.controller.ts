import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientService } from './client.service';
import { CreateClientDto, PreRegisterClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantResource } from '../auth/guards/tenant-resource.decorator';
import { PlanControlService } from '../plan/plan-control.service';
import { ClientFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'client';
const UUID_ROUTE = ':id([0-9a-fA-F-]{36})';

@ApiTags('Clientes')
@UseGuards(JwtAuthGuard, PermissionsGuard, TenantGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ClientController {
  constructor(
    private readonly clientService: ClientService,
    private readonly planControlService: PlanControlService,
  ) {}

  /**
   * Gestão de responsável (colaborador) do cliente é feature do plano Lite
   * (client_responsible_management). Impõe o paywall no backend tanto ao
   * atribuir um responsável quanto ao filtrar a carteira por responsável.
   */
  private async enforceResponsibleFeature(
    companyId: string,
    responsibleId?: string,
  ) {
    if (responsibleId) {
      await this.planControlService.enforceFeature(
        companyId,
        'client_responsible_management',
      );
    }
  }

  /**
   * Limite de crédito por cliente é recurso de plano. A tela só envia o
   * bloco `creditLimit` quando o plano o inclui.
   */
  private async enforceCreditLimitFeature(
    companyId: string,
    creditLimit?: unknown,
  ) {
    if (creditLimit !== undefined && creditLimit !== null) {
      await this.planControlService.enforceFeature(
        companyId,
        'credit_limit_configuration',
      );
    }
  }

  @Post()
  @HasPermission('create', 'register:client')
  @ApiOperation({ summary: 'Cria um novo cliente' })
  @ApiBody({
    description: 'Dados do novo cliente',
    type: CreateClientDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Cliente criado com sucesso.',
  })
  async create(@Req() req, @Body() createClientDto: CreateClientDto) {
    createClientDto.companyId = req.user.companyId;
    if (createClientDto.companyId !== req.user.companyId) {
      throw new UnauthorizedException('Unauthorized');
    }
    await this.enforceResponsibleFeature(
      req.user.companyId,
      createClientDto.responsibleId,
    );
    await this.enforceCreditLimitFeature(
      req.user.companyId,
      createClientDto.creditLimit,
    );
    return this.clientService.create(createClientDto);
  }

  @Post('import-csv')
  async importCsv(@Req() req) {
    const companyId = req.user.companyId;
    const filePath =
      '/home/tribodev/atrupe-back/src/helpers/payload/clients.csv';
    try {
      return await this.clientService.createClientsFromCsv(filePath, companyId);
    } catch (error) {
      console.error(error);
    }
  }

  @Post('import-csv-v2')
  @ApiOperation({ summary: 'Importa clientes do CSV versão 2' })
  @ApiResponse({
    status: 201,
    description: 'Clientes importados com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao processar o arquivo CSV.',
  })
  async importCsvV2(@Req() req) {
    const companyId = req.user.companyId;
    const filePath =
      '/home/tribodev/atrupe-back/src/helpers/payload/clients-v2.csv';
    try {
      return await this.clientService.createClientsFromCsvV2(
        filePath,
        companyId,
      );
    } catch (error) {
      console.error('Erro ao importar clientes do CSV v2:', error);
      throw error;
    }
  }

  @Post('pre-register')
  @ApiOperation({ summary: 'Pré-registro do cliente' })
  @ApiBody({
    description: 'Dados do novo cliente',
    type: PreRegisterClientDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Client pre-registered successfully.',
  })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  async preRegister(
    @Req() req,
    @Body() preRegisterClientDto: PreRegisterClientDto,
  ) {
    preRegisterClientDto.companyId = req.user.companyId;
    return this.clientService.preRegisterClient(preRegisterClientDto);
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os clientes em seus status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de caixas retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.clientService.findAllQuantity(companyId);
  }

  @Get('lookup/:document')
  @HasPermission('view', 'register:client')
  @ApiOperation({
    summary: 'Busca dados de pessoa/empresa por CPF ou CNPJ',
    description:
      'Consulta APIs externas para auto-preenchimento de cadastro. Também verifica se o documento já existe no sistema.',
  })
  @ApiParam({
    name: 'document',
    required: true,
    description: 'CPF (11 dígitos) ou CNPJ (14 dígitos)',
  })
  @ApiResponse({ status: 200, description: 'Dados encontrados.' })
  @ApiResponse({ status: 400, description: 'Documento inválido.' })
  @ApiResponse({ status: 404, description: 'Dados não encontrados.' })
  lookupDocument(@Req() req, @Param('document') document: string) {
    return this.clientService.lookupDocument(document, req.user.companyId);
  }

  @Get()
  @HasPermission('view', 'register:client')
  @ApiOperation({ summary: 'Obtém a lista de todos os clientes' })
  @ApiResponse({
    status: 200,
    description: 'Lista de clientes retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() filter: ClientFilterDTO) {
    filter.companyId = req.user.companyId;
    await this.enforceResponsibleFeature(
      req.user.companyId,
      filter.responsibleId,
    );
    return this.clientService.findAll(filter);
  }

  @Get('export')
  @HasPermission('export', 'register:client')
  @ApiOperation({ summary: 'ObtÃ©m os clientes filtrados para exportaÃ§Ã£o' })
  @ApiResponse({
    status: 200,
    description: 'Lista de clientes para exportaÃ§Ã£o retornada com sucesso.',
  })
  async export(@Req() req, @Query() filter: ClientFilterDTO) {
    filter.companyId = req.user.companyId;
    await this.enforceResponsibleFeature(
      req.user.companyId,
      filter.responsibleId,
    );
    return this.clientService.findAllForExport(filter);
  }

  @Get(UUID_ROUTE)
  @TenantResource('client')
  @ApiOperation({ summary: 'Obtém um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Cliente retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.clientService.findOne(id);
  }

  @Get(':id/fiscal-completeness')
  @TenantResource('client')
  @HasPermission('view', 'register:client')
  @ApiOperation({
    summary: 'Retorna o status de completude fiscal do cliente',
    description:
      'Verifica se o cliente tem todos os dados obrigatórios para emissão de NF-e/NFS-e.',
  })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description:
      'Status de completude fiscal: APPROVED, PARTIAL ou INCOMPLETE.',
  })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  getFiscalCompleteness(@Req() req, @Param('id') id: string) {
    return this.clientService.getFiscalCompleteness(id, req.user.companyId);
  }

  @Get(':id/contacts')
  @ApiOperation({ summary: 'Obtém os contatos/responsáveis de um cliente' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contatos do cliente retornada com sucesso.',
    isArray: true,
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  findClientContacts(@Param('id') id: string) {
    return this.clientService.findClientContacts(id);
  }

  @Patch(':id')
  @TenantResource('client')
  @HasPermission('edit', 'register:client')
  @ApiOperation({ summary: 'Atualiza um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiBody({
    description: 'Dados para atualização do cliente',
    type: UpdateClientDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Cliente atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    await this.enforceResponsibleFeature(
      req.user.companyId,
      updateClientDto.responsibleId,
    );
    await this.enforceCreditLimitFeature(
      req.user.companyId,
      updateClientDto.creditLimit,
    );
    return this.clientService.update(id, updateClientDto);
  }

  @Patch(':id/status')
  @HasPermission('edit', 'register:client')
  @ApiOperation({
    summary: 'Ativa ou desativa um cliente',
    description:
      'Se o cliente está INACTIVE, ativa para PROSPECT (só nome) ou ACTIVE (dados completos). Se está ACTIVE/PROSPECT, desativa para INACTIVE.',
  })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Status do cliente alterado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  toggleStatus(@Param('id') id: string) {
    return this.clientService.toggleClientStatus(id);
  }

  @Post(':id/convert-to-supplier')
  @HasPermission('edit', 'register:client')
  @ApiOperation({
    summary: 'Converte um cliente em fornecedor',
    description:
      'Cria um novo fornecedor com os mesmos dados do cliente, se não existir um fornecedor com o mesmo CPF/CNPJ.',
  })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 201,
    description: 'Fornecedor criado com sucesso a partir do cliente.',
  })
  @ApiResponse({
    status: 400,
    description: 'Já existe um fornecedor com o mesmo CPF/CNPJ.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  convertToSupplier(@Req() req, @Param('id') id: string) {
    return this.clientService.convertToSupplier(id, req.user.companyId);
  }

  @Delete(':id')
  @TenantResource('client')
  @HasPermission('delete', 'register:client')
  @ApiOperation({ summary: 'Remove um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Cliente removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.clientService.remove(id);
  }
}
