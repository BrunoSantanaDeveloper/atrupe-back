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
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientService } from './client.service';
import { CreateClientDto, PreRegisterClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ClientFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'client';

@ApiTags('Clientes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo cliente' })
  @ApiBody({
    description: 'Dados do novo cliente',
    type: CreateClientDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Cliente criado com sucesso.',
  })
  create(@Req() req, @Body() createClientDto: CreateClientDto) {
    createClientDto.companyId = req.user.companyId;
    if (createClientDto.companyId !== req.user.companyId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.clientService.create(createClientDto, req.user.userId);
  }

  @Post('import-csv')
  async importCsv(@Req() req) {
    const companyId = req.user.companyId;
    const filePath =
      '/home/tribodev/atrupe-back/src/helpers/payload/clients.csv';
    try {
      return await this.clientService.createClientsFromCsv(filePath, companyId);
    } catch (error) {
      console.error(error);
    }
  }

  @Post('import-csv-v2')
  @ApiOperation({ summary: 'Importa clientes do CSV versão 2' })
  @ApiResponse({
    status: 201,
    description: 'Clientes importados com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao processar o arquivo CSV.',
  })
  async importCsvV2(@Req() req) {
    const companyId = req.user.companyId;
    const filePath =
      '/home/tribodev/atrupe-back/src/helpers/payload/clients-v2.csv';
    try {
      return await this.clientService.createClientsFromCsvV2(
        filePath,
        companyId,
      );
    } catch (error) {
      console.error('Erro ao importar clientes do CSV v2:', error);
      throw error;
    }
  }

  @Post('pre-register')
  @ApiOperation({ summary: 'Pré-registro do cliente' })
  @ApiBody({
    description: 'Dados do novo cliente',
    type: PreRegisterClientDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Client pre-registered successfully.',
  })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  async preRegister(
    @Req() req,
    @Body() preRegisterClientDto: PreRegisterClientDto,
  ) {
    preRegisterClientDto.companyId = req.user.companyId;
    return this.clientService.preRegisterClient(preRegisterClientDto);
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os clientes em seus status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de caixas retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.clientService.findAllQuantity(companyId);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os clientes' })
  @ApiResponse({
    status: 200,
    description: 'Lista de clientes retornada com sucesso.',
    isArray: true,
  })
  findAll(@Req() req, @Query() filter: ClientFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.clientService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Cliente retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.clientService.findOne(id);
  }

  @Get(':id/contacts')
  @ApiOperation({ summary: 'Obtém os contatos/responsáveis de um cliente' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contatos do cliente retornada com sucesso.',
    isArray: true,
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  findClientContacts(@Param('id') id: string) {
    return this.clientService.findClientContacts(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiBody({
    description: 'Dados para atualização do cliente',
    type: UpdateClientDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Cliente atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @Req() req,
  ) {
    return this.clientService.update(id, updateClientDto, req.user.userId);
  }

  @Patch(':id/toggle-status')
  @ApiOperation({
    summary: 'Ativa ou desativa um cliente',
    description:
      'Se o cliente está INACTIVE, ativa para PROSPECT (só nome) ou ACTIVE (dados completos). Se está ACTIVE/PROSPECT, desativa para INACTIVE.',
  })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Status do cliente alterado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  toggleStatus(@Param('id') id: string, @Req() req) {
    return this.clientService.toggleClientStatus(id, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um cliente pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do cliente' })
  @ApiResponse({
    status: 200,
    description: 'Cliente removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.clientService.remove(id);
  }
}
