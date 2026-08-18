import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfeStatus, NfeCorrectionStatus } from '@prisma/client';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { NfeService } from './nfe.service';
import {
  INVOICY_ERROR_CODES,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import { CancelNfeDto, CorrectionLetterDto } from './dtos/nfe.dto';

/** Autor do evento fiscal, propagado do token para a trilha de auditoria. */
export interface FiscalEventAuthor {
  userId?: string;
  name?: string;
}

/** Códigos de situação da SEFAZ aceitos para o evento 110110. */
const CCE_REGISTERED = 135; // evento registrado e vinculado à NF-e
const CCE_REGISTERED_UNLINKED = 136; // evento registrado, ainda não vinculado

/** Limite legal de cartas de correção por NF-e (NT 2011/003). */
const CCE_MAX_SEQUENCE = 20;

/** Prazo legal da CC-e: 720 horas (30 dias) contadas da autorização. */
const CCE_DEADLINE_HOURS = 720;

/**
 * Uma reserva PENDING mais nova que isso é considerada "em voo" e bloqueia um
 * novo envio. Mais velha que isso, presume-se processo interrompido: a sequência
 * fica queimada (pode ter sido registrada na SEFAZ) e seguimos para a próxima.
 */
const CCE_PENDING_IN_FLIGHT_MS = 5 * 60 * 1000;

/**
 * NfeEventsService - Eventos pós-emissão de NF-e
 *
 * Este service é responsável por eventos fiscais após a emissão:
 * - Cancelamento de NF-e
 * - Carta de Correção Eletrônica (CC-e)
 * - Consulta de status
 *
 * Separação de responsabilidades:
 * - NfeService: Orquestração e emissão
 * - NfeEventsService: Eventos pós-emissão
 * - NfeDraftService: Gestão de rascunhos
 * - NfeBuilderService: Construção de payloads
 */
@Injectable()
export class NfeEventsService {
  private readonly logger = new Logger(NfeEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyApiService: InvoicyApiService,
    private readonly nfeService: NfeService,
  ) {}

  /**
   * Cancela uma NF-e autorizada
   */
  async cancel(nfe: any, companyId: string, dto: CancelNfeDto): Promise<any> {
    if (
      nfe.status !== NfeStatus.AUTHORIZED &&
      nfe.status !== NfeStatus.CORRECTION_SENT
    ) {
      throw new BadRequestException(
        'Apenas NF-e autorizadas ou com carta de correção podem ser canceladas',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    // Verificar se está dentro do prazo (24h)
    const horasDaEmissao =
      (Date.now() - new Date(nfe.dataEmissao).getTime()) / (1000 * 60 * 60);
    if (horasDaEmissao > 24) {
      throw new BadRequestException(
        'O prazo para cancelamento de 24 horas foi excedido',
      );
    }

    try {
      this.logger.log(
        `Cancelando NF-e ${nfe.numero} para empresa ${companyId}`,
      );

      const ambienteEvento = this.resolveDocumentEnvironment(nfe);

      // Chamar API do Invoicy para cancelamento
      const invoicyResponses = await this.invoicyApiService.cancelNfe(
        companyId,
        nfe.chaveAcesso,
        dto.justificativa,
        ambienteEvento,
        {
          numero: nfe.numero,
          serie: nfe.serie,
          invoicyConfigId: nfe.invoicyConfigId ?? undefined,
        },
      );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      // O log da resposta bruta precisa vir ANTES do throw: no caminho de
      // rejeição — justamente o que se precisa diagnosticar — ele nunca rodava.
      this.logger.log(
        `Resposta bruta Invoicy cancelamento NF-e ${nfe.numero} (ambiente ${ambienteEvento}): ` +
          this.stringifyProviderResponse(response),
      );

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          this.getCancelRejectionMessage(response, ambienteEvento),
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isCancelled =
        situacao?.SitCodigo === 135 || situacao?.SitCodigo === 101;

      if (!isCancelled) {
        const mensagemSefaz =
          doc?.MensagemSefaz?.DscMsg ||
          situacao?.SitDescricao ||
          'Cancelamento não autorizado pela SEFAZ';
        throw new Error(mensagemSefaz);
      }

      const updatedNfe = await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          status: NfeStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
          protocoloCancelamento: doc?.DocProtocolo || null,
        },
      });

      // A DANFE guardada ainda e a da nota valida — e e ela que getDanfeUrl
      // serve. Sem rebuscar, o usuario baixa o PDF sem a marca dagua de
      // CANCELADA e nao tem como perceber pelo proprio documento que a nota
      // caiu. refreshDanfeFromProvider nao lanca: o cancelamento ja esta
      // registrado na SEFAZ neste ponto e nao pode virar erro por causa do PDF.
      await this.nfeService.refreshDanfeFromProvider(
        {
          id: nfe.id,
          chaveAcesso: nfe.chaveAcesso,
          invoicyConfigId: nfe.invoicyConfigId,
        },
        companyId,
      );

      return updatedNfe;
    } catch (error) {
      this.logger.error(`Erro ao cancelar NF-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao cancelar NF-e: ${error.message}`);
    }
  }

  /**
   * Envia carta de correção eletrônica (CC-e / evento 110110)
   *
   * O envio é dividido em três etapas para que a chamada HTTP à SEFAZ NUNCA
   * aconteça dentro de uma transação de banco:
   *
   *   1. Pré-condições — nada é gravado, nenhuma sequência é consumida.
   *   2. Transação curta que trava a NF-e e reserva a sequência em PENDING.
   *   3. POST ao provedor FORA da transação.
   *   4. Transação curta que confirma (REGISTERED) ou marca a rejeição (REJECTED).
   *
   * Antes disso, um estouro do timeout da transação com o evento já registrado
   * na SEFAZ revertia a gravação: o sistema ficava sem o XML de um evento que
   * existe no fisco e reenviava a mesma sequência indefinidamente (cStat 573).
   */
  async sendCorrectionLetter(
    nfe: any,
    companyId: string,
    dto: CorrectionLetterDto,
    author: FiscalEventAuthor = {},
  ): Promise<any> {
    // ---- 1. Pré-condições -------------------------------------------------
    if (
      nfe.status !== NfeStatus.AUTHORIZED &&
      nfe.status !== NfeStatus.CORRECTION_SENT
    ) {
      throw new BadRequestException(
        'Cartas de correção só podem ser enviadas para NF-e autorizadas ou com correção anterior',
      );
    }

    const correcao = this.sanitizeCorrectionText(dto.correcao);

    if (correcao.length < 15) {
      throw new BadRequestException(
        'O texto da correção deve ter no mínimo 15 caracteres',
      );
    }

    if (correcao.length > 1000) {
      throw new BadRequestException(
        'O texto da correção deve ter no máximo 1000 caracteres',
      );
    }

    if (!/^\d{44}$/.test(nfe.chaveAcesso || '')) {
      throw new BadRequestException(
        'A chave de acesso da NF-e deve conter exatamente 44 dígitos',
      );
    }

    this.assertWithinCorrectionDeadline(nfe);

    const ambienteEvento = this.resolveDocumentEnvironment(nfe);

    // ---- 2. Reserva da sequência (transação curta, sem I/O externo) --------
    const reservation = await this.reserveCorrectionSequence(
      nfe,
      correcao,
      ambienteEvento,
      author,
    );
    const { sequenciaEvento } = reservation;

    this.logger.log(
      `Enviando carta de correção seq ${sequenciaEvento} para NF-e ${nfe.numero} (chave ${nfe.chaveAcesso}, ambiente ${ambienteEvento}, empresa ${companyId})`,
    );

    // ---- 3. Chamada ao provedor, FORA da transação ------------------------
    let response: any;
    try {
      const invoicyResponses =
        await this.invoicyApiService.sendCorrectionLetter(
          companyId,
          nfe.chaveAcesso,
          correcao,
          sequenciaEvento,
          ambienteEvento,
          {
            numero: nfe.numero,
            serie: nfe.serie,
            invoicyConfigId: nfe.invoicyConfigId ?? undefined,
          },
        );
      response = invoicyResponses?.[0];
    } catch (error) {
      // Falha de transporte: o evento PODE ter sido registrado na SEFAZ. A
      // sequência permanece queimada de propósito — reenviá-la causaria 573.
      await this.markCorrectionRejected(reservation.id, {
        motivoRejeicao: `Falha na comunicação com o provedor fiscal: ${error.message}`,
      });
      this.logger.error(
        `Falha de transporte na CC-e seq ${sequenciaEvento} da NF-e ${nfe.chaveAcesso}: ${error.message}`,
        error.stack,
      );
      throw new ServiceUnavailableException(
        'Não foi possível falar com o serviço fiscal para enviar a carta de correção. ' +
          'A tentativa foi registrada. Consulte a NF-e na SEFAZ antes de tentar novamente.',
      );
    }

    if (!response) {
      await this.markCorrectionRejected(reservation.id, {
        motivoRejeicao: 'Nenhuma resposta recebida do provedor fiscal',
      });
      throw new ServiceUnavailableException(
        'O serviço fiscal não retornou resposta para a carta de correção. A tentativa foi registrada.',
      );
    }

    const doc = response.Documentos?.[0];
    const sitCodigo = doc?.Situacao?.SitCodigo as number | undefined;
    const isRegistered =
      response.Codigo === INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED &&
      (sitCodigo === CCE_REGISTERED || sitCodigo === CCE_REGISTERED_UNLINKED);

    if (!isRegistered) {
      // Sem isto o diagnóstico morre no código de retorno: o provedor rejeita
      // vários casos com um código genérico e sem descrição, e era exatamente
      // o corpo da resposta que faltava para entender o 606 da CC-e.
      this.logger.error(
        `CC-e rejeitada pelo provedor. NF-e ${nfe.numero} (chave ${nfe.chaveAcesso}), ` +
          `seq ${sequenciaEvento}, ambiente ${ambienteEvento}. ` +
          `Resposta bruta: ${this.stringifyProviderResponse(response)}`,
      );

      const motivo = this.getCorrectionRejectionMessage(
        response,
        nfe.chaveAcesso,
        sequenciaEvento,
        correcao.length,
        ambienteEvento,
      );
      await this.markCorrectionRejected(reservation.id, {
        motivoRejeicao: motivo,
        codigoRetorno: response.Codigo ?? null,
        sitCodigo: sitCodigo ?? null,
      });
      throw new BadRequestException(motivo);
    }

    // ---- 4. Confirmação (transação curta) ---------------------------------
    return this.confirmCorrectionEvent({
      nfe,
      reservationId: reservation.id,
      sequenciaEvento,
      correcao,
      doc,
      sitCodigo,
      codigoRetorno: response.Codigo ?? null,
    });
  }

  /**
   * Trava a NF-e, revalida o status dentro da transação e reserva a próxima
   * sequência gravando o evento em PENDING.
   */
  private async reserveCorrectionSequence(
    nfe: any,
    correcao: string,
    ambiente: number,
    author: FiscalEventAuthor,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // Lock pessimista da NF-e: serializa duas CC-e concorrentes.
        await tx.nfe.update({
          where: { id: nfe.id },
          data: { updatedAt: new Date() },
          select: { id: true },
        });

        // O status foi lido antes da transação; reler evita corrida com um
        // cancelamento que tenha sido confirmado nesse meio-tempo.
        const current = await tx.nfe.findUnique({
          where: { id: nfe.id },
          select: { status: true },
        });

        if (
          current?.status !== NfeStatus.AUTHORIZED &&
          current?.status !== NfeStatus.CORRECTION_SENT
        ) {
          throw new ConflictException(
            'O status da NF-e mudou enquanto a carta de correção era preparada. Recarregue a nota e tente novamente.',
          );
        }

        const inFlight = await tx.nfeCorrectionEvent.findFirst({
          where: {
            nfeId: nfe.id,
            status: NfeCorrectionStatus.PENDING,
            createdAt: { gte: new Date(Date.now() - CCE_PENDING_IN_FLIGHT_MS) },
          },
          orderBy: { sequenciaEvento: 'desc' },
        });

        if (inFlight) {
          throw new ConflictException(
            `Já existe uma carta de correção em processamento para esta NF-e (sequência ${inFlight.sequenciaEvento}). Aguarde a conclusão antes de enviar outra.`,
          );
        }

        const lastEvent = await tx.nfeCorrectionEvent.findFirst({
          where: { nfeId: nfe.id },
          orderBy: { sequenciaEvento: 'desc' },
          select: { sequenciaEvento: true },
        });
        const sequenciaEvento = lastEvent ? lastEvent.sequenciaEvento + 1 : 1;

        if (sequenciaEvento > CCE_MAX_SEQUENCE) {
          throw new BadRequestException(
            `Esta NF-e já utilizou as ${CCE_MAX_SEQUENCE} cartas de correção permitidas pela SEFAZ.`,
          );
        }

        return tx.nfeCorrectionEvent.create({
          data: {
            nfeId: nfe.id,
            sequenciaEvento,
            correcao,
            status: NfeCorrectionStatus.PENDING,
            ambiente,
            createdBy: author.userId ?? null,
            createdByName: author.name ?? null,
          },
          select: { id: true, sequenciaEvento: true },
        });
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  /**
   * Persiste o desfecho negativo sem derrubar o fluxo de erro do chamador: a
   * exceção original é sempre mais informativa que uma falha de gravação aqui.
   */
  private async markCorrectionRejected(
    eventId: string,
    data: {
      motivoRejeicao: string;
      codigoRetorno?: number | null;
      sitCodigo?: number | null;
    },
  ): Promise<void> {
    try {
      await this.prisma.nfeCorrectionEvent.update({
        where: { id: eventId },
        data: {
          status: NfeCorrectionStatus.REJECTED,
          motivoRejeicao: data.motivoRejeicao,
          codigoRetorno: data.codigoRetorno ?? null,
          sitCodigo: data.sitCodigo ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Não foi possível registrar a rejeição da CC-e ${eventId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Confirma o evento já registrado na SEFAZ. O update da NF-e é condicionado ao
   * status para não sobrescrever um cancelamento concorrente.
   */
  private async confirmCorrectionEvent(params: {
    nfe: any;
    reservationId: string;
    sequenciaEvento: number;
    correcao: string;
    doc: any;
    sitCodigo?: number;
    codigoRetorno: number | null;
  }): Promise<any> {
    const {
      nfe,
      reservationId,
      sequenciaEvento,
      correcao,
      doc,
      sitCodigo,
      codigoRetorno,
    } = params;

    const xmlEvento = doc?.DocXMLBase64
      ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
      : null;

    if (!xmlEvento) {
      this.logger.warn(
        `XML da CC-e não retornado pelo provedor para NF-e ${nfe.chaveAcesso} (evento seq ${sequenciaEvento})`,
      );
    }

    // Data de registro na SEFAZ quando disponível; relógio local como fallback.
    const dataEvento = this.parseProviderDate(doc?.DocDhAut) ?? new Date();
    const protocolo = doc?.DocProtocolo || null;

    return this.prisma.$transaction(
      async (tx) => {
        await tx.nfeCorrectionEvent.update({
          where: { id: reservationId },
          data: {
            status: NfeCorrectionStatus.REGISTERED,
            protocolo,
            dataEvento,
            xmlEvento,
            sitCodigo: sitCodigo ?? null,
            codigoRetorno,
          },
        });

        const { count } = await tx.nfe.updateMany({
          where: {
            id: nfe.id,
            status: { in: [NfeStatus.AUTHORIZED, NfeStatus.CORRECTION_SENT] },
          },
          data: {
            status: NfeStatus.CORRECTION_SENT,
            cartaCorrecao: correcao,
            dataCorrecao: dataEvento,
            protocoloCorrecao: protocolo,
            sequenciaCorrecao: sequenciaEvento,
          },
        });

        if (count === 0) {
          // A CC-e existe na SEFAZ e está gravada, mas a nota saiu de um estado
          // corrigível (tipicamente cancelamento concorrente). Preservar o
          // estado atual é mais seguro do que reescrevê-lo.
          this.logger.warn(
            `CC-e seq ${sequenciaEvento} registrada na SEFAZ, mas a NF-e ${nfe.id} não está mais em estado corrigível. Status preservado.`,
          );
        }

        this.logger.log(
          `CC-e seq ${sequenciaEvento} registrada para NF-e ${nfe.chaveAcesso} (cStat ${sitCodigo}, protocolo ${protocolo ?? 'não informado'})`,
        );

        return tx.nfe.findUnique({ where: { id: nfe.id } });
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  /**
   * O leiaute do evento não aceita quebras de linha nem caracteres de controle
   * em xCorrecao. Normalizar aqui evita uma ida à SEFAZ só para tomar rejeição.
   */
  private sanitizeCorrectionText(input?: string): string {
    return (
      (input ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/\u00A0/g, ' ') // NBSP vindo de colagem de Word/Excel
        .replace(/\s{2,}/g, ' ')
        .trim()
    );
  }

  /**
   * A CC-e só pode ser transmitida em até 720 horas (30 dias) da autorização.
   */
  private assertWithinCorrectionDeadline(nfe: any): void {
    const reference = nfe?.dataAutorizacao ?? nfe?.dataEmissao;
    if (!reference) return;

    const hours = (Date.now() - new Date(reference).getTime()) / 3600000;
    if (hours > CCE_DEADLINE_HOURS) {
      throw new BadRequestException(
        `O prazo de ${CCE_DEADLINE_HOURS} horas (30 dias) para carta de correção foi excedido. ` +
          'Nesse caso a regularização deve ser feita por NF-e complementar ou de ajuste.',
      );
    }
  }

  private parseProviderDate(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Traduções que o sistema consegue SUSTENTAR. O 606 saiu daqui de propósito:
   * a mensagem antiga afirmava "a empresa não está habilitada no ambiente" e
   * mandava concluir a ativação do emissor, mas nada nesse fluxo verifica
   * habilitação — o evento nem lê o emissor. Em 05/08/2026 o diagnóstico do
   * incidente da Plottec (CNPJ 49464815000110) provou a afirmação falsa: no
   * mesmo ambiente e com a mesma credencial, a empresa autentica, a consulta
   * do documento devolve Codigo 100 com protocolo SEFAZ e a emissão funciona.
   * Sem documentação do provedor, o código cru é a única informação honesta.
   */
  private getKnownEventErrorMessage(
    code: number | undefined,
    _envLabel: string,
  ): string | undefined {
    if (!code) return undefined;
    const knownCodes: Record<number, string> = {
      [INVOICY_ERROR_CODES.INVALID_KEY]:
        'Chave de acesso da NF-e inválida. O documento pode ter sido emitido com dados inconsistentes.',
      [INVOICY_ERROR_CODES.REJECTED_BY_SEFAZ]:
        'A SEFAZ rejeitou o evento. Verifique os dados da NF-e e tente novamente.',
    };
    return knownCodes[code];
  }

  /**
   * Serializa a resposta do provedor para log, sem despejar os blobs (DANFE em
   * base64, XML) que dominariam a linha e sem quebrar em referência cíclica.
   */
  private stringifyProviderResponse(response: any): string {
    try {
      return JSON.stringify(response, (_key, value) =>
        typeof value === 'string' && value.length > 500
          ? `<${value.length} bytes omitidos>`
          : value,
      );
    } catch {
      return '<resposta não serializável>';
    }
  }

  private extractSpecificProviderMessage(response: any): string | undefined {
    const doc = response?.Documentos?.[0];
    const providerMessages = [
      response?.ErrorInvoicy,
      doc?.MensagemSefaz?.DscMsg,
      doc?.Situacao?.SitDescricao,
      response?.Mensagem,
      response?.Descricao,
    ]
      .filter((message): message is string =>
        Boolean(typeof message === 'string' && message.trim()),
      )
      .map((message) => message.trim());

    const genericMessage =
      'Não foi possível processar a operação, verifique os dados enviados e tente novamente.';
    return providerMessages.find((message) => message !== genericMessage);
  }

  private getCancelRejectionMessage(response: any, ambiente?: number): string {
    const envLabel = ambiente === 1 ? 'produção' : 'homologação';
    const code = response?.Codigo as number | undefined;
    const specificMessage = this.extractSpecificProviderMessage(response);
    const codeStr = code ? ` (código ${code})` : '';

    if (specificMessage) {
      return `Cancelamento rejeitado${codeStr}: ${specificMessage}`;
    }

    const knownMessage = this.getKnownEventErrorMessage(code, envLabel);
    if (knownMessage) {
      return `Cancelamento rejeitado (código ${code}): ${knownMessage}`;
    }

    return (
      `O Invoicy rejeitou o cancelamento${codeStr} sem informar o motivo. ` +
      `Ambiente: ${envLabel}. A resposta completa do provedor ficou registrada no log do evento.`
    );
  }

  private getCorrectionRejectionMessage(
    response: any,
    chaveAcesso: string,
    sequenciaEvento: number,
    correctionLength: number,
    ambiente?: number,
  ): string {
    const envLabel = ambiente === 1 ? 'produção' : 'homologação';
    const code = response?.Codigo as number | undefined;
    const specificMessage = this.extractSpecificProviderMessage(response);
    const codeStr = code ? ` (código ${code})` : '';

    if (specificMessage) {
      return `Carta de correção rejeitada${codeStr}: ${specificMessage}`;
    }

    const knownMessage = this.getKnownEventErrorMessage(code, envLabel);
    if (knownMessage) {
      return `Carta de correção rejeitada (código ${code}): ${knownMessage}`;
    }

    return (
      `O Invoicy rejeitou a carta de correção${codeStr} sem informar o motivo. ` +
      `Ambiente: ${envLabel}. Dados enviados: chave de acesso ${chaveAcesso} (44 dígitos), ` +
      `sequência ${sequenciaEvento} e texto da correção com ${correctionLength} caracteres. ` +
      `A resposta completa do provedor ficou registrada no log do evento.`
    );
  }

  /**
   * O XML autorizado é a fonte fiscal de verdade para o ambiente. Algumas NF-e
   * legadas foram persistidas com `ambiente` divergente durante a troca de
   * homologação para produção, o que direcionava eventos ao endpoint incorreto.
   */
  private resolveDocumentEnvironment(nfe: any): number {
    const xmlCandidates = [
      nfe?.xmlAutorizado,
      nfe?.xmlRetorno,
      nfe?.xmlEnvio,
    ].filter((xml): xml is string => typeof xml === 'string' && xml.length > 0);

    for (const xmlCandidate of xmlCandidates) {
      const decodedCandidates = [xmlCandidate];
      try {
        decodedCandidates.push(
          Buffer.from(xmlCandidate, 'base64').toString('utf-8'),
        );
      } catch {
        // O conteúdo já pode estar em XML puro.
      }

      for (const xml of decodedCandidates) {
        const match = xml.match(/<tpAmb[^>]*>\s*([12])\s*<\/tpAmb>/i);
        if (match) {
          const xmlEnvironment = Number(match[1]);
          if (nfe?.ambiente !== xmlEnvironment) {
            this.logger.warn(
              `Ambiente divergente na NF-e ${nfe?.id}: banco=${nfe?.ambiente}, XML=${xmlEnvironment}. Usando o XML para o evento fiscal.`,
            );
          }
          return xmlEnvironment;
        }
      }
    }

    return nfe?.ambiente === 1 ? 1 : 2;
  }

  /**
   * Obtém URL do DANFE
   */
  getDanfeUrl(nfe: any): { url: string } {
    if (!nfe.danfeUrl) {
      throw new NotFoundException('DANFE não disponível para esta NF-e');
    }
    return { url: nfe.danfeUrl };
  }

  /**
   * Obtém XML autorizado
   */
  getXml(nfe: any): { xml: string } {
    if (!nfe.xmlAutorizado) {
      throw new NotFoundException('XML não disponível para esta NF-e');
    }
    return { xml: nfe.xmlAutorizado };
  }
}
