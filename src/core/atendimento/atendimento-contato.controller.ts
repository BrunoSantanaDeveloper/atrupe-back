import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  AtendimentoService,
  atendimentoConfigurado,
} from './atendimento.service';

/**
 * O número do suporte que o sistema mostra aos clientes: o botão do WhatsApp,
 * o "?" do topo e as páginas de conta suspensa e de senha. Sem sessão, porque
 * a página de senha é de quem não entrou, e sem a trava de inadimplência,
 * porque a conta suspensa é quem mais precisa falar com o suporte. O número é
 * o que o superadmin escolhe em Super Admin › Atendimento › WhatsApp.
 */
@ApiTags('Atendimento (WhatsApp)')
@Controller('atendimento/contato')
export class AtendimentoContatoController {
  constructor(private readonly atendimento: AtendimentoService) {}

  @Get()
  @ApiOperation({
    summary: 'Número do WhatsApp do suporte para os clientes (só dígitos)',
  })
  async contact(@Res() res: Response) {
    const body = atendimentoConfigurado()
      ? await this.atendimento.customerContact()
      : { whatsapp: null };
    res.set('cache-control', 'public, max-age=60').json(body);
  }
}
