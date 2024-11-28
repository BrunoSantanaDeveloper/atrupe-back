import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { StatusQuotation } from '@prisma/client';
import { CreateStatusQuotationDto } from './dto/create-status.dto';
import { StatusService } from './status.service';
import { UpdateStatusQuotationDto } from './dto/update-status.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';

@ApiTags('Status de Orçamento')
@Controller('sale/status')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class StatusController {
  constructor(private readonly statusQuotationService: StatusService) {}

  @Post()
  @ApiOperation({ summary: 'Criar um novo status de orçamento' })
  @ApiResponse({
    status: 201,
    description: 'Status de orçamento criado com sucesso.',
  })
  create(
    @Body() createStatusQuotationDto: CreateStatusQuotationDto,
    @Req() req,
  ): Promise<StatusQuotation> {
    createStatusQuotationDto.companyId = req.user.companyId;
    return this.statusQuotationService.create(createStatusQuotationDto);
  }

  @ApiOperation({ summary: 'Listar todos os status de orçamento' })
  @ApiResponse({ status: 200, description: 'Lista de status de orçamento.' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Número da página',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 10,
    description: 'Número de itens por página',
  })
  @Get()
  async findAll(
    @Req() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ): Promise<any> {
    const companyId = req.user.companyId;
    return await this.statusQuotationService.findAll(companyId, +page, +limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar um status de orçamento específico' })
  @ApiResponse({ status: 200, description: 'Status de orçamento encontrado.' })
  @ApiResponse({
    status: 404,
    description: 'Status de orçamento não encontrado.',
  })
  findOne(@Param('id') id: string): Promise<StatusQuotation> {
    return this.statusQuotationService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um status de orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Status de orçamento atualizado com sucesso.',
  })
  update(
    @Param('id') id: string,
    @Body() updateStatusQuotationDto: UpdateStatusQuotationDto,
  ): Promise<StatusQuotation> {
    return this.statusQuotationService.update(id, updateStatusQuotationDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover um status de orçamento' })
  @ApiResponse({
    status: 200,
    description: 'Status de orçamento removido com sucesso.',
  })
  remove(@Param('id') id: string): Promise<StatusQuotation> {
    return this.statusQuotationService.remove(id);
  }
}
