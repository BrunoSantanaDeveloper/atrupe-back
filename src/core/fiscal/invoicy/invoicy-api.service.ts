import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyHttpService } from './invoicy-http.service';
import {
  InvoicyResponse,
  InvoicyNfeRequest,
  InvoicyNfseRequest,
  INVOICY_SUCCESS_CODES,
} from './invoicy.types';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { UF_CODES } from '../utils/fiscal-validators';
import { FiscalEnvironment } from '@prisma/client';

/**
 * Dados do documento usados para montar um evento fiscal. Todos opcionais: a
 * chave de acesso já carrega CNPJ, modelo, série e número, e é dela que esses
 * valores saem quando disponível.
 */
export interface FiscalEventDocument {
  numero?: number;
  serie?: number | string;
  cnpj?: string;
  invoicyConfigId?: string;
}

/** Texto legal fixo da CC-e, conforme o exemplo oficial do provedor. */
const CCE_COND_USO =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do ' +
  'Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para ' +
  'regularizacao de erro ocorrido na emissao de documento fiscal, desde que o ' +
  'erro nao esteja relacionado com: I - as variaveis que determinam o valor do ' +
  'imposto tais como: base de calculo, aliquota, diferenca de preco, ' +
  'quantidade, valor da operacao ou da prestacao; II - a correcao de dados ' +
  'cadastrais que implique mudanca do remetente ou do destinatario; III - a ' +
  'data de emissao ou de saida.';

/**
 * "YYYY-MM-DDTHH:mm:ss" no fuso de Brasília, sem sufixo — a forma do exemplo
 * oficial, que informa o fuso em campo separado (EveFusoHorario).
 */
function formatLocalDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  // 'sv-SE' produz "YYYY-MM-DD HH:mm:ss"; o leiaute pede o separador 'T'.
  return parts.replace(' ', 'T');
}

/**
 * InvoicyApiService - Domain API Layer for Fiscal Documents
 *
 * This service provides a domain-specific API for fiscal document operations
 * (NF-e, NFS-e, NFC-e) using the InvoicyHttpService for HTTP transport.
 *
 * Separation of concerns:
 * - InvoicyHttpService: Auth, retry, HTTP transport
 * - InvoicyApiService: Fiscal document operations (this service)
 * - InvoicyService: Config CRUD, incrementers
 */
@Injectable()
export class InvoicyApiService {
  private readonly logger = new Logger(InvoicyApiService.name);

  /**
   * Teto de espera para eventos fiscais (CC-e, cancelamento). Precisa ser menor
   * que o timeout da transação que persiste o resultado, senão o evento pode ser
   * registrado na SEFAZ sem que o sistema consiga gravá-lo.
   */
  private readonly FISCAL_EVENT_TIMEOUT_MS = 45000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyHttpService: InvoicyHttpService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
  ) {}

  // ============================================
  // NF-e / NFC-e Operations
  // ============================================

  /**
   * Emit NF-e or NFC-e document
   *
   * `forceEnvironment` deve receber o MESMO ambiente usado para montar o
   * payload (o `ide.tpAmb` do documento). Sem ele, o transporte resolve o
   * ambiente por conta própria e cai no campo global `activeEnvironment`, que
   * pode divergir do campo por tipo de documento — a nota sairia para o host de
   * um ambiente carregando o tpAmb do outro, e os eventos dela (roteados pelo
   * tpAmb do XML) bateriam no ambiente errado depois.
   */
  async emitNfe(
    companyId: string,
    documents: InvoicyNfeRequest[],
    invoicyConfigId?: string,
    forceEnvironment?: FiscalEnvironment,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Emitting NF-e/NFC-e for company ${companyId}`);

    // disableRetry: emissão é escrita fiscal NÃO idempotente e o payload não
    // carrega chave de idempotência — reenviar após um timeout de leitura pode
    // transmitir duas vezes um documento que a SEFAZ já processou. A emissão de
    // NFS-e e os eventos já seguiam esse contrato; a de NF-e ficou de fora.
    //
    // O rate limit (429) segue sendo repetido mesmo assim: ali o provedor
    // recusou antes de processar, então não há documento em voo.
    const response = await this.invoicyHttpService.makeRequest<
      InvoicyResponse[]
    >(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Emissao',
      documents,
      invoicyConfigId,
      undefined,
      forceEnvironment,
      true,
    );

    // Check for errors in response
    if (
      response.length > 0 &&
      response[0].Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED
    ) {
      this.logger.warn(
        `Invoicy returned non-success code: ${response[0].Codigo} - ${
          response[0].Descricao || response[0].ErrorInvoicy || 'Sem descricao'
        }`,
      );
    }

    return response;
  }

  /**
   * Cancel NF-e or NFC-e document (evento 110111)
   *
   * Ver docs/fiscal/invoicy/ para o contrato e o porquê da forma abaixo.
   */
  async cancelNfe(
    companyId: string,
    chaveAcesso: string,
    justificativa: string,
    ambiente?: number,
    documento?: FiscalEventDocument,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Canceling NF-e ${chaveAcesso} for company ${companyId}`);

    const cancelRequest = [
      this.buildFiscalEvent(chaveAcesso, ambiente, documento, {
        EveTp: 110111,
        Evedet: {
          EveDesc: 'Cancelamento',
          EvexJust: justificativa,
          // EvenProt é opcional no XSD; o provedor resolve o protocolo pelo
          // documento que ele já indexou.
        },
      }),
    ];

    const forceEnvironment = this.toFiscalEnvironment(ambiente);

    // Ver comentário em sendCorrectionLetter: evento fiscal não é idempotente.
    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Evento',
      cancelRequest,
      documento?.invoicyConfigId,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      forceEnvironment,
      true,
    );
  }

  /**
   * Send correction letter (Carta de Correção) for NF-e (evento 110110)
   */
  async sendCorrectionLetter(
    companyId: string,
    chaveAcesso: string,
    correcao: string,
    sequenciaEvento: number = 1,
    ambiente?: number,
    documento?: FiscalEventDocument,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Sending correction letter for NF-e ${chaveAcesso}, company ${companyId}`,
    );

    const correctionRequest = [
      this.buildFiscalEvent(chaveAcesso, ambiente, documento, {
        EveTp: 110110,
        EvenSeq: String(sequenciaEvento),
        Evedet: {
          EveDesc: 'Carta de Correcao',
          EveCorrecao: correcao,
          EveCondUso: CCE_COND_USO,
        },
      }),
    ];

    const forceEnvironment = this.toFiscalEnvironment(ambiente);

    // Evento fiscal não é idempotente: um reenvio após timeout de leitura pode
    // registrar a mesma CC-e duas vezes na SEFAZ. O AbortSignal garante que a
    // resposta chegue dentro da janela em que o chamador ainda consegue persistir.
    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Evento',
      correctionRequest,
      documento?.invoicyConfigId,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      forceEnvironment,
      true,
    );
  }

  /**
   * Monta o corpo de um evento no formato do provedor.
   *
   * A forma é a do exemplo oficial (docs/fiscal/invoicy/evento-*.exemplo.json) e
   * do schema Envio_NFe-NFCe_4.0.xsd, cuja raiz é `EnvioEvento` — NÃO existe o
   * wrapper `Documento` aqui (ele só é válido na emissão). O documento também
   * não é endereçado pela chave de acesso: os obrigatórios são
   * NtfCnpjEmissor + NtfNumero + NtfSerie + tpAmb, e `ChaAcesso` é opcional.
   *
   * Enquanto isto era `{ Documento: { Evento: { ChaveNFe, TipoEvento, ... } } }`
   * — nomes que não existem no dicionário do provedor — todo evento voltava com
   * o erro genérico 606 e nenhum jamais foi registrado.
   */
  /** Código IBGE da UF do emitente, exigido pela inutilização (`UfEmissor`). */
  private async resolveUfCode(companyId: string): Promise<number | undefined> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { address: { select: { state: true }, take: 1 } },
    });
    const uf = company?.address?.[0]?.state?.toUpperCase();
    return uf ? UF_CODES[uf] : undefined;
  }

  private buildFiscalEvent(
    chaveAcesso: string,
    ambiente: number | undefined,
    documento: FiscalEventDocument | undefined,
    evento: {
      EveTp: number;
      EvenSeq?: string;
      Evedet: Record<string, unknown>;
    },
  ) {
    const chave = (chaveAcesso || '').replace(/\D/g, '');
    const { EveTp, EvenSeq, Evedet } = evento;

    // A chave de acesso é a fonte de verdade para o que ela mesma carrega:
    // CNPJ nas posições 7-20, modelo em 21-22, série em 23-25 e número em 26-34.
    // Os campos de `documento` só entram quando a chave não estiver disponível.
    const cnpjDaChave = chave.slice(6, 20);
    const modeloDaChave = chave.slice(20, 22);
    const serieDaChave = chave.slice(22, 25);
    const numeroDaChave = chave.slice(25, 34);

    const cnpj = cnpjDaChave || (documento?.cnpj || '').replace(/\D/g, '');
    const numero = numeroDaChave
      ? parseInt(numeroDaChave, 10)
      : documento?.numero;
    // O provedor guarda a série sem zeros à esquerda (a consulta do documento
    // devolve DocSerie "1" para a chave que traz "001"), e foi assim que a
    // emissão a enviou.
    const serie = serieDaChave
      ? String(parseInt(serieDaChave, 10))
      : documento?.serie !== undefined
        ? String(documento.serie)
        : undefined;

    return {
      // NFC-e é modelo 65: o literal 'NFe' fixo mandava o modelo errado em todo
      // cancelamento de NFC-e, que reusa este mesmo caminho.
      ModeloDocumento: modeloDaChave === '65' ? 'NFCe' : 'NFe',
      Versao: 4,
      Evento: {
        NtfCnpjEmissor: cnpj,
        NtfNumero: numero,
        NtfSerie: serie,
        tpAmb: ambiente === 1 ? 1 : 2,
        EveInf: {
          // Hora local sem sufixo, com o fuso no campo irmão — é a forma do
          // exemplo oficial. Enviar UTC com "Z" junto de EveFusoHorario -03:00
          // faria o provedor montar um evento 3h no futuro, que a SEFAZ rejeita.
          EveDh: formatLocalDateTime(new Date()),
          EveFusoHorario: '-03:00',
          EveTp,
          EvenSeq: EvenSeq ?? '1',
          Evedet,
        },
      },
    };
  }

  /**
   * Inutilize NFC-e number range
   */
  async inutilizarNfce(
    companyId: string,
    serie: number,
    numeroInicial: number,
    numeroFinal: number,
    justificativa: string,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Inutilizing NFC-e range ${numeroInicial}-${numeroFinal} for company ${companyId}`,
    );

    let config = invoicyConfigId
      ? await this.prisma.invoicyConfig.findUnique({
          where: { id: invoicyConfigId },
        })
      : await this.prisma.invoicyConfig.findFirst({
          where: { companyId, isDefault: true },
        });

    if (!config) {
      // orderBy determinístico para empresas com mais de um emissor.
      config = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      });
    }

    const configId = config?.id;
    if (!configId) {
      throw new Error(
        `Configuração do Invoicy não encontrada para empresa ${companyId}`,
      );
    }

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        configId,
      );
    const credentials = await this.invoicyHttpService.getCompanyCredentials(
      companyId,
      configId,
    );

    // Forma plana, sem wrapper `Documento` — ver docs/fiscal/invoicy/
    // inutilizacao.exemplo.json. Note que aqui o campo é `CnpjEmissor`, e não o
    // `NtfCnpjEmissor` do evento: o provedor usa grafias distintas por operação.
    const inutRequest = [
      {
        ModeloDocumento: 'NFCe',
        Versao: 4,
        CnpjEmissor: credentials.cnpj.replace(/\D/g, ''),
        tpAmb: environment === 'PRODUCAO' ? 1 : 2,
        UfEmissor: await this.resolveUfCode(companyId),
        NumeroInicial: numeroInicial,
        NumeroFinal: numeroFinal,
        Serie: String(serie),
        Justificativa: justificativa,
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Inutilizacao',
      inutRequest,
      configId,
    );
  }

  /**
   * Inutilize NF-e number range (model 55)
   */
  async inutilizarNfe(
    companyId: string,
    serie: number,
    numeroInicial: number,
    numeroFinal: number,
    justificativa: string,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Inutilizing NF-e range ${numeroInicial}-${numeroFinal} for company ${companyId}`,
    );

    let config = invoicyConfigId
      ? await this.prisma.invoicyConfig.findUnique({
          where: { id: invoicyConfigId },
        })
      : await this.prisma.invoicyConfig.findFirst({
          where: { companyId, isDefault: true },
        });

    if (!config) {
      // orderBy determinístico para empresas com mais de um emissor.
      config = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      });
    }

    const configId = config?.id;
    if (!configId) {
      throw new Error(
        `Configuração do Invoicy não encontrada para empresa ${companyId}`,
      );
    }

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        configId,
      );
    const credentials = await this.invoicyHttpService.getCompanyCredentials(
      companyId,
      configId,
    );

    // Forma plana — ver docs/fiscal/invoicy/inutilizacao.exemplo.json.
    const inutRequest = [
      {
        ModeloDocumento: 'NFe',
        Versao: 4,
        CnpjEmissor: credentials.cnpj.replace(/\D/g, ''),
        tpAmb: environment === 'PRODUCAO' ? 1 : 2,
        UfEmissor: await this.resolveUfCode(companyId),
        NumeroInicial: numeroInicial,
        NumeroFinal: numeroFinal,
        Serie: String(serie),
        Justificativa: justificativa,
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Inutilizacao',
      inutRequest,
      configId,
    );
  }

  // ============================================
  // NFS-e Operations
  // ============================================

  /**
   * Emit NFS-e document
   */
  async emitNfse(
    companyId: string,
    documents: InvoicyNfseRequest[],
    invoicyConfigId?: string,
    environment?: FiscalEnvironment,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Emitting NFS-e for company ${companyId}`);

    // Emissão não é idempotente: o payload não carrega chave de idempotência,
    // então reenviar após falha de leitura pode duplicar um RPS que a
    // prefeitura já processou. Mesmo tratamento de emitNfe/cancelNfe.
    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfse?type=Emissao',
      documents,
      invoicyConfigId,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      environment,
      true,
    );
  }

  /**
   * Cancel NFS-e document
   */
  /**
   * Cancela uma NFS-e (evento 110111).
   *
   * A forma é a do layout oficial `Eventos/Layouts/Layout eventos NFSe.xlsx`
   * (migrate-company/integracao-InvoiCy-BR) e do schema
   * `Eventos/Schemas/Cancelamento_NFSe.xsd`, cuja raiz é `EnvioEvento`: NÃO
   * existe o wrapper `Documento` aqui — ele só vale na emissão. É o mesmo
   * engano que o evento de NF-e tinha (ver buildFiscalEvent).
   *
   * Enquanto isto era `{ Documento: { Cancelamento: { NumeroNFSe,
   * CodigoVerificacao, Motivo } } }` — três nomes que não existem no
   * dicionário do provedor — toda tentativa voltava com a mensagem genérica
   * "Não foi possível processar a operação" e nenhuma NFS-e jamais foi
   * cancelada pelo sistema.
   *
   * Obrigatórios: CNPJ, NFSeNumero, RPSNumero, RPSSerie, EveTp, tpAmb,
   * EveCodigo e EveMotivo. `NotaExiste: 'S'` diz que a nota já está registrada
   * na prefeitura — é o único estado em que cancelamos — e é o que habilita
   * NFSeCodVerificacao e Protocolo.
   */
  async cancelNfse(
    companyId: string,
    documento: {
      cnpj: string;
      nfseNumero: number;
      rpsNumero: number;
      rpsSerie: string;
      codigoVerificacao?: string | null;
      protocolo?: string | null;
      invoicyConfigId?: string | null;
    },
    motivo: string,
    codigoCancelamento = '1',
    ambiente?: number,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Canceling NFS-e ${documento.nfseNumero} (RPS ${documento.rpsNumero}/${documento.rpsSerie}) for company ${companyId}`,
    );

    const cancelRequest = [
      {
        ModeloDocumento: 'NFSe',
        Versao: 1,
        Evento: {
          CNPJ: (documento.cnpj || '').replace(/\D/g, ''),
          NFSeNumero: documento.nfseNumero,
          RPSNumero: documento.rpsNumero,
          RPSSerie: documento.rpsSerie,
          EveTp: 110111,
          tpAmb: ambiente === 1 ? 1 : 2,
          NotaExiste: 'S',
          ...(documento.codigoVerificacao
            ? { NFSeCodVerificacao: documento.codigoVerificacao }
            : {}),
          ...(documento.protocolo ? { Protocolo: documento.protocolo } : {}),
          EveCodigo: codigoCancelamento,
          EveMotivo: motivo,
        },
      },
    ];

    const forceEnvironment = this.toFiscalEnvironment(ambiente);

    // Evento fiscal não é idempotente: ver o comentário em cancelNfe.
    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfse?type=Evento',
      cancelRequest,
      documento.invoicyConfigId ?? undefined,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      forceEnvironment,
      true,
    );
  }

  /**
   * Consulta NFS-e no provedor por faixa de numeração de RPS.
   *
   * Para NFS-e o "Número" do documento no InvoiCy é o número do RPS — a
   * numeração da nota municipal vem separada em NFSe.NFSeNumero. Por isso a
   * consulta é por rpsNumero, que é o único identificador que temos quando a
   * emissão falha antes de a prefeitura devolver um número.
   *
   * Layout: migrate-company/integracao-InvoiCy-BR, "Consulta de documentos"
   * (Consulta Por Faixa Número.xml / get_consulta.txt).
   *
   * `opcoes.pdfBase64` pede o PDF da nota em base64 (DocPDFBase64). O padrão é
   * não pedir, porque o retorno fica alguns KB maior e a reconciliação de
   * status não usa o PDF.
   */
  async consultNfse(
    companyId: string,
    rpsNumeroInicial: number,
    rpsNumeroFinal: number,
    serie: string,
    ambiente?: number,
    invoicyConfigId?: string,
    opcoes?: { pdfBase64?: boolean },
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Consultando NFS-e RPS ${rpsNumeroInicial}-${rpsNumeroFinal}/${serie} para empresa ${companyId}`,
    );

    const forceEnvironment = this.toFiscalEnvironment(ambiente);

    const credentials = await this.invoicyHttpService.getCompanyCredentials(
      companyId,
      invoicyConfigId,
      forceEnvironment,
    );
    const cnpj = (credentials.cnpj || '').replace(/\D/g, '');

    const params = new URLSearchParams({
      type: 'Consulta',
      ModeloDocumento: 'NFSe',
      Versao: '1.00',
      CnpjEmissor: cnpj,
      CnpjEmpresa: cnpj,
      NumeroInicial: String(rpsNumeroInicial),
      NumeroFinal: String(rpsNumeroFinal),
      Serie: serie,
      tpAmb: String(ambiente ?? 2),
      EmitidoRecebido: 'E',
      DocumentosResumo: 'N',
      ParmSituacao: 'S',
      ParmEventos: 'N',
      ParmPDFBase64: opcoes?.pdfBase64 ? 'S' : 'N',
      ParmPDFLink: 'S',
      ParmXMLCompleto: 'S',
      ParmXMLLink: 'N',
    });

    // Consulta é idempotente: retry aqui é seguro e desejável.
    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'GET',
      `/senddocuments/nfse?${params.toString()}`,
      undefined,
      invoicyConfigId,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      forceEnvironment,
    );
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * Test connection to Invoicy API for a company
   */
  async testConnection(companyId: string): Promise<boolean> {
    try {
      await this.invoicyHttpService.authenticate(companyId);
      return true;
    } catch (error) {
      this.logger.error(
        `Connection test failed for company ${companyId}: ${error.message}`,
      );
      return false;
    }
  }

  // ============================================
  // Contingency Operations
  // ============================================

  /**
   * Sync contingency NFC-e to SEFAZ
   * Tries to transmit an offline NFC-e that was saved during contingency mode
   */
  async syncContingency(
    companyId: string,
    chaveOuId: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Syncing contingency NFC-e ${chaveOuId} for company ${companyId}`,
    );

    const syncRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFCe',
          Versao: 4,
          Consulta: {
            Chave: chaveOuId,
            TipoConsulta: 'Sincronizacao',
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=ConsultaSincronizacao',
      syncRequest,
    );
  }

  /**
   * Consulta o status real de uma NF-e específica na SEFAZ via Invoicy
   */
  async consultNfeSefaz(
    companyId: string,
    chaveAcesso: string,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Consultando status NF-e ${chaveAcesso} para empresa ${companyId}`,
    );

    const consultRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFe',
          Versao: 4,
          Consulta: {
            Chave: chaveAcesso,
            TipoConsulta: 'ConsultaChave',
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=ConsultaSincronizacao',
      consultRequest,
      invoicyConfigId,
    );
  }

  /**
   * Consulta um documento trazendo os eventos vinculados e o PDF de cada um.
   *
   * O DACCE (representacao impressa da carta de correcao) nao vem no retorno do
   * envio do evento: e' preciso consultar o documento com ParmEventos=S e
   * ParmPDFBase64=S, e o PDF chega em Eventos[].DocEvePDF. Layout publicado em
   * migrate-company/integracao-InvoiCy-BR (Consulta de documentos).
   */
  async consultDocumentEvents(
    companyId: string,
    chaveAcesso: string,
    ambiente?: number,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Consultando eventos da NF-e ${chaveAcesso} para empresa ${companyId}`,
    );

    return this.consultDocument(
      companyId,
      chaveAcesso,
      ambiente,
      invoicyConfigId,
      {
        ParmEventos: 'S',
        ParmPDFBase64: 'S',
        ParmPDFLink: 'S',
        ParmXMLCompleto: 'N',
        ParmXMLLink: 'N',
      },
    );
  }

  /**
   * Consulta um documento trazendo o XML autorizado (base64 e link).
   *
   * O XML da NF-e so' era gravado na resposta sincrona da emissao. Quando ela
   * vinha sem DocXMLBase64, ou quando a nota era autorizada depois pela
   * consulta de status, a NF-e ficava AUTHORIZED sem XML e sumia da
   * exportacao em ZIP. ParmXMLCompleto=S e' o caminho documentado para
   * rebusca-lo (layout de consultas: "XMLCompleto — XML sera' retornado em
   * base 64").
   */
  async consultDocumentXml(
    companyId: string,
    chaveAcesso: string,
    ambiente?: number,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Consultando XML da NF-e ${chaveAcesso} para empresa ${companyId}`,
    );

    return this.consultDocument(
      companyId,
      chaveAcesso,
      ambiente,
      invoicyConfigId,
      {
        ParmEventos: 'N',
        ParmPDFBase64: 'N',
        ParmPDFLink: 'N',
        ParmXMLCompleto: 'S',
        ParmXMLLink: 'S',
      },
    );
  }

  private async consultDocument(
    companyId: string,
    chaveAcesso: string,
    ambiente: number | undefined,
    invoicyConfigId: string | undefined,
    retorno: Record<
      | 'ParmEventos'
      | 'ParmPDFBase64'
      | 'ParmPDFLink'
      | 'ParmXMLCompleto'
      | 'ParmXMLLink',
      'S' | 'N'
    >,
  ): Promise<InvoicyResponse[]> {
    const forceEnvironment = this.toFiscalEnvironment(ambiente);

    const credentials = await this.invoicyHttpService.getCompanyCredentials(
      companyId,
      invoicyConfigId,
      forceEnvironment,
    );
    const cnpj = (credentials.cnpj || '').replace(/\D/g, '');

    const params = new URLSearchParams({
      type: 'Consulta',
      ModeloDocumento: 'NFe',
      Versao: '4.00',
      CnpjEmissor: cnpj,
      CnpjEmpresa: cnpj,
      ChaveAcesso: chaveAcesso,
      EmitidoRecebido: 'E',
      tpAmb: String(ambiente ?? 2),
      DocumentosResumo: 'N',
      ParmSituacao: 'S',
      ...retorno,
    });

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'GET',
      `/senddocuments/nfe?${params.toString()}`,
      undefined,
      invoicyConfigId,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      forceEnvironment,
    );
  }

  private toFiscalEnvironment(
    ambiente?: number,
  ): FiscalEnvironment | undefined {
    if (ambiente === undefined) return undefined;
    return ambiente === 1
      ? FiscalEnvironment.PRODUCAO
      : FiscalEnvironment.HOMOLOGACAO;
  }

  /**
   * Check SEFAZ availability status
   * Returns true if SEFAZ is responding, false otherwise
   */
  async checkSefazStatus(
    companyId: string,
  ): Promise<{ available: boolean; message?: string }> {
    this.logger.debug(`Checking SEFAZ status for company ${companyId}`);

    try {
      const statusRequest = [
        {
          Documento: {
            ModeloDocumento: 'NFCe',
            Versao: 4,
            Consulta: {
              TipoConsulta: 'StatusServico',
            },
          },
        },
      ];

      const response = await this.invoicyHttpService.makeRequest<
        InvoicyResponse[]
      >(
        companyId,
        'POST',
        '/senddocuments/nfe?type=StatusServico',
        statusRequest,
      );

      // Status 107 = Serviço em operação
      const isAvailable =
        response[0]?.Codigo === 107 ||
        response[0]?.Codigo === INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED;

      return {
        available: isAvailable,
        message: response[0]?.Descricao,
      };
    } catch (error) {
      this.logger.warn(`SEFAZ status check failed: ${error.message}`);
      return {
        available: false,
        message: error.message,
      };
    }
  }
}
