import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  NfceStatus,
  NfeStatus,
  NfseStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import {
  InvoicyNfeRequest,
  InvoicyResponse,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import { fetchCepData } from '../utils/cep.util';

/**
 * Pre-visualizacao da NFC-e: o mesmo payload que seria transmitido, sem
 * reservar numero nem criar registro.
 */
export interface NfcePreview {
  podeEmitir: boolean;
  bloqueios: string[];
  avisos: string[];
  documento?: {
    modelo: string;
    ambiente: string;
    /** Numero previsto; o definitivo e reservado na emissao. */
    numeroPrevisto: number;
    serie: string;
    naturezaOperacao: string;
    contingencia: boolean;
  };
  emitente?: Record<string, any>;
  consumidor?: Record<string, any> | null;
  itens?: Array<Record<string, any>>;
  totais?: Record<string, any>;
  pagamentos?: Array<Record<string, any>>;
  /** Payload cru, para o painel tecnico e para os testes de equivalencia. */
  payloadInvoicy?: InvoicyNfeRequest;
}

import {
  EmitNfceDto,
  CancelNfceDto,
  InutilizarNfceDto,
  ContingenciaNfceDto,
  NfceFilterDto,
} from './dtos/nfce.dto';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { montarImpostosNfe } from '../utils/nfe-imposto-payload.util';
import {
  ItemDaEmissao,
  totaisDosItens,
  valoresDaLinhaParaNota,
  valoresDoItemNoXml,
} from '../utils/fiscal-line-values.util';
import { isRegimeNormal } from '../utils/regime-tributario.util';
import {
  aliquotasReformaTributaria,
  calcularVNFIBScbsIS,
} from '../utils/ibs-cbs-nfe.util';
import {
  mensagemComOrientacao,
  motivoComOrientacao,
  orientacaoRejeicaoFiscal,
} from '../utils/orientacao-rejeicao.util';

/**
 * Recusas da SEFAZ que NÃO liberam o número da NFC-e: a denegação registra o
 * documento (com protocolo), e as demais dizem que o número já tem dono na
 * SEFAZ. Na dúvida, um código fica aqui — número não devolvido só deixa um vão
 * a inutilizar; número devolvido indevidamente faz a próxima emissão repetir a
 * mesma recusa no mesmo número.
 */
const CSTAT_NUMERO_CONSUMIDO = new Set([
  110, // Uso Denegado
  204, // Duplicidade de NF-e
  205, // NF-e está denegada na base de dados da SEFAZ
  206, // NF-e já está inutilizada na base de dados da SEFAZ
  218, // NF-e já está cancelada na base de dados da SEFAZ
  301, // Uso Denegado: irregularidade fiscal do emitente
  302, // Irregularidade fiscal do destinatário
  303, // Uso Denegado: destinatário não habilitado a operar na UF
  539, // Duplicidade de NF-e com diferença na chave de acesso
]);

/**
 * Campos que só a transmissão de uma tentativa preenche. Ao reaproveitar a
 * linha de uma tentativa rejeitada eles voltam ao estado de uma linha nova —
 * senão a chave, o XML ou o motivo da tentativa anterior apareceriam na nova.
 */
const NFCE_CAMPOS_DA_TENTATIVA_ZERADOS = {
  chaveAcesso: null,
  protocolo: null,
  dataEmissao: null,
  dataAutorizacao: null,
  xmlEnvio: null,
  xmlRetorno: null,
  xmlAutorizado: null,
  qrCodeUrl: null,
  urlConsulta: null,
  danfeUrl: null,
  motivoRejeicao: null,
  motivoCancelamento: null,
  dataCancelamento: null,
  protocoloCancelamento: null,
  contingencia: false,
  dataContingencia: null,
  motivoContingencia: null,
  invoicyId: null,
  invoicyProtocol: null,
};

/** Item da NFC-e (nomes do DTO) na forma de `valoresDoItemNoXml`. */
function itemNfceParaXml(item: EmitNfceDto['itens'][number]): ItemDaEmissao {
  return {
    quantity: item.quantidade,
    unitValue: item.valorUnitario,
    discount: item.valorDesconto,
  };
}

@Injectable()
export class NfceService {
  private readonly logger = new Logger(NfceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyApiService: InvoicyApiService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
  ) {}

  /**
   * Itens de uma O.S. prontos para a NFC-e.
   *
   * A tela montava isso sozinha a partir de `/sale/order/:id` e errava duas
   * coisas que a emissao por NF-e ja' acertava:
   *
   * - os valores do orcamento ficam em CENTAVOS. Um copo de R$ 35,00 chegava
   *   a' nota como R$ 3.500,00, e o total de R$ 70,00 como R$ 7.000,00.
   * - a quantidade comercial nao e' a "Qtd. Item" (1), e' a medida do que foi
   *   vendido (2 un). A tela lia o campo errado e ainda assim exibia o valor
   *   final das duas pecas, entao nem o proprio resumo fechava.
   *
   * Quantidade e valor de documento fiscal nao se calculam no cliente: a
   * conta e' a mesma de `NfeService.prepareFromOrder`, com o mesmo util.
   */
  private async itensDaOrdemParaNfce(
    companyId: string,
    orderId: string,
    config: any,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, quotation: { companyId } },
      include: {
        quotation: {
          include: {
            quotationProduct: {
              include: {
                items: true,
                product: { include: { fiscalData: true } },
              },
            },
          },
        },
      },
    });

    if (!order?.quotation?.quotationProduct?.length) return [];

    return order.quotation.quotationProduct.map((qp: any, index: number) => {
      const fiscalData = qp.product?.fiscalData;
      // Unidade cadastrada, valor bruto e desconto em vDesc: a mesma conta da
      // NF-e (`valoresDaLinhaParaNota`).
      const linha = valoresDaLinhaParaNota(
        qp,
        fiscalData?.commercialUnit ?? null,
      );

      return {
        itemNumber: index + 1,
        productId: qp.productId,
        productCode: qp.product?.code || '',
        description: qp.description || qp.product?.name || 'Produto',
        ncm: fiscalData?.ncm || '',
        // NFC-e e' venda presencial dentro do estado: CFOP interno sempre.
        cfop: fiscalData?.cfopInState || config.defaultCfop || '5102',
        cstIcms: fiscalData?.icmsCst || '',
        cstIpi: '',
        cstPis: fiscalData?.pisCst || '',
        cstCofins: fiscalData?.cofinsCst || '',
        unit: linha.unit,
        uCom: linha.unit,
        ean: fiscalData?.cean || '',
        ceantrib: '',
        quantity: linha.quantity,
        unitValue: linha.unitValue,
        discount: linha.discount,
        freight: 0,
        insurance: 0,
        totalValue: linha.totalValue,
        // Para a tela converter a quantidade quando a unidade muda.
        pieceQuantity: linha.pieceQuantity,
        measureQuantity: linha.measureQuantity,
        measureUnit: linha.measureUnit,
        isService: false,
        needsConfiguration:
          !fiscalData?.ncm ||
          !fiscalData?.icmsCst ||
          !fiscalData?.pisCst ||
          !fiscalData?.cofinsCst,
      };
    });
  }

  async prepareStandalone(companyId: string, orderId?: string) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }
    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        config.id,
        'NFCE',
      );
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFCE',
    );
    const credentials =
      await this.fiscalCredentialResolver.getEmissorRuntimeCredentials(
        companyId,
        config.id,
        environment,
      );

    return {
      numero: credentials.nfceNextNumber || 1,
      serie: credentials.nfceSeries || 1,
      ambiente: environment, // 'HOMOLOGACAO' ou 'PRODUCAO'
      emitCrt: config.emitCrt || 1,
      naturezaOperacao: 'Venda de mercadoria',
      informacoesComplementares: config.taxInfoText || '',
      prazoCancelamentoMinutos: config.prazoCancelamentoNfce ?? 30,
      itens: orderId
        ? await this.itensDaOrdemParaNfce(companyId, orderId, config)
        : [],
    };
  }

  async findAll(companyId: string, filters: NfceFilterDto) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { companyId };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.numero) {
      where.numero = filters.numero;
    }

    if (filters.orderId) {
      where.orderId = filters.orderId;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.nfce.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              quotation: {
                include: {
                  client: true,
                },
              },
            },
          },
          quotation: {
            include: {
              client: true,
            },
          },
        },
      }),
      this.prisma.nfce.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string, companyId: string) {
    const nfce = await this.prisma.nfce.findFirst({
      where: { id, companyId },
      include: {
        order: {
          include: {
            quotation: {
              include: {
                client: true,
                quotationProduct: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        },
        quotation: {
          include: {
            client: true,
            quotationProduct: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!nfce) {
      throw new NotFoundException('NFC-e não encontrada');
    }

    return nfce;
  }

  async findByChaveAcesso(chaveAcesso: string, companyId: string) {
    const nfce = await this.prisma.nfce.findFirst({
      where: { chaveAcesso, companyId },
    });

    if (!nfce) {
      throw new NotFoundException('NFC-e não encontrada');
    }

    return nfce;
  }

  /**
   * Leituras, validações e cálculo de imposto que precedem qualquer efeito.
   *
   * Extraído de `emit` para a pré-visualização rodar as mesmas checagens sem
   * reservar número nem criar registro.
   */
  private async resolveNfceEmissionContext(
    companyId: string,
    dto: EmitNfceDto,
  ) {
    // Buscar configuração do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    if (!config.isActive) {
      throw new BadRequestException('Integração com Invoicy está desativada.');
    }

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        config.id,
        'NFCE',
      );
    const linkedOrder = dto.orderId
      ? await this.assertOrderCanReceiveNfce(
          companyId,
          dto.orderId,
          environment === 'PRODUCAO' ? 1 : 2,
        )
      : null;
    if (
      dto.orderId &&
      dto.quotationId &&
      linkedOrder?.quotationId !== dto.quotationId
    ) {
      throw new BadRequestException(
        'A ordem de serviço informada não pertence ao orçamento enviado.',
      );
    }
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFCE',
    );
    const emissorCredentials =
      await this.fiscalCredentialResolver.getEmissorRuntimeCredentials(
        companyId,
        config.id,
        environment,
      );

    // Guard: CSC obrigatório
    if (!emissorCredentials.cscId || !emissorCredentials.cscToken) {
      throw new BadRequestException(
        'CSC da NFC-e não configurado. Informe o ID do CSC e o Token CSC no emissor fiscal antes de emitir NFC-e.',
      );
    }

    // Calcular totais pela soma dos itens já arredondados como vão ao XML.
    const { valorProdutos, valorDesconto, valorTotal } = totaisDosItens(
      dto.itens.map(itemNfceParaXml),
    );

    if (valorTotal <= 0) {
      throw new BadRequestException(
        'Valor total da NFC-e deve ser maior que zero.',
      );
    }

    // Calcular valor dos pagamentos
    const valorPagamentos = dto.pagamentos.reduce(
      (acc, pag) => acc + pag.valor,
      0,
    );

    // Validar pagamentos, em centavos. Sem a tolerância de um centavo que
    // havia aqui: vNF é a soma dos itens arredondados e pode passar um centavo
    // da conta da tela, e pagamento menor que vNF a SEFAZ recusa.
    const centavos = (valor: number) => Math.round(valor * 100);
    const expectedTroco =
      Math.max(0, centavos(valorPagamentos) - centavos(valorTotal)) / 100;
    const valorTroco = Number((dto.valorTroco || 0).toFixed(2));

    if (centavos(valorPagamentos) < centavos(valorTotal)) {
      throw new BadRequestException(
        'Valor dos pagamentos deve ser igual ou superior ao valor total da NFC-e.',
      );
    }

    if (Math.abs(expectedTroco - valorTroco) > 0.01) {
      throw new BadRequestException(
        'Valor do troco deve corresponder à diferença entre pagamentos e total da NFC-e.',
      );
    }

    // Guard: IBGE code obrigatório (antes de reservar número)
    let emitCmun = config.ibgeCode;
    if (!emitCmun && config.company?.address?.zipcode) {
      const cepData = await fetchCepData(config.company.address.zipcode);
      if (cepData) {
        emitCmun = cepData.codigoIbge;
      }
    }
    const parsedCmun = parseInt(emitCmun || '0', 10);
    if (!parsedCmun) {
      throw new BadRequestException(
        'Código IBGE do município do emitente não configurado ou inválido. ' +
          'Configure o código no emissor ou aguarde que o check de readiness retorne PASS.',
      );
    }

    const isContingency = !!config.contingenciaNfceAtiva;

    // Buscar dados fiscais dos produtos (antes da transação)
    const productIds = dto.itens.map((item) => item.productId).filter(Boolean);
    const fiscalDataList = await this.prisma.productFiscalData.findMany({
      where: { productId: { in: productIds } },
    });
    const fiscalDataMap = new Map(
      fiscalDataList.map((fd) => [fd.productId, fd]),
    );
    this.assertFiscalItemsReady(dto.itens, fiscalDataMap);

    // Emitir com as alíquotas de teste de 2026 numa fase de alíquotas cheias
    // subdeclararia a nota em duas ordens de grandeza.
    const reformaNfce = aliquotasReformaTributaria(config);
    if (reformaNfce.aliquotas && !reformaNfce.faseCoberta) {
      throw new BadRequestException(
        'As alíquotas de IBS/CBS da fase vigente ainda não estão confirmadas ' +
          'no sistema. Atualize as alíquotas do emissor antes de emitir com a ' +
          'Reforma Tributária ativa.',
      );
    }

    /**
     * Regime Normal calcula e destaca o imposto; o Simples segue enviando só
     * os códigos. A NFC-e é venda presencial ao consumidor dentro do estado,
     * então não há operação interestadual nem DIFAL a considerar.
     */
    const impostosCalculados = isRegimeNormal(config.emitCrt)
      ? montarImpostosNfe(
          dto.itens.map((item) => {
            const fiscal: any = item.productId
              ? fiscalDataMap.get(item.productId)
              : undefined;
            const noXml = valoresDoItemNoXml(itemNfceParaXml(item));
            return {
              valores: {
                valorProdutos: noXml.valorProduto,
                desconto: noXml.desconto,
              },
              tributacao: {
                icmsCst: item.icmsCst || fiscal?.icmsCst || '',
                icmsOrigin: fiscal?.icmsOrigin,
                icmsRate: fiscal?.icmsRate,
                icmsReducao: fiscal?.icmsReducao,
                icmsBaseModality: fiscal?.icmsBaseModality,
                pisCst: item.pisCst || fiscal?.pisCst,
                pisRate: fiscal?.pisRate,
                cofinsCst: item.cofinsCst || fiscal?.cofinsCst,
                cofinsRate: fiscal?.cofinsRate,
              },
              ipiEnquadramento: fiscal?.ipiFramework,
              cstIbsCbs: fiscal?.cstIbsCbs,
              codClassificacao: fiscal?.codClassificacao,
            };
          }),
          {
            interestadual: false,
            consumidorFinal: true,
            contribuinte: false,
            reformaTributaria: reformaNfce.aliquotas,
          },
        )
      : null;

    if (impostosCalculados?.bloqueios.length) {
      throw new BadRequestException(
        [
          'Não foi possível calcular os impostos da NFC-e:',
          ...impostosCalculados.bloqueios,
        ].join(String.fromCharCode(10)),
      );
    }

    return {
      config,
      environment,
      emissorCredentials,
      emitCmun,
      parsedCmun,
      isContingency,
      fiscalDataMap,
      impostosCalculados,
      valorProdutos,
      valorDesconto,
      valorTotal,
      // O troco é o calculado aqui (soma de vPag − vNF), e não o informado,
      // que a conferência acima aceita com um centavo de folga: o XML, a
      // linha gravada, o cupom e a prévia mostram o mesmo valor.
      valorTroco: expectedTroco,
    };
  }

  /**
   * Monta o payload da NFC-e (modelo 65).
   *
   * Não toca o banco: mesmo sendo chamada de dentro da transação que reserva
   * o número, nada aqui usa `tx`. É isso que permite à pré-visualização
   * executar a mesma montagem com um número previsto.
   */
  private buildNfceInvoicyRequest(
    dto: EmitNfceDto,
    ctx: Awaited<ReturnType<NfceService['resolveNfceEmissionContext']>>,
    numeracao: { numero: number; serie: number },
  ): InvoicyNfeRequest {
    const {
      config,
      environment,
      emissorCredentials,
      parsedCmun,
      isContingency,
      fiscalDataMap,
      impostosCalculados,
      valorProdutos,
      valorDesconto,
      valorTotal,
      valorTroco,
    } = ctx;
    const reservedNumber = numeracao.numero;
    const series = numeracao.serie;

    // Construir payload para o Invoicy (NFC-e usa modelo 65)
    const now = new Date();
    const consumidorDoc = (dto.cpfConsumidor || '').replace(/\D/g, '');
    const dest =
      consumidorDoc.length === 11 || consumidorDoc.length === 14
        ? {
            ...(consumidorDoc.length === 14
              ? { CNPJ_dest: consumidorDoc }
              : { CPF_dest: consumidorDoc }),
            xNome_dest:
              environment === 'HOMOLOGACAO'
                ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
                : dto.consumidorNome || 'CONSUMIDOR',
            indIEDest: 9,
          }
        : undefined;

    // IE: ISENTO ou dígitos
    const rawIe = (config.company.stateRegistration || '').trim();
    const emitIe =
      rawIe.toUpperCase() === 'ISENTO' ? 'ISENTO' : rawIe.replace(/\D/g, '');

    const invoicyRequest: InvoicyNfeRequest = {
      Documento: {
        ModeloDocumento: 'NFCe',
        Versao: 4,
        ide: {
          cUF: this.getUfCode(config.company.address.state),
          natOp: dto.naturezaOperacao || 'Venda de mercadoria',
          mod: '65',
          serie: series.toString(),
          nNF: reservedNumber,
          dhEmi: now.toISOString(),
          fusoHorario: '-03:00',
          tpNf: 1, // Saída
          idDest: 1, // Operação interna
          cMunFg: parsedCmun,
          tpImp: 4, // DANFE NFC-e
          tpEmis: isContingency ? 9 : 1, // 1=Normal, 9=Contingência Off-line
          cDV: 0,
          tpAmb: environment === 'PRODUCAO' ? 1 : 2,
          finNFe: 1,
          indFinal: 1, // Consumidor final
          indPres: 1, // Presença do comprador
          procEmi: 0,
          verProc: 'Atrupe 1.0',
          idCSC: emissorCredentials.cscId
            ? parseInt(emissorCredentials.cscId, 10)
            : undefined,
          CSC: emissorCredentials.cscToken || undefined,
          ...(isContingency
            ? {
                dhCont: (config.contingenciaNfceDataHora || now).toISOString(),
                xJust:
                  config.contingenciaNfceMotivo ||
                  'Problemas tecnicos de conexao',
              }
            : {}),
        },
        emit: {
          CNPJ_emit: (config.company.cnpj || '').replace(/\D/g, ''),
          xNome: config.company.legalName || '',
          IE: emitIe || undefined,
          CRT: config.emitCrt || 1,
          enderEmit: {
            xLgr: config.company.address.street || '',
            nro: config.company.address.number || 'S/N',
            xBairro: config.company.address.neighborhood || '',
            cMun: parsedCmun,
            xMun: config.company.address.city || '',
            UF: config.company.address.state || '',
            CEP:
              parseInt(
                (config.company.address.zipcode || '').replace(/\D/g, ''),
                10,
              ) || 0,
          },
        },
        ...(dest ? { dest } : {}),
        det: dto.itens.map((item, index) => {
          const fiscalData = item.productId
            ? fiscalDataMap.get(item.productId)
            : null;

          const orig =
            item.icmsOrigem !== undefined && item.icmsOrigem !== null
              ? parseInt(item.icmsOrigem, 10)
              : fiscalData?.icmsOrigin
                ? parseInt(fiscalData.icmsOrigin, 10)
                : 0;

          const icmsCst = item.icmsCst || fiscalData?.icmsCst || '102';
          const pisCst = item.pisCst || fiscalData?.pisCst || '49';
          const cofinsCst = item.cofinsCst || fiscalData?.cofinsCst || '49';
          const noXml = valoresDoItemNoXml(itemNfceParaXml(item));

          return {
            prod: {
              cProd: item.codigo || `ITEM${index + 1}`,
              cEAN: item.cean || fiscalData?.cean || 'SEM GTIN',
              cEANTrib: item.cean || fiscalData?.cean || 'SEM GTIN',
              xProd:
                environment === 'HOMOLOGACAO' && index === 0
                  ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
                  : item.descricao || `Produto ${index + 1}`,
              NCM: (item.ncm || fiscalData?.ncm || '00000000').replace(
                /\D/g,
                '',
              ),
              CEST: item.cest || fiscalData?.cest || undefined,
              CFOP: item.cfop
                ? Number(item.cfop)
                : fiscalData?.cfopInState
                  ? Number(fiscalData.cfopInState)
                  : 5102,
              uCOM: item.unidade || fiscalData?.commercialUnit || 'UN',
              qCOM: noXml.quantidade.toFixed(4),
              vUnCom: item.valorUnitario.toFixed(10),
              vProd: noXml.valorProduto.toFixed(2),
              uTrib: item.unidade || fiscalData?.commercialUnit || 'UN',
              qTrib: noXml.quantidade.toFixed(4),
              vUnTrib: item.valorUnitario.toFixed(10),
              // Desconto do item (ver o mesmo trecho da NF-e): sem ele o
              // total de desconto não batia com a soma dos itens.
              ...(noXml.desconto > 0
                ? { vDesc: noXml.desconto.toFixed(2) }
                : {}),
              indTot: 1,
            },
            imposto: impostosCalculados?.impostos[index] ?? {
              ICMS: {
                orig,
                CST: icmsCst,
              },
              PIS: {
                CST_pis: pisCst,
              },
              COFINS: {
                CST_cofins: cofinsCst,
              },
            },
          };
        }),
        total: {
          ICMStot: {
            ...(impostosCalculados?.totais ?? {
              vBC_ttlnfe: '0.00',
              vICMS_ttlnfe: '0.00',
              vBCST_ttlnfe: '0.00',
            }),
            vICMSDeson_ttlnfe: '0.00',
            vProd_ttlnfe: valorProdutos.toFixed(2),
            vFrete_ttlnfe: '0.00',
            vSeg_ttlnfe: '0.00',
            vDesc_ttlnfe: valorDesconto.toFixed(2),
            vII_ttlnfe: '0.00',
            vIPI_ttlnfe: '0.00',
            vPIS_ttlnfe: '0.00',
            vCOFINS_ttlnfe: '0.00',
            vOutro: '0.00',
            vNF: valorTotal.toFixed(2),
          },
          // Totalizador da Reforma; irmao de ICMStot, nao filho.
          ...(impostosCalculados?.ibsCbsTotais
            ? {
                IBSCBSTot: impostosCalculados.ibsCbsTotais,
                vNFIBScbsIS: calcularVNFIBScbsIS(
                  valorTotal,
                  impostosCalculados.ibsCbsTotais,
                ),
              }
            : {}),
        },
        pag: dto.pagamentos.map((pag) => ({
          tPag: pag.tipo,
          vPag: pag.valor.toFixed(2),
        })),
        // Pagamento maior que a nota exige o troco (rejeição 866 sem ele). O
        // InvoiCy não calcula: o campo é de entrada, fora do grupo `pag`.
        ...(valorTroco > 0 ? { vTroco: valorTroco.toFixed(2) } : {}),
        transp: {
          modFrete: '9',
        },
      },
    };

    return invoicyRequest;
  }

  /**
   * Pre-visualizacao da NFC-e antes de emitir.
   *
   * Roda o mesmo contexto e o mesmo montador da emissao — e o que garante que
   * o cupom conferido seja o que sera transmitido. Nao reserva numero, nao
   * cria registro, nao chama o provedor.
   *
   * Devolve 200 mesmo quando a nota nao pode sair: a previa existe para
   * mostrar o que corrigir. Quem lanca e o `emit`.
   */
  async preview(companyId: string, dto: EmitNfceDto): Promise<NfcePreview> {
    let ctx: Awaited<ReturnType<NfceService['resolveNfceEmissionContext']>>;
    let payload: InvoicyNfeRequest;

    try {
      ctx = await this.resolveNfceEmissionContext(companyId, dto);
      const numeracao = (ctx.config as any).activeNumbering?.nfce;
      payload = this.buildNfceInvoicyRequest(dto, ctx, {
        numero: numeracao?.nextNumber ?? ctx.config.proximoNumeroNfce ?? 1,
        serie: Number(numeracao?.series ?? ctx.config.serieNfce ?? 1),
      });
    } catch (error) {
      return {
        podeEmitir: false,
        bloqueios: String(error?.message ?? 'Nao foi possivel montar a nota.')
          .split(String.fromCharCode(10))
          .map((linha) => linha.trim())
          .filter(Boolean),
        avisos: [],
      };
    }

    const doc = payload.Documento;
    const avisos = [
      'Numero previsto: o definitivo e reservado no momento da emissao.',
    ];
    if (ctx.environment !== 'PRODUCAO') {
      avisos.push(
        'Ambiente de homologacao: o cupom nao tem valor fiscal e o nome do consumidor e substituido pelo texto exigido pela SEFAZ.',
      );
    }
    if (ctx.isContingency) {
      avisos.push(
        'Emissor em contingencia: o cupom sera transmitido offline e sincronizado com a SEFAZ depois.',
      );
    }
    if (!ctx.impostosCalculados) {
      avisos.push(
        'Emissor no Simples Nacional: o cupom leva so os codigos de tributacao, sem destaque de imposto.',
      );
    }

    return {
      podeEmitir: true,
      bloqueios: [],
      avisos,
      documento: {
        modelo: doc.ide.mod,
        ambiente: ctx.environment,
        numeroPrevisto: doc.ide.nNF,
        serie: doc.ide.serie,
        naturezaOperacao: doc.ide.natOp,
        contingencia: ctx.isContingency,
      },
      emitente: doc.emit,
      consumidor: doc.dest ?? null,
      itens: doc.det.map((item: any, index: number) => ({
        sequencia: index + 1,
        ...item.prod,
        tributos: item.imposto,
      })),
      totais: {
        ...doc.total,
        valorProdutos: ctx.valorProdutos,
        valorDesconto: ctx.valorDesconto,
        valorNota: ctx.valorTotal,
        valorTroco: ctx.valorTroco,
        temImpostoCalculado: !!ctx.impostosCalculados,
      },
      pagamentos: doc.pag ?? [],
      payloadInvoicy: payload,
    };
  }

  async emit(companyId: string, dto: EmitNfceDto) {
    const ctx = await this.resolveNfceEmissionContext(companyId, dto);
    const {
      config,
      environment,
      isContingency,
      valorDesconto,
      valorTotal,
      valorTroco,
    } = ctx;

    // TRANSAÇÃO ATÔMICA: Reservar número + criar registro NFC-e
    const { nfce, invoicyRequest } = await this.prisma.$transaction(
      async (tx) => {
        const { reservedNumber, series } =
          await this.fiscalCredentialResolver.reserveNfceNumber(
            tx,
            config.id,
            environment,
          );

        const invoicyRequest = this.buildNfceInvoicyRequest(dto, ctx, {
          numero: reservedNumber,
          serie: series,
        });

        const ambiente = environment === 'PRODUCAO' ? 1 : 2;
        // null explícito em vez de undefined: no reaproveitamento abaixo,
        // undefined manteria o pedido/orçamento da tentativa anterior.
        const dados = {
          companyId,
          invoicyConfigId: config.id,
          orderId: dto.orderId ?? null,
          quotationId: dto.quotationId ?? null,
          numero: reservedNumber,
          serie: series,
          status: isContingency
            ? NfceStatus.CONTINGENCY
            : NfceStatus.PROCESSING,
          ambiente,
          valorTotal,
          valorDesconto,
          valorTroco,
          formaPagamento: dto.pagamentos[0]?.tipo || '01',
          cpfConsumidor: dto.cpfConsumidor || null,
          consumidorNome: dto.consumidorNome || null,
          informacoesComplementares:
            dto.informacoesComplementares || config.taxInfoText || null,
          itensSnapshot: dto.itens as any,
          pagamentosSnapshot: dto.pagamentos as any,
          invoicyPayloadEnvio: invoicyRequest as any,
        };

        // Um número devolvido por releaseRejectedNfceNumber volta com a linha
        // REJECTED da tentativa anterior ainda ocupando (companyId, numero,
        // serie, ambiente). Criar outra linha batia no unique
        // nfce_unique_emission e, como a reserva era desfeita junto, TODA
        // emissão seguinte do emissor parava no mesmo número.
        const tentativaRejeitada = await this.findReusableRejectedNfce(tx, {
          companyId,
          numero: reservedNumber,
          serie: series,
          ambiente,
        });

        // A linha é a NFC-e nº N do emissor: a tentativa rejeitada nunca
        // existiu na SEFAZ e a nova emissão toma o lugar dela. O createdAt
        // renova porque a listagem filtra e ordena por ele.
        const nfce = tentativaRejeitada
          ? await tx.nfce.update({
              where: {
                id: tentativaRejeitada.id,
                status: NfceStatus.REJECTED,
                protocolo: null,
              },
              data: {
                ...dados,
                ...NFCE_CAMPOS_DA_TENTATIVA_ZERADOS,
                createdAt: new Date(),
              },
            })
          : await tx.nfce.create({ data: dados });

        return { nfce, invoicyRequest };
      },
    );

    try {
      this.logger.log(
        `Emitindo NFC-e ${nfce.numero}/${environment} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy
      const invoicyResponses = await this.invoicyApiService.emitNfe(
        companyId,
        [invoicyRequest],
        config.id,
        environment,
      );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        // O provedor RESPONDEU e recusou o lote (ex.: 607, licença de NFC-e
        // cancelada no Invoicy): o documento não foi processado e não chegou
        // à SEFAZ, então o resultado é conclusivo e o número continua livre.
        // Lançado como Error comum, caía no catch sem `error.response` e era
        // lido como falha de transporte — a nota ficava em UNKNOWN, o usuário
        // via "falha de comunicação" e o motivo real só existia no log.
        const motivo = this.describeProviderRefusal(response);
        const orientacao = orientacaoRejeicaoFiscal({
          origem: 'PROVEDOR',
          codigo: response.Codigo,
          modelo: 'NFC-e',
        });
        await this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.REJECTED,
            motivoRejeicao: motivoComOrientacao(motivo, orientacao),
          },
        });
        await this.releaseRejectedNfceNumber(
          config.id,
          environment,
          nfce.numero,
        );
        this.logger.warn(
          `Emissão NFC-e ${nfce.numero}/${environment} recusada pelo Invoicy (código ${response.Codigo})`,
        );
        throw new BadRequestException(
          mensagemComOrientacao(
            `NFC-e recusada pelo Invoicy: ${motivo}`,
            orientacao,
          ),
        );
      }

      const doc = response.Documentos?.[0];
      if (!doc) {
        throw new Error('Documento não retornado pelo Invoicy');
      }

      const situacao = doc.Situacao;
      const isAuthorized =
        situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;

      const targetStatus = isContingency
        ? NfceStatus.CONTINGENCY
        : isAuthorized
          ? NfceStatus.AUTHORIZED
          : NfceStatus.REJECTED;

      // Recusa cuja providência está fora da nota (habilitação, CSC): o texto
      // da SEFAZ sozinho não diz a quem recorrer.
      const orientacao = isAuthorized
        ? null
        : orientacaoRejeicaoFiscal({
            origem: 'SEFAZ',
            codigo: situacao?.SitCodigo,
            modelo: 'NFC-e',
          });

      // Atualizar NFC-e com resposta
      const updatedNfce = await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: targetStatus,
          chaveAcesso: doc.DocChaAcesso || null,
          protocolo: doc.DocProtocolo || null,
          invoicyId: doc.DocIDUnico || null,
          invoicyProtocol: doc.DocProtocolo || null,
          dataEmissao: new Date(),
          dataAutorizacao: isAuthorized ? new Date() : null,
          qrCodeUrl: doc.DocCompleto || null,
          urlConsulta: doc.DocPDFDownload || null,
          danfeUrl: doc.DocPDFDownload || null,
          xmlAutorizado: doc.DocXMLBase64
            ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
            : null,
          motivoRejeicao: !isAuthorized
            ? motivoComOrientacao(situacao?.SitDescricao, orientacao)
            : null,
        },
      });

      if (!isAuthorized) {
        // Resposta CONCLUSIVA da SEFAZ: a nota nao foi autorizada, entao o
        // numero continua livre. Devolver aqui e o unico ponto seguro — no
        // catch abaixo cai tambem falha de transporte, onde a nota PODE ter
        // sido autorizada.
        //
        // Excecoes: sem cStat nao ha prova de recusa; denegacao, duplicidade
        // e afins (CSTAT_NUMERO_CONSUMIDO) dizem que o numero tem dono; e a
        // linha em contingencia segue valendo como documento. Devolver nesses
        // casos mandaria a proxima emissao para um numero ocupado.
        const cStat = Number(situacao?.SitCodigo);
        const numeroLivre =
          !isContingency &&
          Number.isFinite(cStat) &&
          !CSTAT_NUMERO_CONSUMIDO.has(cStat);
        if (numeroLivre) {
          await this.releaseRejectedNfceNumber(
            config.id,
            environment,
            nfce.numero,
          );
        }

        throw new BadRequestException(
          mensagemComOrientacao(
            `NFC-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}`,
            orientacao,
          ),
        );
      }

      return updatedNfce;
    } catch (error) {
      // Rejeição fiscal que nós mesmos lançamos acima: o status REJECTED e a
      // descrição da SEFAZ já foram gravados. Sem este repasse o fluxo abaixo
      // regravava motivoRejeicao com a mensagem já prefixada e relançava com
      // prefixo duplo ("NFC-e rejeitada: NFC-e rejeitada: ...").
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Erros de programação (RangeError, TypeError...) nunca são falha de
      // transporte; sem esta exclusão viravam "resultado desconhecido" e
      // deixavam a NFC-e em UNKNOWN, escondendo a causa real.
      const isProgrammingError =
        error instanceof TypeError ||
        error instanceof RangeError ||
        error instanceof ReferenceError ||
        error instanceof SyntaxError;

      // Distinguir erro de transporte de rejeição fiscal
      const isUnknownOutcome =
        !isProgrammingError &&
        (error?.code === 'ECONNABORTED' ||
          error?.code === 'ECONNRESET' ||
          error?.code === 'ETIMEDOUT' ||
          error?.response === undefined ||
          error?.response?.status >= 500);

      const newStatus = isUnknownOutcome
        ? NfceStatus.UNKNOWN
        : NfceStatus.REJECTED;
      const motivoRejeicao = isUnknownOutcome
        ? 'Erro de transporte — resultado desconhecido'
        : this.extractSafeErrorMessage(error);

      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: newStatus,
          motivoRejeicao,
        },
      });

      // Log sem secrets: apenas número, série, ambiente, status
      this.logger.error(
        `Emissão NFC-e ${nfce.numero}/${environment} falhou (${newStatus}): ${error?.code ?? error?.constructor?.name}`,
      );

      // Stack de erro de programação não carrega payload nem credenciais, e sem
      // ele um bug de código fica indiagnosticável nos logs.
      if (isProgrammingError) {
        this.logger.error(error.stack);
      }

      if (isUnknownOutcome) {
        throw new BadRequestException(
          'Falha de comunicação com o Invoicy. A NFC-e está em estado DESCONHECIDO — ' +
            'use o endpoint de reprocessamento para verificar o resultado antes de reemitir.',
        );
      }
      throw new BadRequestException(`NFC-e rejeitada: ${motivoRejeicao}`);
    }
  }

  /**
   * Devolve a sequencia ao numero reservado quando a SEFAZ rejeita a NFC-e ou
   * o provedor recusa o lote.
   *
   * A reserva e atomica e acontece ANTES da transmissao — e isso que impede
   * duas emissoes concorrentes de montarem o payload com o mesmo numero. O
   * custo e que toda rejeicao queima um numero: a nota nunca existiu na SEFAZ,
   * mas a sequencia ja andou, e o vao resultante so se regulariza com
   * inutilizacao. Reaproveitar numero de nota rejeitada e legitimo.
   *
   * A linha REJECTED continua com o numero; quem o reservar de novo
   * reaproveita essa linha (findReusableRejectedNfce) em vez de criar outra.
   *
   * O UPDATE e condicional de proposito: so devolve se a sequencia ainda
   * estiver exatamente em `numero + 1`, ou seja, se ninguem reservou no
   * meio-tempo. Se outra emissao ja avancou, devolver reordenaria a numeracao
   * — pior que o vao. Nesse caso o numero fica vago e exige inutilizacao.
   *
   * NUNCA chamar em falha de transporte ou timeout: ali a nota PODE ter sido
   * autorizada sem que a resposta chegasse, e devolver o numero levaria direto
   * a rejeicao 539 (duplicidade) na proxima emissao.
   */
  private async releaseRejectedNfceNumber(
    invoicyConfigId: string,
    environment: string,
    reservedNumber: number,
  ): Promise<void> {
    try {
      const released = await this.prisma.$executeRaw`
        UPDATE invoicy_environment_configs
        SET "nfceNextNumber" = ${reservedNumber}
        WHERE "invoicyConfigId" = ${invoicyConfigId}
          AND environment = ${environment}::"FiscalEnvironment"
          AND "docType" = 'NFCE'::"FiscalDocType"
          AND "nfceNextNumber" = ${reservedNumber + 1}
      `;

      if (released > 0) {
        this.logger.log(
          `Numero ${reservedNumber} devolvido a sequencia de NFC-e (${environment}) apos rejeicao da SEFAZ.`,
        );
      } else {
        this.logger.log(
          `Numero ${reservedNumber} nao devolvido: a sequencia de NFC-e (${environment}) ja avancou. ` +
            'O numero fica vago e precisara de inutilizacao.',
        );
      }
    } catch (error) {
      // Best-effort: devolver numero nunca pode mascarar a rejeicao original,
      // que e o que o usuario precisa ver.
      this.logger.warn(
        `Falha ao devolver o numero ${reservedNumber} a sequencia de NFC-e: ${error.message}`,
      );
    }
  }

  /**
   * Quem ocupa o número recém-reservado, se alguém ocupa.
   *
   * Só uma tentativa REJECTED sem protocolo cede o lugar: rejeição da SEFAZ
   * não gera protocolo (nenhuma das 223 NF-e e 5 NFC-e rejeitadas em produção
   * em 16/10/2026 tinha um), enquanto autorização e denegação geram — e aí o
   * documento existe na SEFAZ. Qualquer outro ocupante quer dizer que a
   * sequência ficou atrás de uma nota real; emitir com o número dela só
   * renderia duplicidade, então a emissão para com uma mensagem acionável em
   * vez do P2002 cru do unique.
   */
  private async findReusableRejectedNfce(
    tx: Prisma.TransactionClient,
    chave: {
      companyId: string;
      numero: number;
      serie: number;
      ambiente: number;
    },
  ): Promise<{ id: string } | null> {
    const ocupante = await tx.nfce.findUnique({
      where: { nfce_unique_emission: chave },
      select: { id: true, status: true, protocolo: true },
    });
    if (!ocupante) {
      return null;
    }

    if (ocupante.status === NfceStatus.REJECTED && !ocupante.protocolo) {
      this.logger.log(
        `NFC-e ${chave.numero}/${chave.serie} reaproveita a linha da tentativa rejeitada ${ocupante.id}`,
      );
      return { id: ocupante.id };
    }

    throw new ConflictException(
      `O próximo número de NFC-e (${chave.numero}, série ${chave.serie}) já pertence a uma nota com status ${ocupante.status}. ` +
        'Ajuste o próximo número em Configurações > Emissores, na aba do documento, com o ambiente correto selecionado.',
    );
  }

  /**
   * Motivo de uma recusa do provedor no nível do lote (`Codigo` ≠ 100), com o
   * código junto: é por ele que o suporte do Invoicy localiza o caso.
   */
  private describeProviderRefusal(response: InvoicyResponse): string {
    const descricao = (response.Descricao || response.ErrorInvoicy || '')
      .trim()
      .slice(0, 500);
    return descricao
      ? `${descricao} (código ${response.Codigo})`
      : `Código ${response.Codigo} sem descrição`;
  }

  private extractSafeErrorMessage(error: any): string {
    const structured =
      error?.response?.data?.Descricao ||
      error?.response?.data?.descricao ||
      error?.response?.data?.Mensagem ||
      error?.response?.data?.mensagem ||
      error?.response?.data?.message ||
      error?.message;

    return typeof structured === 'string' && structured.trim()
      ? structured.trim().slice(0, 500)
      : 'Erro fiscal desconhecido';
  }

  private async assertOrderCanReceiveNfce(
    companyId: string,
    orderId: string,
    ambiente: number,
  ) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        quotation: { companyId },
      },
      select: {
        id: true,
        status: true,
        quotationId: true,
        nfes: {
          where: {
            ambiente,
            status: {
              in: [
                NfeStatus.AUTHORIZED,
                NfeStatus.CORRECTION_SENT,
                NfeStatus.DRAFT,
                NfeStatus.PROCESSING,
                NfeStatus.PENDING,
              ],
            },
          },
          select: { id: true, status: true },
          take: 1,
        },
        nfeOrders: {
          where: {
            nfe: {
              ambiente,
              status: {
                in: [
                  NfeStatus.AUTHORIZED,
                  NfeStatus.CORRECTION_SENT,
                  NfeStatus.DRAFT,
                  NfeStatus.PROCESSING,
                  NfeStatus.PENDING,
                ],
              },
            },
          },
          select: { id: true },
          take: 1,
        },
        nfses: {
          where: {
            ambiente,
            status: {
              in: [
                NfseStatus.AUTHORIZED,
                NfseStatus.DRAFT,
                NfseStatus.PROCESSING,
                NfseStatus.PENDING,
              ],
            },
          },
          select: { id: true, status: true },
          take: 1,
        },
        nfces: {
          where: {
            ambiente,
            status: {
              in: [
                NfceStatus.AUTHORIZED,
                NfceStatus.PROCESSING,
                NfceStatus.UNKNOWN,
                NfceStatus.CONTINGENCY,
                NfceStatus.PENDING,
              ],
            },
          },
          select: { id: true, status: true },
          take: 1,
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Ordem de servico nao encontrada.');
    }

    if (order.status === OrderStatus.CANCELED) {
      throw new BadRequestException(
        'Nao e possivel emitir NFC-e para uma ordem de servico cancelada.',
      );
    }

    if (
      order.nfes.length > 0 ||
      order.nfeOrders.length > 0 ||
      order.nfses.length > 0 ||
      order.nfces.length > 0
    ) {
      throw new ConflictException(
        'Esta ordem de servico ja possui documento fiscal ativo ou autorizado.',
      );
    }

    return order;
  }

  private assertFiscalItemsReady(
    itens: EmitNfceDto['itens'],
    fiscalDataMap: Map<string, any>,
  ) {
    for (const [index, item] of itens.entries()) {
      const fiscalData = item.productId
        ? fiscalDataMap.get(item.productId)
        : null;
      const label = item.descricao || `Item ${index + 1}`;
      const ncm = (item.ncm || fiscalData?.ncm || '').replace(/\D/g, '');
      const cfop = (item.cfop || fiscalData?.cfopInState || '').replace(
        /\D/g,
        '',
      );
      const unidade = item.unidade || fiscalData?.commercialUnit;
      const icmsCst = item.icmsCst || fiscalData?.icmsCst;
      const pisCst = item.pisCst || fiscalData?.pisCst;
      const cofinsCst = item.cofinsCst || fiscalData?.cofinsCst;

      if (ncm.length !== 8 || ncm === '00000000') {
        throw new BadRequestException(
          `Dados fiscais incompletos para ${label}: informe um NCM valido.`,
        );
      }

      if (cfop.length !== 4) {
        throw new BadRequestException(
          `Dados fiscais incompletos para ${label}: informe um CFOP valido.`,
        );
      }

      if (!unidade) {
        throw new BadRequestException(
          `Dados fiscais incompletos para ${label}: informe a unidade comercial.`,
        );
      }

      if (!icmsCst || !pisCst || !cofinsCst) {
        throw new BadRequestException(
          `Dados fiscais incompletos para ${label}: informe CST/CSOSN, PIS e COFINS.`,
        );
      }
    }
  }

  /**
   * Helper method to get UF numeric code
   */
  private getUfCode(uf: string): number {
    const ufCodes: Record<string, number> = {
      RO: 11,
      AC: 12,
      AM: 13,
      RR: 14,
      PA: 15,
      AP: 16,
      TO: 17,
      MA: 21,
      PI: 22,
      CE: 23,
      RN: 24,
      PB: 25,
      PE: 26,
      AL: 27,
      SE: 28,
      BA: 29,
      MG: 31,
      ES: 32,
      RJ: 33,
      SP: 35,
      PR: 41,
      SC: 42,
      RS: 43,
      MS: 50,
      MT: 51,
      GO: 52,
      DF: 53,
    };
    return ufCodes[uf?.toUpperCase()] || 43;
  }

  async reprocess(id: string, companyId: string) {
    return this.reprocessWithAtomicClaim(id, companyId);
  }
  private async reprocessWithAtomicClaim(id: string, companyId: string) {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const claimed = await this.prisma.nfce.updateMany({
      where: {
        id,
        companyId,
        OR: [
          { status: NfceStatus.UNKNOWN },
          { status: NfceStatus.PROCESSING, updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: NfceStatus.PROCESSING,
        motivoRejeicao: null,
      },
    });

    if (claimed.count !== 1) {
      const current = await this.findById(id, companyId);
      throw new ConflictException(
        `NFC-e nao esta disponivel para reprocessamento. Status atual: ${current.status}`,
      );
    }

    const nfce = await this.findById(id, companyId);

    if (!nfce.invoicyPayloadEnvio || !nfce.invoicyConfigId) {
      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.UNKNOWN,
          motivoRejeicao:
            'Payload original ou emissor ausente; reprocessamento automatico bloqueado',
        },
      });
      throw new BadRequestException(
        'Impossivel reprocessar: payload original ou emissor nao encontrado. Faca consulta manual antes de qualquer nova emissao.',
      );
    }

    const emissor = await this.prisma.invoicyConfig.findFirst({
      where: { id: nfce.invoicyConfigId, companyId },
      select: { id: true },
    });
    if (!emissor) {
      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.UNKNOWN,
          motivoRejeicao:
            'Emissor original nao encontrado; reprocessamento automatico bloqueado',
        },
      });
      throw new BadRequestException(
        'Emissor original da NFC-e nao encontrado para esta empresa.',
      );
    }

    if (nfce.chaveAcesso) {
      const responses = await this.invoicyApiService.consultNfeSefaz(
        companyId,
        nfce.chaveAcesso,
        nfce.invoicyConfigId,
      );
      const doc = responses[0]?.Documentos?.[0];
      const situacao = doc?.Situacao;

      if (situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150) {
        return this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.AUTHORIZED,
            protocolo: doc.DocProtocolo || nfce.protocolo,
            dataAutorizacao: new Date(),
            motivoRejeicao: null,
          },
        });
      }

      if (
        situacao &&
        situacao.SitCodigo !== 100 &&
        situacao.SitCodigo !== 150
      ) {
        return this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.REJECTED,
            motivoRejeicao: motivoComOrientacao(
              situacao.SitDescricao,
              orientacaoRejeicaoFiscal({
                origem: 'SEFAZ',
                codigo: situacao.SitCodigo,
                modelo: 'NFC-e',
              }),
            ),
          },
        });
      }
    }

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        nfce.invoicyConfigId,
        'NFCE',
      );

    try {
      this.logger.log(
        `Reprocessando NFC-e ${nfce.numero}/${environment} (id: ${nfce.id})`,
      );

      const invoicyResponses = await this.invoicyApiService.emitNfe(
        companyId,
        [nfce.invoicyPayloadEnvio as any],
        nfce.invoicyConfigId,
        environment,
      );

      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        // O provedor recusou ESTE reenvio, que não foi processado. Isso não
        // diz nada sobre a transmissão original — foi ela que deixou a nota
        // em UNKNOWN —, então a nota continua desconhecida. O que muda é o
        // motivo: sem esta checagem a recusa virava "Documento nao
        // retornado", lida como falha de comunicação, e o usuário era
        // mandado tentar de novo contra uma recusa que não passa sozinha.
        const motivo = this.describeProviderRefusal(response);
        const orientacao = orientacaoRejeicaoFiscal({
          origem: 'PROVEDOR',
          codigo: response.Codigo,
          modelo: 'NFC-e',
        });
        await this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.UNKNOWN,
            motivoRejeicao: motivoComOrientacao(
              `Reenvio recusado pelo Invoicy: ${motivo}`,
              orientacao,
            ),
          },
        });
        throw new BadRequestException(
          mensagemComOrientacao(
            `O Invoicy recusou o reenvio da NFC-e: ${motivo}. ` +
              'A nota continua com resultado desconhecido; resolva a recusa antes de reprocessar.',
            orientacao,
          ),
        );
      }

      const doc = response.Documentos?.[0];
      if (!doc) {
        throw new Error('Documento nao retornado pelo Invoicy');
      }

      const situacao = doc.Situacao;
      const isAuthorized =
        situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;
      const payload = nfce.invoicyPayloadEnvio as any;
      const isContingency =
        payload?.Documento?.ide?.tpEmis === 9 || nfce.contingencia;

      const targetStatus = isContingency
        ? NfceStatus.CONTINGENCY
        : isAuthorized
          ? NfceStatus.AUTHORIZED
          : NfceStatus.REJECTED;

      return this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: targetStatus,
          chaveAcesso: doc.DocChaAcesso || nfce.chaveAcesso,
          protocolo: doc.DocProtocolo || nfce.protocolo,
          invoicyId: doc.DocIDUnico || nfce.invoicyId,
          invoicyProtocol: doc.DocProtocolo || nfce.invoicyProtocol,
          dataAutorizacao: isAuthorized ? new Date() : nfce.dataAutorizacao,
          qrCodeUrl: doc.DocCompleto || nfce.qrCodeUrl,
          danfeUrl: doc.DocPDFDownload || nfce.danfeUrl,
          xmlAutorizado: doc.DocXMLBase64
            ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
            : nfce.xmlAutorizado,
          motivoRejeicao: !isAuthorized
            ? motivoComOrientacao(
                situacao?.SitDescricao,
                orientacaoRejeicaoFiscal({
                  origem: 'SEFAZ',
                  codigo: situacao?.SitCodigo,
                  modelo: 'NFC-e',
                }),
              )
            : null,
        },
      });
    } catch (error) {
      // Recusa do provedor que nós mesmos lançamos acima, com status e motivo
      // já gravados. HttpException tem `response` (o corpo do erro) sem
      // `status`, então sem este repasse ela cairia no ramo de rejeição
      // abaixo e a nota viraria REJECTED.
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Erros de programação (RangeError, TypeError...) nunca são falha de
      // transporte; sem esta exclusão mantinham a NFC-e em UNKNOWN e pediam
      // nova tentativa, escondendo a causa real.
      const isProgrammingError =
        error instanceof TypeError ||
        error instanceof RangeError ||
        error instanceof ReferenceError ||
        error instanceof SyntaxError;

      if (isProgrammingError) {
        this.logger.error(error.stack);
      }

      const isUnknownOutcome =
        !isProgrammingError &&
        (error?.code === 'ECONNABORTED' ||
          error?.code === 'ECONNRESET' ||
          error?.code === 'ETIMEDOUT' ||
          error?.response === undefined ||
          error?.response?.status >= 500);

      if (isUnknownOutcome) {
        await this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.UNKNOWN,
            motivoRejeicao:
              'Erro de comunicacao/provedor no reprocessamento - resultado desconhecido',
          },
        });
        throw new BadRequestException(
          'Falha de comunicacao novamente. A NFC-e permanece em estado DESCONHECIDO. Tente novamente em alguns instantes.',
        );
      }

      const safeReason = this.extractSafeErrorMessage(error);
      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.REJECTED,
          motivoRejeicao: safeReason,
        },
      });
      throw new BadRequestException(`Reprocessamento falhou: ${safeReason}`);
    }
  }

  async cancel(id: string, companyId: string, dto: CancelNfceDto) {
    const nfce = await this.findById(id, companyId);

    if (nfce.status !== NfceStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Apenas NFC-e autorizadas podem ser canceladas',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    // Prazo do emissor que REALMENTE emitiu a nota, não do emissor padrão da
    // empresa. O prazo varia por UF e emissores podem estar em UFs distintas;
    // usar o padrão daria o prazo errado para notas de outro emissor.
    const config = nfce.invoicyConfigId
      ? await this.prisma.invoicyConfig.findFirst({
          where: { id: nfce.invoicyConfigId, companyId },
          select: { prazoCancelamentoNfce: true },
        })
      : await this.invoicyService.getConfig(companyId);
    const prazoMinutos = config?.prazoCancelamentoNfce ?? 30;

    const minutosDaEmissao =
      (Date.now() - new Date(nfce.dataEmissao).getTime()) / (1000 * 60);
    if (minutosDaEmissao > prazoMinutos) {
      throw new BadRequestException(
        `O prazo para cancelamento de NFC-e foi excedido (${prazoMinutos} minutos)`,
      );
    }

    try {
      this.logger.log(
        `Cancelando NFC-e ${nfce.numero} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy para cancelamento (NFC-e usa mesmo endpoint que NF-e).
      // `nfce.ambiente` garante que o evento vá ao MESMO ambiente da emissão —
      // um emissor promovido de homologação para produção cancelaria no
      // ambiente errado sem isso.
      const invoicyResponses = await this.invoicyApiService.cancelNfe(
        companyId,
        nfce.chaveAcesso,
        dto.justificativa,
        nfce.ambiente,
        {
          numero: nfce.numero,
          serie: nfce.serie,
          invoicyConfigId: nfce.invoicyConfigId ?? undefined,
        },
      );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: código ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isCancelled =
        situacao?.SitCodigo === 135 || situacao?.SitCodigo === 101;

      if (!isCancelled) {
        throw new Error(
          situacao?.SitDescricao || 'Cancelamento não autorizado pela SEFAZ',
        );
      }

      const updatedNfce = await this.prisma.nfce.update({
        where: { id },
        data: {
          status: NfceStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
          protocoloCancelamento: doc?.DocProtocolo || null,
        },
      });

      return updatedNfce;
    } catch (error) {
      this.logger.error(
        `Erro ao cancelar NFC-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Erro ao cancelar NFC-e: ${error.message}`);
    }
  }

  async inutilizar(companyId: string, dto: InutilizarNfceDto) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuração do Invoicy não encontrada.');
    }

    // Inutilização é evento fiscal: exige ambiente formalmente ativado, igual
    // à emissão. Sem isso a chamada falharia tarde, com erro genérico do
    // Invoicy, depois do usuário já ter confirmado a faixa.
    const environment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
        config,
        'NFCE',
      );
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFCE',
    );

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    if (dto.numeroInicial > dto.numeroFinal) {
      throw new BadRequestException(
        'Número inicial deve ser menor ou igual ao número final',
      );
    }

    try {
      this.logger.log(
        `Inutilizando NFC-e ${dto.numeroInicial} a ${dto.numeroFinal} para empresa ${companyId}`,
      );

      // Série do AMBIENTE em uso, não a legada global: inutilizar a faixa da
      // série errada não protege a numeração que está de fato sendo emitida.
      const envCreds =
        await this.fiscalCredentialResolver.getEmissorCredentialsForValidation(
          companyId,
          config.id,
          environment,
        );
      const serie = envCreds.nfceSeries ?? config.serieNfce ?? 1;

      const invoicyResponses = await this.invoicyApiService.inutilizarNfce(
        companyId,
        serie,
        dto.numeroInicial,
        dto.numeroFinal,
        dto.justificativa,
        config.id,
      );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: código ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isInutilized = situacao?.SitCodigo === 102;

      if (!isInutilized) {
        throw new Error(
          situacao?.SitDescricao || 'Inutilização não autorizada pela SEFAZ',
        );
      }

      return {
        success: true,
        message: `Numeração ${dto.numeroInicial} a ${dto.numeroFinal} inutilizada com sucesso`,
        numeroInicial: dto.numeroInicial,
        numeroFinal: dto.numeroFinal,
        protocolo: doc?.DocProtocolo || null,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao inutilizar NFC-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao inutilizar NFC-e: ${error.message}`,
      );
    }
  }

  async toggleContingencia(companyId: string, dto: ContingenciaNfceDto) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuração do Invoicy não encontrada.');
    }

    const updatedConfig = await this.prisma.invoicyConfig.update({
      where: { id: config.id },
      data: {
        contingenciaNfceAtiva: dto.ativar ?? false,
        contingenciaNfceMotivo: dto.ativar ? dto.motivo : null,
        contingenciaNfceDataHora: dto.ativar ? new Date() : null,
      },
    });

    this.logger.log(
      `${dto.ativar ? 'Ativando' : 'Desativando'} contingência para empresa ${companyId}`,
    );

    return {
      success: true,
      contingenciaAtiva: updatedConfig.contingenciaNfceAtiva,
      motivo: updatedConfig.contingenciaNfceMotivo,
      dataHora: updatedConfig.contingenciaNfceDataHora,
    };
  }

  async consultStatus(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.chaveAcesso) {
      return {
        id: nfce.id,
        numero: nfce.numero,
        serie: nfce.serie,
        status: nfce.status,
        statusDescription: 'Chave de acesso não disponível para consulta',
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      this.logger.log(`Consultando status real NFC-e ${nfce.numero} na SEFAZ`);

      const invoicyResponses = await this.invoicyApiService.consultNfeSefaz(
        companyId,
        nfce.chaveAcesso,
        nfce.invoicyConfigId || undefined,
      );

      const response = invoicyResponses[0];
      const doc = response?.Documentos?.[0];
      const situacao = doc?.Situacao;

      let newStatus = null;
      if (situacao?.SitCodigo) {
        const map: Record<number, string> = {
          100: 'AUTHORIZED',
          101: 'CANCELLED',
          102: 'CANCELLED',
          135: 'CANCELLED',
          204: 'AUTHORIZED',
          217: 'REJECTED',
        };
        newStatus = map[situacao.SitCodigo];
      }

      let currentStatus = nfce.status;
      if (newStatus && newStatus !== nfce.status) {
        this.logger.log(
          `Status NFC-e ${nfce.numero} mudou: ${nfce.status} → ${newStatus}`,
        );

        await this.prisma.nfce.update({
          where: { id: nfce.id },
          data: { status: newStatus as any },
        });
        currentStatus = newStatus as any;
      }

      return {
        id: nfce.id,
        numero: nfce.numero,
        serie: nfce.serie,
        status: currentStatus,
        statusChanged: newStatus !== nfce.status,
        sefazCode: situacao?.SitCodigo,
        sefazDescription: situacao?.SitDescricao,
        chaveAcesso: nfce.chaveAcesso,
        protocolo: nfce.protocolo,
        dataEmissao: nfce.dataEmissao,
        dataAutorizacao: nfce.dataAutorizacao,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status NFC-e ${nfce.numero}: ${error.message}`,
        error.stack,
      );
      return {
        id: nfce.id,
        numero: nfce.numero,
        serie: nfce.serie,
        status: nfce.status,
        sefazError: error.message,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async getDanfeUrl(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.danfeUrl) {
      // TODO: Buscar DANFE da API do Invoicy se não estiver armazenado
      throw new NotFoundException('DANFE não disponível para esta NFC-e');
    }

    return { url: nfce.danfeUrl };
  }

  async getXml(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.xmlAutorizado) {
      // TODO: Buscar XML da API do Invoicy se não estiver armazenado
      throw new NotFoundException('XML não disponível para esta NFC-e');
    }

    return { xml: nfce.xmlAutorizado };
  }

  async getQrCode(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.qrCodeUrl) {
      throw new NotFoundException('QR Code não disponível para esta NFC-e');
    }

    return { url: nfce.qrCodeUrl };
  }
}
