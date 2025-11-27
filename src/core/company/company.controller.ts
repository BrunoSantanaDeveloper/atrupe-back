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
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Company } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

const RESOURCE = 'company';
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
@ApiTags('Empresa')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma empresa' })
  @ApiResponse({
    status: 201,
    description: 'A empresa foi criada com sucesso.',
    type: Promise<Company>,
  })
  @ApiBody({ type: CreateCompanyDto })
  async create(
    @Req() req,
    @Body() createCompanyDto: CreateCompanyDto,
  ): Promise<Company> {
    const companyId = req.user.companyId;
    return await this.companyService.create(createCompanyDto, companyId);
  }

  @Post('main')
  @ApiOperation({ summary: 'Cria uma empresa principal' })
  @ApiResponse({
    status: 201,
    description: 'A empresa foi criada com sucesso.',
    type: Promise<Company>,
  })
  @ApiBody({ type: CreateCompanyDto })
  async createMain(
    @Req() req,
    @Body() createCompanyDto: CreateCompanyDto,
  ): Promise<Company> {
    return await this.companyService.createMainCompany(
      req.user.email,
      createCompanyDto,
    );
  }

  @Post('missing-default-items/:companyId')
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
    type: Promise<Company>,
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
    type: Promise<Company>,
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  findOne(@Param('id') id: string) {
    return this.companyService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma empresa pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da empresa' })
  @ApiBody({ type: CreateCompanyDto })
  @ApiResponse({
    status: 200,
    description: 'A empresa foi atualizada com sucesso.',
    type: Promise<Company>,
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  async update(
    @Param('id') id: string,
    @Body() updateCompanyDto: UpdateCompanyDto,
  ) {
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
  remove(@Param('id') id: string) {
    return this.companyService.remove(id);
  }

  @Get(':id/history')
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
