import {
  All,
  Controller,
  Logger,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { sendAnswer } from './atendimento.controller';
import {
  AtendimentoService,
  atendimentoConfigurado,
} from './atendimento.service';

const BASE = '/atendimento/robo';

/**
 * As rotas que o robô de atendimento chama (config, tools/<nome>, history,
 * events, suggestions). Sem sessão: a autenticação é a assinatura HMAC com
 * SUPPORT_BOT_SECRET sobre método, caminho com a query e o corpo cru — por
 * isso o `rawBody` ligado no `main.ts` e o caminho lido de `originalUrl`, como
 * chegou. O `PROJECT_URL` do robô é `https://api.atrupe.com.br/atendimento/robo`.
 */
@ApiExcludeController()
@Controller('atendimento/robo')
export class AtendimentoRoboController {
  private readonly logger = new Logger(AtendimentoRoboController.name);

  constructor(private readonly atendimento: AtendimentoService) {}

  @All('*')
  async handle(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    if (!atendimentoConfigurado()) {
      res.status(404).json({ ok: false, code: 'not_found' });
      return;
    }
    const pathWithQuery = req.originalUrl;
    const path = pathWithQuery.split('?')[0];
    const start = path.indexOf(BASE);
    const route = start >= 0 ? path.slice(start + BASE.length) : '';
    await sendAnswer(res, this.logger, () =>
      this.atendimento.botHandler({
        method: req.method,
        pathWithQuery,
        route: route.replace(/^\/+/, ''),
        query: req.query as Record<string, string>,
        rawBody:
          req.method === 'GET' ? '' : (req.rawBody?.toString('utf8') ?? ''),
        headers: req.headers,
      }),
    );
  }
}
