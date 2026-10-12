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
@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
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
