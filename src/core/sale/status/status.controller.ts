import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
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

  @Get()
  @ApiOperation({ summary: 'Listar todos os status de orçamento' })
  @ApiResponse({ status: 200, description: 'Lista de status de orçamento.' })
  findAll(@Req() req): Promise<StatusQuotation[]> {
    const companyId = req.user.companyId;
    return this.statusQuotationService.findAll(companyId);
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

  @Put(':id')
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
