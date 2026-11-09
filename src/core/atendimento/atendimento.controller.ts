import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import {
  Answer,
  AtendimentoNaoConfigurado,
  AtendimentoService,
} from './atendimento.service';

import type { Scope } from '../../../atendimento/base/shared/settings.mjs';

const scopeOf = (escopo?: string): Scope =>
  escopo === 'cliente' ? 'cliente' : 'plataforma';

/**
 * Responde no formato que as telas do kit esperam ({ code, message }), sem
 * passar pelo filtro global. Erro de configuração vira 503; falha do Chatwoot
 * ou do OpenWA, 502 com a correção que a base devolve.
 */
export async function sendAnswer(
  res: Response,
  logger: Logger,
  work: () => Promise<Answer>,
) {
  try {
    const answer = await work();
    res
      .status(answer.status)
      .set('cache-control', 'no-store')
      .json(answer.body);
  } catch (error) {
    if (error instanceof AtendimentoNaoConfigurado) {
      logger.warn(error.message);
      res.status(503).json({
        code: error.code,
        message: 'O atendimento ainda não está configurado neste ambiente.',
      });
      return;
    }
    const failure = error as { code?: string; fix?: string; message?: string };
    logger.warn(
      `Atendimento: ${failure.code ?? 'error'} — ${failure.message ?? ''}`,
    );
    res.status(502).json({
      code: failure.code ?? 'error',
      message:
        failure.fix ??
        'Não deu para falar com o atendimento agora. Tente de novo em instantes.',
    });
  }
}

/**
 * As telas do atendimento no WhatsApp (Super Admin › Atendimento): o contexto
 * do robô, as sugestões de conhecimento, o relatório das lacunas, a conexão do
 * número e a entrada no painel. Tudo só do superadmin, conferido de novo no
 * banco a cada chamada.
 */
@ApiTags('Atendimento (WhatsApp)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('atendimento')
export class AtendimentoController {
  private readonly logger = new Logger(AtendimentoController.name);

  constructor(private readonly atendimento: AtendimentoService) {}

  private person(req: { user?: { userId?: string } }) {
    return this.atendimento.person(req.user?.userId ?? '');
  }

  @Post('entrar')
  @ApiOperation({
    summary:
      'Link de entrada no painel do Chatwoot, já logado (5 min, uso único)',
  })
  async enter(@Req() req, @Res() res: Response) {
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.enterPanel(await this.person(req)),
    );
  }

  @Get('config')
  @ApiOperation({ summary: 'O contexto do robô (camada da plataforma)' })
  async readConfig(
    @Req() req,
    @Query('escopo') escopo: string,
    @Res() res: Response,
  ) {
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.readSettings(await this.person(req), scopeOf(escopo)),
    );
  }

  @Put('config')
  @ApiOperation({ summary: 'Grava o contexto do robô (camada da plataforma)' })
  async writeConfig(
    @Req() req,
    @Query('escopo') escopo: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.writeSettings(
        await this.person(req),
        scopeOf(escopo),
        body,
      ),
    );
  }

  @Post('config/importar-base')
  @ApiOperation({
    summary:
      'Aplica uma versão da base de suporte (Markdown) sobre o contexto do robô, sem gravar',
  })
  async importBase(
    @Req() req,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.importBase(await this.person(req), body?.markdown),
    );
  }

  @Get('sugestoes')
  @ApiOperation({ summary: 'Sugestões de conhecimento esperando aprovação' })
  async suggestions(
    @Req() req,
    @Query('escopo') escopo: string,
    @Res() res: Response,
  ) {
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.listSuggestions(await this.person(req), scopeOf(escopo)),
    );
  }

  @Post('sugestoes/:id')
  @ApiOperation({ summary: 'Aprova (com edições) ou descarta uma sugestão' })
  async decide(
    @Req() req,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.decideSuggestion(await this.person(req), id, {
        decisao: body?.decisao as string | undefined,
        q: body?.q as string | undefined,
        a: body?.a as string | undefined,
      }),
    );
  }

  @Get('lacunas')
  @ApiOperation({ summary: 'O que o robô passou para a equipe, por assunto' })
  async gaps(
    @Req() req,
    @Query('escopo') escopo: string,
    @Query('dias') dias: string,
    @Res() res: Response,
  ) {
    const days = Math.min(Math.max(Number(dias) || 30, 1), 365);
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.gaps(await this.person(req), scopeOf(escopo), days),
    );
  }

  @Get('whatsapp')
  @ApiOperation({ summary: 'Estado do número (e o QR, na rota não oficial)' })
  async whatsapp(@Req() req, @Res() res: Response) {
    await sendAnswer(res, this.logger, async () =>
      this.atendimento.whatsapp(await this.person(req)),
    );
  }

  @Post('whatsapp')
  @ApiOperation({
    summary:
      'Conecta o número (API oficial ou OpenWA) ou, com acao "reconectar", retoma a sessão que a caixa já tem',
  })
  async connect(
    @Req() req,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    await sendAnswer(res, this.logger, async () => {
      const person = await this.person(req);
      return body?.acao === 'reconectar'
        ? this.atendimento.reconnectWhatsapp(person)
        : this.atendimento.connectWhatsapp(person, body);
    });
  }
}
