import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
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

// Item próprio na tela de cargos (decisão do PO, 14/10); a migração deu as
// quatro ações a quem tinha qualquer configuração de vendas, que era a regra
const CONTACT_SOURCES = 'sales_settings:contact_sources';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
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
  @HasPermission('create', CONTACT_SOURCES)
  create(@Req() req, @Body() dto: CreateContactSourceDto) {
    dto.companyId = req.user.companyId;
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Editar origem de contato' })
  @ApiResponse({ status: 200, description: 'Origem atualizada com sucesso' })
  @ApiParam({ name: 'id', description: 'ID da origem' })
  @Patch(':id')
  @HasPermission('edit', CONTACT_SOURCES)
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
  @HasPermission('delete', CONTACT_SOURCES)
  remove(@Req() req, @Param('id') id: string) {
    return this.service.remove(id, req.user.companyId);
  }

  @ApiOperation({ summary: 'Ocultar origem global para esta empresa' })
  @ApiResponse({ status: 201, description: 'Origem ocultada com sucesso' })
  @ApiParam({ name: 'id', description: 'ID da origem' })
  @Post(':id/hide')
  @HasPermission('edit', CONTACT_SOURCES)
  hide(@Req() req, @Param('id') id: string) {
    return this.service.hide(id, req.user.companyId);
  }

  @ApiOperation({ summary: 'Desocultar origem global para esta empresa' })
  @ApiResponse({ status: 200, description: 'Origem restaurada com sucesso' })
  @ApiParam({ name: 'id', description: 'ID da origem' })
  @Delete(':id/hide')
  @HasPermission('edit', CONTACT_SOURCES)
  unhide(@Req() req, @Param('id') id: string) {
    return this.service.unhide(id, req.user.companyId);
  }
}
