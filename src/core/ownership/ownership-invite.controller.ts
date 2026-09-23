import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AcceptOwnershipTransferDto,
  InviteCompanyDto,
  InviteRepresentativeCheckDto,
  InviteTokenDto,
} from './dto/ownership.dto';
import { InviteThrottlerGuard } from './invite-throttler.guard';
import {
  OwnershipAcceptanceService,
  RequestMeta,
} from './ownership-acceptance.service';

/**
 * O convite de transferência, do lado de quem recebe. Público: quem recebe
 * ainda não tem conta — é aqui que ela é criada. Tudo passa pelo token do
 * convite, que viaja no corpo e nunca no endereço.
 */
@ApiTags('Titularidade - convite')
@UseGuards(InviteThrottlerGuard)
@Controller('ownership/invite')
export class OwnershipInviteController {
  constructor(private readonly acceptance: OwnershipAcceptanceService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'O estado do convite e, se pendente, de que ambiente ele é',
  })
  async open(@Body() dto: InviteTokenDto) {
    return this.acceptance.open(dto.token);
  }

  @Post('company')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dados da empresa de quem aceita, pela consulta do CNPJ',
    description:
      'Nunca devolve o quadro societário. Diz se o CNPJ já tem ambiente na Atrupe.',
  })
  async company(@Body() dto: InviteCompanyDto) {
    return this.acceptance.company(dto.token, dto.cnpj);
  }

  @Post('representative-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confere o CPF do representante legal contra o quadro societário',
  })
  async representativeCheck(@Body() dto: InviteRepresentativeCheckDto) {
    return this.acceptance.representativeCheck(dto.token, dto.cnpj, dto.cpf);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Aceitar: cria a conta nova e efetiva a transferência de titularidade',
  })
  async accept(@Body() dto: AcceptOwnershipTransferDto, @Req() req) {
    return this.acceptance.accept(dto, metaOf(req));
  }
}

/** O IP de quem aceitou: o servidor do frontend repassa o do navegador. */
function metaOf(req): RequestMeta {
  const forwarded = req.headers?.['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : undefined;
  return {
    ip:
      req.headers?.['x-user-ip'] ||
      req.headers?.['x-real-ip'] ||
      forwardedIp ||
      req.ip ||
      null,
    userAgent:
      req.headers?.['x-user-agent'] || req.headers?.['user-agent'] || null,
  };
}
