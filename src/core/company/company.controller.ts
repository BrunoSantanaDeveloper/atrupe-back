import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateCompanyHistoryDto } from './dto/create-company-history.dto';
import { ListCompanyHistoryDto } from './dto/list-company-history.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

const RESOURCE = 'company';
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
@ApiTags('Empresa')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  // Outra empresa na mesma conta (filial, outro CNPJ) é recurso de plano. A
  // empresa principal, criada no cadastro (`POST /company/main`), nunca.
  @Post()
  @UseGuards(FeatureGuard)
  @RequiresFeature('multiple_companies')
  @ApiOperation({ summary: 'Cria uma empresa' })
  @ApiResponse({
    status: 201,
    description: 'A empresa foi criada com sucesso.',
  })
  @ApiBody({ type: CreateCompanyDto })
  async create(
    @Req() req,
    @Body() createCompanyDto: CreateCompanyDto,
  ): Promise<any> {
    const companyId = req.user.companyId;
    return await this.companyService.create(createCompanyDto, companyId);
  }

  @Post('main')
  @ApiOperation({ summary: 'Cria uma empresa principal' })
  @ApiResponse({
    status: 201,
    description: 'A empresa foi criada com sucesso.',
  })
  @ApiBody({ type: CreateCompanyDto })
  async createMain(
    @Req() req,
    @Body() createCompanyDto: CreateCompanyDto,
  ): Promise<any> {
    return await this.companyService.createMainCompany(
      req.user.email,
      createCompanyDto,
    );
  }

  // Ferramenta de suporte: completa os cadastros padrão de qualquer empresa
  @Post('missing-default-items/:companyId')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({
    summary: 'Cria itens padrão ausentes para uma empresa existente',
  })
  @ApiParam({ name: 'companyId', required: true, description: 'ID da empresa' })
  @ApiResponse({
    status: 200,
    description: 'Itens padrão ausentes foram criados com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  async createMissingDefaultItems(@Param('companyId') companyId: string) {
    return await this.companyService.createMissingDefaultItems(companyId);
  }

  @Get('check/:cnpj')
  @ApiOperation({
    summary: 'Verifica o CNPJ fornecido em um serviço externo.',
  })
  @ApiParam({ name: 'cnpj', required: true, description: 'CNPJ da empresa' })
  @ApiResponse({
    status: 200,
    description: 'Dados encontrados da empresa.',
  })
  check(@Param('cnpj') cnpj: string) {
    return this.companyService.check(cnpj);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de empresas pelo ID' })
  @ApiResponse({
    status: 200,
    description: 'A empresa foi encontrada.',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  async findAll(@Req() req, @Query() filter: BaseFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.companyService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma empresa pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da empresa' })
  @ApiResponse({
    status: 200,
    description: 'A empresa foi encontrada.',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  async findOne(@Param('id') id: string, @Req() req) {
    await this.companyService.assertInAccount(id, req.user);
    return this.companyService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma empresa pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da empresa' })
  @ApiBody({ type: CreateCompanyDto })
  @ApiResponse({
    status: 200,
    description: 'A empresa foi atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  async update(
    @Param('id') id: string,
    @Body() updateCompanyDto: UpdateCompanyDto,
    @Req() req,
  ) {
    await this.companyService.assertInAccount(id, req.user);
    return await this.companyService.update(id, updateCompanyDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma empresa pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da empresa' })
  @ApiResponse({
    status: 200,
    description: 'A empresa foi removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  async remove(@Param('id') id: string, @Req() req) {
    await this.companyService.assertInAccount(id, req.user);
    return this.companyService.remove(id);
  }

  // O histórico da conta é do superadmin (tela de contas em teste)
  @Get(':id/history')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Lista o histórico de uma empresa' })
  @ApiParam({ name: 'id', required: true, description: 'ID da empresa' })
  @ApiResponse({
    status: 200,
    description: 'Histórico da empresa retornado com sucesso.',
  })
  async listHistory(
    @Param('id') id: string,
    @Query() query: ListCompanyHistoryDto,
  ) {
    return await this.companyService.listHistory(id, query.page, query.limit);
  }

  @Post(':id/history')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Adiciona um registro ao histórico da empresa' })
  @ApiParam({ name: 'id', required: true, description: 'ID da empresa' })
  @ApiBody({ type: CreateCompanyHistoryDto })
  @ApiResponse({
    status: 201,
    description: 'Registro de histórico criado com sucesso.',
  })
  async createHistory(
    @Param('id') id: string,
    @Body() createHistoryDto: CreateCompanyHistoryDto,
    @Req() req,
  ) {
    return await this.companyService.createHistory(
      id,
      createHistoryDto.action,
      createHistoryDto.description,
      createHistoryDto.changes,
      createHistoryDto.metadata,
      req.user.userId,
      req.user.name,
    );
  }
}
