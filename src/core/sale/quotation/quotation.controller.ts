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
  NotFoundException,
  Req,
} from '@nestjs/common';
import { QuotationService } from './quotation.service';
import { AddItemDto, CreateQuotationDto } from './dto/create-quotation.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { FilterQuotationDto } from './dto/filter.dto';
import { isUUID } from 'class-validator';
import { DuplicateQuotationDto } from './dto/duplicate-quotation.dto';
import { UpdateItemDto, UpdateQuotationDto } from './dto/update-quotation.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { QuotationProduct } from '@prisma/client';
import { CancelOrderDto } from '../order/dto/create-order.dto';

const RESOURCE = 'quotation';

@ApiTags('Orçamentos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class QuotationController {
  constructor(private readonly quotationService: QuotationService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo orçamento' })
  @ApiResponse({
    status: 201,
    description: 'Orçamento criado com sucesso.',
  })
  create(@Body() createQuotationDto: CreateQuotationDto) {
    return this.quotationService.create(createQuotationDto);
  }
  @Post(':id/add-product')
  @ApiOperation({ summary: 'Adiciona um produto a um orçamento' })
  @ApiParam({ name: 'id', description: 'ID do orçamento' })
  async addProductToQuotation(
    @Param('id') id: string,
    @Body() addItemDto: AddItemDto,
  ) {
    return this.quotationService.addProductToQuotation(id, addItemDto);
  }

  @Patch('update-product/:productId')
  @ApiOperation({
    summary: 'Atualiza um produto dentro de um orçamento',
    description:
      'Atualiza os detalhes de um produto e seus itens dentro de um orçamento.',
  })
  @ApiResponse({
    status: 200,
    description: 'Produto atualizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro na validação dos dados.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento ou produto não encontrados.',
  })
  async updateProduct(
    @Param('productId') productId: string,
    @Body() updateQuotationProductDto: UpdateItemDto,
  ): Promise<QuotationProduct> {
    const updatedProduct = await this.quotationService.updateProductInQuotation(
      productId,
      updateQuotationProductDto,
    );
    if (!updatedProduct) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    return updatedProduct;
  }

  @Post('duplicate-product/:productId')
  @ApiOperation({
    summary: 'Duplica um produto dentro de um orçamento',
    description:
      'Duplica os detalhes de um produto e seus itens dentro de um orçamento.',
  })
  @ApiResponse({
    status: 200,
    description: 'Produto atualizado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro na validação dos dados.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento ou produto não encontrados.',
  })
  async duplicateProduct(
    @Param('productId') productId: string,
  ): Promise<QuotationProduct> {
    const updatedProduct =
      await this.quotationService.duplicateProductInQuotation(productId);
    if (!updatedProduct) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
    return updatedProduct;
  }

  @Delete('remove-product/:productId')
  @ApiOperation({
    summary: 'Remove um produto de um orçamento',
    description: 'Remove um produto do orçamento especificado.',
  })
  @ApiResponse({
    status: 200,
    description: 'Produto removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento ou produto não encontrados.',
  })
  async deleteProduct(@Param('productId') productId: string): Promise<void> {
    const isDeleted =
      await this.quotationService.removeProductFromQuotation(productId);
    if (!isDeleted) {
      throw new NotFoundException('Produto ou orçamento não encontrados.');
    }
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os orçamentos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de orçamentos retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() query: FilterQuotationDto) {
    query.companyId = req.user.companyId;
    return await this.quotationService.findAll(query);
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os status de orçamentos',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de orçamentos retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.quotationService.findAllQuantity(companyId);
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
  async reject(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return this.quotationService.reject(id, dto);
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
    return await this.quotationService.finish(id);
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
  async findOne(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return await this.quotationService.findOne(id);
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
  async update(
    @Param('id') id: string,
    @Body() updateQuotationDto: UpdateQuotationDto,
  ) {
    return await this.quotationService.update(id, updateQuotationDto);
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
