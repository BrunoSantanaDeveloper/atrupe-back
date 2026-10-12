import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
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
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ContactFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

const RESOURCE = 'contact';

@ApiTags('Contatos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(RESOURCE)
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @HasAnyPermission(
    { action: 'create', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:order' },
    { action: 'edit', resource: 'register:client' },
  )
  @ApiOperation({ summary: 'Cria um novo contato' })
  @ApiBody({
    description: 'Dados do novo contato',
    type: CreateContactDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Contato criado com sucesso.',
  })
  create(@Req() req, @Body() createContactDto: CreateContactDto) {
    return this.contactService.create(createContactDto, req.user.companyId);
  }

  @Post('bulk')
  @HasPermission('create', 'register:client')
  @ApiOperation({ summary: 'Cria múltiplos contatos' })
  @ApiBody({
    description: 'Dados dos novos contatos',
    type: [CreateContactDto],
  })
  @ApiResponse({
    status: 201,
    description: 'Contatos criados com sucesso.',
  })
  bulk(@Req() req, @Body() createContactDto: CreateContactDto[]) {
    return this.contactService.bulk(createContactDto, req.user.companyId);
  }

  @Get()
  @HasPermission('view', 'register:client')
  @ApiOperation({ summary: 'Obtém a lista de todos os contatos' })
  @ApiQuery({ name: 'filter', type: ContactFilterDTO, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de contatos retornada com sucesso.',
    isArray: true,
  })
  findAll(@Req() req, @Query() filter: ContactFilterDTO) {
    return this.contactService.findAll(filter, req.user.companyId);
  }

  @Get(':id')
  @HasPermission('view', 'register:client')
  @ApiOperation({ summary: 'Obtém um contato pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do contato' })
  @ApiResponse({
    status: 200,
    description: 'Contato retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Contato não encontrado.',
  })
  findOne(@Req() req, @Param('id') id: string) {
    return this.contactService.findOne(id, req.user.companyId);
  }

  @Patch(':id')
  @HasPermission('edit', 'register:client')
  @ApiOperation({ summary: 'Atualiza um contato pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do contato' })
  @ApiBody({
    description: 'Dados para atualização do contato',
    type: CreateContactDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Contato atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Contato não encontrado.',
  })
  update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateContactDto: UpdateContactDto,
  ) {
    return this.contactService.update(id, updateContactDto, req.user.companyId);
  }

  @Delete(':id')
  @HasAnyPermission(
    { action: 'edit', resource: 'register:client' },
    { action: 'delete', resource: 'register:client' },
  )
  @ApiOperation({ summary: 'Remove um contato pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do contato' })
  @ApiResponse({
    status: 200,
    description: 'Contato removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Contato não encontrado.',
  })
  remove(@Req() req, @Param('id') id: string) {
    return this.contactService.remove(id, req.user.companyId);
  }
}
