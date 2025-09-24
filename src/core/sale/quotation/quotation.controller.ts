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
  @Get('test')
  async test() {
    return await this.quotationService.test();
  }

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
  @Delete('delete-imported')
  @ApiOperation({
    summary: 'Deleta todos os orçamentos importados para uma empresa',
  })
  @ApiResponse({
    status: 200,
    description: 'Orçamentos deletados com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao deletar os orçamentos.',
  })
  async deleteImportedQuotations(@Req() req) {
    const companyId = req.user.companyId;
    try {
      console.log(companyId);
      return await this.quotationService.deleteImportedQuotations(companyId);
    } catch (error) {
      console.error('Erro ao deletar orçamentos importados:', error);
      throw error;
    }
  }

  @Delete('asasss/:id')
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

  @Get(':id/pdf-data')
  @ApiOperation({ summary: 'Obtém os dados do orçamento para geração de PDF' })
  @ApiParam({ name: 'id', required: true, description: 'ID do orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Dados do orçamento para PDF retornados com sucesso.',
    content: {
      'application/json': {
        example: {
          company: {
            name: 'Empresa Exemplo Ltda',
            cnpj: '12.345.678/0001-90',
            email: 'contato@empresa.com',
            siteUrl: 'https://www.empresa.com',
            address: {
              street: 'Rua Exemplo',
              number: '123',
              complement: 'Sala 45',
              neighborhood: 'Centro',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '01234-567',
            },
            socialNetworks: {
              instagram: 'minhaempresa',
              facebook: 'minhaempresa',
              linkedin: 'minhaempresa',
            },
            logo: 'https://example.com/logo.png',
            textBeforeItems: 'Texto antes dos itens',
            textAfterItems: 'Texto depois dos itens',
          },
          client: {
            name: 'Cliente Exemplo',
            document: {
              type: 'CNPJ',
              value: '98.765.432/0001-10',
            },
            phone: '(11) 98765-4321',
            email: 'cliente@exemplo.com',
            notes: 'Observações gerais do cliente',
            financialNotes: 'Observações financeiras do cliente',
            address: {
              type: 'PRINCIPAL',
              street: 'Rua do Cliente',
              number: '456',
              complement: 'Apto 78',
              neighborhood: 'Jardim',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '04567-890',
            },
          },
          contact: {
            name: 'João Silva',
            phone: '(11) 91234-5678',
            email: 'joao.silva@exemplo.com',
            notes: 'Observações do contato',
          },
          quotation: {
            number: 12345,
            seriesCode: 'SERIE-001',
            description: 'Orçamento para projeto exemplo',
            seller: {
              name: 'Vendedor Exemplo',
              signature: 'https://example.com/signature.png',
            },
            createdAt: '2023-01-15T10:30:00Z',
            dueDate: '2023-02-15T10:30:00Z',
            approvedAt: '2023-01-20T14:45:00Z',
            finishedAt: '2023-02-10T09:15:00Z',
            status: 'DONE',
          },
          order: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            createdAt: '2023-01-20T14:45:00Z',
            status: 'IN_PRODUCTION',
            approvedAt: '2023-01-20T14:45:00Z',
          },
          items: [
            {
              id: '550e8400-e29b-41d4-a716-446655440001',
              image: 'https://example.com/product1.jpg',
              description: 'Produto Exemplo 1',
              composition: [
                {
                  id: '550e8400-e29b-41d4-a716-446655440002',
                  name: 'Componente 1',
                  quantity: 2,
                  unitPrice: 15000,
                  totalPrice: 30000,
                },
                {
                  id: '550e8400-e29b-41d4-a716-446655440003',
                  name: 'Componente 2',
                  quantity: 1,
                  unitPrice: 5000,
                  totalPrice: 5000,
                },
              ],
              totalQuantity: 1,
              totalUnitPrice: 35000,
              discount: {
                type: 'PERCENT',
                value: 10,
                discountedValue: 3500,
              },
              finalPrice: 31500,
            },
          ],
          delivery: {
            supplier: {
              name: 'Transportadora Exemplo',
              cnpj: '11.222.333/0001-44',
              notes: 'Observações da transportadora',
              financialNotes: 'Observações financeiras da transportadora',
            },
            daysAfterApproval: 15,
            freightCost: 2500,
            freightPrice: 3000,
            notes: 'Observações sobre a entrega',
            clientAddress: {
              type: 'PRINCIPAL',
              street: 'Rua do Cliente',
              number: '456',
              complement: 'Apto 78',
              neighborhood: 'Jardim',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '04567-890',
            },
          },
          payment: {
            condition: 'A Vista',
            method: 'PIX',
            description: 'Descrição das condições de pagamento',
            totalInstallments: 1,
            installments: [
              {
                number: '550e8400-e29b-41d4-a716-446655440004',
                dueDate: '2023-01-20T14:45:00Z',
                value: 31500,
                paymentMethod: 'PIX',
              },
            ],
          },
          total: {
            subtotal: 35000,
            totalDiscount: 3500,
            finalTotal: 31500,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  @ApiResponse({
    status: 404,
    description: 'Orçamento não encontrado.',
  })
  async getQuotationPdfData(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }
    return await this.quotationService.getQuotationPdfData(id);
  }

  @Post('import-csv')
  @ApiOperation({ summary: 'Importa orçamentos do CSV' })
  @ApiResponse({
    status: 201,
    description: 'Orçamentos importados com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao processar o arquivo CSV.',
  })
  async importCsv(@Req() req) {
    const companyId = req.user.companyId;
    const filePath =
      '/home/tribodev/atrupe-back/src/helpers/payload/join vendas com itens.csv';
    try {
      return await this.quotationService.importQuotationsFromCsv(
        filePath,
        companyId,
      );
    } catch (error) {
      console.error('Erro ao importar orçamentos do CSV:', error);
      throw error;
    }
  }
}
