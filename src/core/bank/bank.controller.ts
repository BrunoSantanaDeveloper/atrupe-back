import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  BadGatewayException,
} from '@nestjs/common';
import { BankService } from './bank.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankAccountDto, UpdateBankDto } from './dto/update-bank.dto';
import { CreateBankAccountDto } from './dto/create-account.dto';
import { AccountService } from './account.service';
import { BankAccountFilterDTO } from './dto/filter-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'bank';

@ApiTags('Banco e Conta bancária')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class BankController {
  constructor(
    private readonly bankService: BankService,
    private readonly accountService: AccountService,
  ) {}

  //---------------------------------------------------------------------------------
  // Bank
  //---------------------------------------------------------------------------------

  @Post()
  @ApiOperation({ summary: 'Cria um novo banco' })
  @ApiBody({
    description: 'Dados do novo banco',
    type: CreateBankDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Banco criado com sucesso.',
  })
  create(@Body() createBankDto: CreateBankDto, @Req() req) {
    console.log(req.user.companyId);
    // ID do usuário logado
    return this.bankService.create(createBankDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os bancos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de bancos retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.bankService.findAll();
  }

  //---------------------------------------------------------------------------------
  // Account
  //---------------------------------------------------------------------------------

  @Post('account')
  @ApiOperation({ summary: 'Cria uma nova conta bancária' })
  @ApiBody({
    description: 'Dados da nova conta bancária',
    type: CreateBankAccountDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Conta bancária criada com sucesso.',
  })
  createAccount(@Req() req, @Body() dto: CreateBankAccountDto) {
    if (req.user.companyId === null) {
      throw new BadGatewayException('Usuário não possui empresa vinculada');
    }
    dto.companyId = req.user.companyId;
    return this.accountService.create(dto);
  }

  @Get('account')
  @ApiOperation({ summary: 'Obtém a lista de todas as contas bancárias' })
  @ApiResponse({
    status: 200,
    description: 'Lista de contas bancárias retornada com sucesso.',
    isArray: true,
  })
  async listAccounts(@Req() req, @Query() filter: BankAccountFilterDTO) {
    filter.companyId = req.user.companyId;
    return await this.accountService.findAll(filter);
  }

  @Patch('account/:accountId')
  @ApiOperation({ summary: 'Atualiza uma conta bancária pelo ID' })
  @ApiParam({
    name: 'accountId',
    required: true,
    description: 'ID da conta bancária',
  })
  @ApiBody({
    description: 'Dados para atualização da conta bancária',
    type: CreateBankAccountDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Conta bancária atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta bancária não encontrada.',
  })
  async updateAccount(
    @Param('accountId') accountId: string,
    @Body() updateBankAccountDto: UpdateBankAccountDto,
  ) {
    return await this.accountService.update(accountId, updateBankAccountDto);
  }

  @Delete('account/:accountId')
  @ApiOperation({ summary: 'Remove uma conta bancária pelo ID' })
  @ApiParam({
    name: 'accountId',
    required: true,
    description: 'ID da conta bancária',
  })
  @ApiResponse({
    status: 200,
    description: 'Conta bancária removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Conta bancária não encontrada.',
  })
  async removeAccount(@Param('accountId') accountId: string) {
    return await this.accountService.remove(accountId);
  }

  //---------------------------------------------------------------------------------
  // Wildcard
  //---------------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'Obtém um banco pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do banco' })
  @ApiResponse({
    status: 200,
    description: 'Banco retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Banco não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.bankService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um banco pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do banco' })
  @ApiBody({
    description: 'Dados para atualização do banco',
    type: CreateBankDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Banco atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Banco não encontrado.',
  })
  update(@Param('id') id: string, @Body() updateBankDto: UpdateBankDto) {
    return this.bankService.update(id, updateBankDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um banco pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do banco' })
  @ApiResponse({
    status: 200,
    description: 'Banco removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Banco não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.bankService.remove(id);
  }
}
