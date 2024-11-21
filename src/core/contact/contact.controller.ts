import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
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
  create(@Body() createContactDto: CreateContactDto) {
    return this.contactService.create(createContactDto);
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
  bulk(@Body() createContactDto: CreateContactDto[]) {
    return this.contactService.bulk(createContactDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os contatos' })
  @ApiQuery({ name: 'filter', type: ContactFilterDTO, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de contatos retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: ContactFilterDTO) {
    return this.contactService.findAll(filter);
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
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id);
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
  update(@Param('id') id: string, @Body() updateContactDto: UpdateContactDto) {
    return this.contactService.update(id, updateContactDto);
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
  remove(@Param('id') id: string) {
    return this.contactService.remove(id);
  }
}
