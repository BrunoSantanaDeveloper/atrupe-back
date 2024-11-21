import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  BadRequestException,
  Patch,
} from '@nestjs/common';
import { QuotationService } from './quotation.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { FilterQuotationDto } from './dto/filter.dto';
import { isUUID } from 'class-validator';
import { DuplicateQuotationDto } from './dto/duplicate-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

const RESOURCE = 'quotation';

@ApiTags('Orçamentos')
@UseGuards(JwtAuthGuard)
@Controller(`sale/${RESOURCE}`)
export class QuotationController {
  constructor(private readonly quotationService: QuotationService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo orçamento' })
  @ApiBody({
    description: 'Dados do novo orçamento',
    type: CreateQuotationDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Orçamento criado com sucesso.',
  })
  create(@Body() createQuotationDto: CreateQuotationDto) {
    return this.quotationService.create(createQuotationDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os orçamentos' })
  @ApiQuery({ name: 'filter', type: FilterQuotationDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de orçamentos retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() query: FilterQuotationDto) {
    return this.quotationService.findAll(query);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplica um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiBody({
    description: 'Dados para duplicação do orçamento',
    type: DuplicateQuotationDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Orçamento duplicado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async duplicate(@Param('id') id: string, @Body() dto: DuplicateQuotationDto) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }

    return this.quotationService.duplicate(id, dto);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Aprova um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento aprovado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async approve(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return this.quotationService.approve(id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Rejeita um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento rejeitado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async reject(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return this.quotationService.reject(id);
  }

  @Post(':id/finish')
  @ApiOperation({ summary: 'Finaliza um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento finalizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async finish(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return this.quotationService.finish(id);
  }

  @Post(':id/open')
  @ApiOperation({ summary: 'Reabre um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento reaberto com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async open(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return this.quotationService.open(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento retornado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento não encontrado.',
  })
  findOne(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return this.quotationService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiBody({
    description: 'Dados para atualização do orçamento',
    type: UpdateQuotationDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Orçamento atualizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  update(
    @Param('id') id: string,
    @Body() updateQuotationDto: UpdateQuotationDto,
  ) {
    return this.quotationService.update(id, updateQuotationDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um orçamento pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Orçamento removido com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.quotationService.remove(id);
  }
}
