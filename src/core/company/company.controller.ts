import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
} from '@nestjs/swagger';
import { Company } from '@prisma/client';

const RESOURCE = 'company';
@UseGuards(JwtAuthGuard)
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
  create(@Body() createCompanyDto: CreateCompanyDto): Promise<Company> {
    return this.companyService.create(createCompanyDto);
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
  update(@Param('id') id: string, @Body() updateCompanyDto: UpdateCompanyDto) {
    return this.companyService.update(id, updateCompanyDto);
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
}
