import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { ContactSourceService } from './contact-source.service';
import { CreateContactSourceDto } from './dto/create-contact-source.dto';
import { UpdateContactSourceDto } from './dto/update-contact-source.dto';

@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('contact-source')
@ApiTags('Configurações de origem de contato')
export class ContactSourceController {
  constructor(private readonly service: ContactSourceService) {}

  @ApiOperation({ summary: 'Listar origens de contato' })
  @ApiResponse({ status: 200, description: 'Origens listadas com sucesso' })
  @Get()
  findAll(@Req() req) {
    return this.service.findAll(req.user.companyId);
  }

  @ApiOperation({ summary: 'Criar origem de contato' })
  @ApiResponse({ status: 201, description: 'Origem criada com sucesso' })
  @Post()
  create(@Req() req, @Body() dto: CreateContactSourceDto) {
    dto.companyId = req.user.companyId;
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Editar origem de contato' })
  @ApiResponse({ status: 200, description: 'Origem atualizada com sucesso' })
  @ApiParam({ name: 'id', description: 'ID da origem' })
  @Patch(':id')
  update(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateContactSourceDto,
  ) {
    return this.service.update(id, req.user.companyId, dto);
  }

  @ApiOperation({ summary: 'Remover origem de contato' })
  @ApiResponse({ status: 200, description: 'Origem removida com sucesso' })
  @ApiParam({ name: 'id', description: 'ID da origem' })
  @Delete(':id')
  remove(@Req() req, @Param('id') id: string) {
    return this.service.remove(id, req.user.companyId);
  }

  @ApiOperation({ summary: 'Ocultar origem global para esta empresa' })
  @ApiResponse({ status: 201, description: 'Origem ocultada com sucesso' })
  @ApiParam({ name: 'id', description: 'ID da origem' })
  @Post(':id/hide')
  hide(@Req() req, @Param('id') id: string) {
    return this.service.hide(id, req.user.companyId);
  }

  @ApiOperation({ summary: 'Desocultar origem global para esta empresa' })
  @ApiResponse({ status: 200, description: 'Origem restaurada com sucesso' })
  @ApiParam({ name: 'id', description: 'ID da origem' })
  @Delete(':id/hide')
  unhide(@Req() req, @Param('id') id: string) {
    return this.service.unhide(id, req.user.companyId);
  }
}
