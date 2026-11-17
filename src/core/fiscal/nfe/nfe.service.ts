import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { createHash } from 'crypto';
import {
  FiscalEnvironment,
  NfeStatus,
  NfseStatus,
  NfeCorrectionStatus,
  OrderStatus,
} from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { ProductFiscalService } from '../product-fiscal/product-fiscal.service';
import { NfeEmailService } from './nfe-email.service';
import {
  InvoicyDocumentResult,
  InvoicyDocumentEvent,
  InvoicyNfeRequest,
  InvoicyResponse,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import { fetchCepData } from '../utils/cep.util';
import { getTPag } from '../utils/payment-method-map';
import {
  arredondar,
  totaisDosItens,
  totalDoItemNaNota,
  valoresDaLinhaParaNota,
  valoresDoItemNoXml,
} from '../utils/fiscal-line-values.util';
import {
  normalizeFiscalStrings,
  sanitizeFiscalText,
  sanitizeInfCpl,
} from '../utils/fiscal-text.util';
import {
  parseProjectDayBoundary,
  toProjectDateKey,
} from '../utils/project-date.util';
import { aliquotaInterestadual as aliquotaInterestadualIcms } from '../utils/icms-interestadual.util';
import { resolverMva } from '../utils/icms-st.util';
import { codigosCstDeOutroRegime } from '../utils/icms-cst.util';
import {
  isOptanteSimples,
  isRegimeNormal,
} from '../utils/regime-tributario.util';
import {
  avaliarPrazoCancelamento,
  orientacaoRejeicaoCancelamento,
} from '../utils/prazo-cancelamento.util';
import {
  montarImpostosNfe,
  type ImpostosNfeMontados,
  type ItemParaCalculo,
} from '../utils/nfe-imposto-payload.util';
import type { IbsCbsAliquotas } from '../utils/ibs-cbs.util';
import {
  aliquotasReformaTributaria,
  calcularVNFIBScbsIS,
} from '../utils/ibs-cbs-nfe.util';
import { IcmsAliquotaInternaService } from '../shared/icms-aliquota-interna.service';
import {
  mensagemComOrientacao,
  orientacaoRejeicaoFiscal,
} from '../utils/orientacao-rejeicao.util';
import {
  EmitNfeDto,
  EmitNfeFromOrderDto,
  CancelNfeDto,
  InutilizarNfeDto,
  NfeFilterDto,
  UpdateNfeDraftDto,
} from './dtos/nfe.dto';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';

/** Leituras e validações comuns a emitir e pré-visualizar. */
interface NfeEmissionContext {
  config: any;
  environment: FiscalEnvironment;
  isForeign: boolean;
  cleanReferencedNfe: string;
  now: Date;
  dataSaida: Date;
  destCmun: number;
  destUfFromCep: string;
  destMunFromCep: string;
}

/** Resultado da montagem do payload, antes de qualquer efeito. */
interface NfeMontagem {
  invoicyRequest: InvoicyNfeRequest;
  impostosCalculados: ImpostosNfeMontados | null;
  resolvedCfops: number[];
  tipoDocumento: number;
  valorProdutos: number;
  valorTotal: number;
  emitCmun?: string | null;
  /** IBGE do emitente descoberto pelo CEP; quem chama decide se persiste. */
  emitCmunResolvidoViaCep?: string;
  avisos: string[];
}

/**
 * Pré-visualização da NF-e: o mesmo payload que seria transmitido, sem
 * reservar número nem criar registro.
 */
export interface NfePreview {
  podeEmitir: boolean;
  bloqueios: string[];
  avisos: string[];
  documento?: {
    modelo: string;
    ambiente: FiscalEnvironment;
    /** Número previsto; o definitivo só é reservado na emissão. */
    numeroPrevisto: number;
    serie: string;
    naturezaOperacao: string;
    tipo: number;
    finalidade: number;
    idDest: number;
    indFinal: number;
    indPres: number;
    dataEmissaoPrevista: string;
    dataSaidaEntrada?: string;
    nfeReferenciada?: string;
  };
  emitente?: Record<string, any>;
  /** Logo e contato: aparecem na DANFE, mas não viajam no payload. */
  emitenteContato?: {
    logoUrl: string | null;
    fone: string | null;
    email: string | null;
  };
  destinatario?: Record<string, any>;
  entrega?: Record<string, any> | null;
  itens?: Array<Record<string, any>>;
  totais?: Record<string, any>;
  transporte?: Record<string, any>;
  pagamento?: Record<string, any>;
  duplicatas?: Array<Record<string, any>>;
  autXml?: Array<Record<string, any>>;
  informacoesComplementares?: string | null;
  /** Payload cru, para o painel técnico e para os testes de equivalência. */
  payloadInvoicy?: InvoicyNfeRequest;
}

export interface ExportXmlResult {
  zip: Buffer;
  /** NF-e autorizadas no periodo, com ou sem XML. */
  total: number;
  /** Notas que ficaram fora do ZIP por nao ter XML nem no provedor. */
  faltantes: Array<{
    numero: number;
    serie: number;
    chaveAcesso: string | null;
  }>;
}

/** AAAA-MM-DD → DD/MM/AAAA, para mensagens ao usuario. */
function formatarDataBr(isoDate: string): string {
  return isoDate.split('-').reverse().join('/');
}

/**
 * Status que representam uma NF-e valida perante o fisco.
 *
 * CORRECTION_SENT e' uma nota AUTORIZADA que recebeu carta de correcao: a
 * CC-e ajusta dados da nota, nao a substitui nem a anula. Filtros e guardas
 * que olhavam so' para AUTHORIZED tratavam essas notas como inexistentes.
 */
const EMITIDA_NFE_STATUSES = [NfeStatus.AUTHORIZED, NfeStatus.CORRECTION_SENT];

/**
 * Versão da regra dos itens gravada no `draftData` (rascunho e tentativa de
 * emissão). Sem ela, os itens foram montados pela regra anterior a 15/11/2026:
 * valor unitário do líquido com o desconto abatido outra vez (percentual lido
 * como reais) e a medida como quantidade mesmo com UN cadastrada.
 */
const VERSAO_ITENS_NOTA = 2;

/** JSON com as chaves em ordem: o jsonb do banco não guarda a ordem delas. */
function jsonCanonico(valor: unknown): string {
  return JSON.stringify(valor, (_chave, campo) =>
    campo && typeof campo === 'object' && !Array.isArray(campo)
      ? Object.fromEntries(
          Object.entries(campo).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : campo,
  );
}

@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyApiService: InvoicyApiService,
    private readonly productFiscalService: ProductFiscalService,
    private readonly nfeEmailService: NfeEmailService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
    private readonly icmsAliquotaInterna: IcmsAliquotaInternaService,
  ) {}

  /**
   * O.S. cancelada nao pode gerar documento fiscal. A trava vive no service
   * porque o bloqueio da tela e apenas cosmetico: deep link para a pagina de
   * emissao ou chamada direta a API passavam direto.
   */
  private async assertOrdersNotCanceled(companyId: string, orderIds: string[]) {
    const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];
    if (uniqueOrderIds.length === 0) return;

    const canceledOrders = await this.prisma.order.findMany({
      where: {
        id: { in: uniqueOrderIds },
        status: OrderStatus.CANCELED,
        quotation: { companyId },
      },
      include: { quotation: { include: { series: true } } },
    });

    if (canceledOrders.length === 0) return;

    const referencias = canceledOrders
      .map((order) => {
        const quotation = order.quotation as any;
        return quotation?.series?.code
          ? `${quotation.series.code}-${quotation.quotationNumber}`
          : `OS ${quotation?.quotationNumber ?? order.id}`;
      })
      .join(', ');

    throw new BadRequestException(
      canceledOrders.length === 1
        ? `A ordem de servico ${referencias} esta cancelada e nao pode gerar nota fiscal.`
        : `As ordens de servico ${referencias} estao canceladas e nao podem gerar nota fiscal.`,
    );
  }

  /**
   * Prepara os dados para emissão de NF-e a partir de uma ordem de serviço.
   * Retorna todos os dados pré-preenchidos para o frontend editar antes de emitir.
   */
  async prepareFromOrder(companyId: string, orderId: string) {
    await this.assertOrdersNotCanceled(companyId, [orderId]);

    // Buscar a ordem via quotation para garantir o filtro por companyId
    const quotation = (await this.prisma.quotation.findFirst({
      where: {
        companyId,
        order: { id: orderId },
      },
      include: {
        client: {
          include: {
            address: true,
          },
        },
        order: {
          include: {
            nfes: true, // Incluir NF-e já emitidas
            nfeOrders: {
              include: {
                nfe: true,
              },
            },
          },
        },
        quotationProduct: {
          include: {
            product: {
              include: {
                fiscalData: true,
              },
            },
            // A quantidade medida (14 m2) vive nos items; sem esta relacao a
            // NF-e saia com a "Qtd. Item" (1) e o peso dos volumes zerado.
            items: true,
          },
        },
        series: true,
        quotationPayment: {
          include: {
            paymentCondition: {
              include: {
                paymentMethod: true,
              },
            },
          },
        },
        deliveryInfo: {
          include: {
            supplier: {
              include: {
                address: true,
              },
            },
            clientAddress: true,
          },
        },
      },
    })) as any;

    if (!quotation || !quotation.order) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    const client = quotation.client;
    if (!client) {
      throw new BadRequestException('Cliente não encontrado no orçamento');
    }

    // Buscar configuração do Invoicy para defaults
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    const environment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFE',
    );

    // Destinatário usa sempre o endereço cadastral principal do cliente
    const clientAddress = client.address?.[0];
    const deliveryAddress = quotation.deliveryInfo?.clientAddress;

    // Ensure fiscal data exists for all products (auto-populate defaults if missing)
    const productIds = quotation.quotationProduct.map((qp) => qp.productId);
    await Promise.all(
      productIds.map((productId) =>
        this.productFiscalService.getOrCreateWithDefaults(productId, companyId),
      ),
    );

    // Re-fetch quotation with updated fiscal data after auto-population
    const updatedQuotation = (await this.prisma.quotation.findFirst({
      where: {
        companyId,
        order: { id: orderId },
      },
      include: {
        quotationProduct: {
          include: {
            product: {
              include: {
                fiscalData: true,
              },
            },
            // A quantidade medida (14 m2) vive nos items; sem esta relacao a
            // NF-e saia com a "Qtd. Item" (1) e o peso dos volumes zerado.
            items: true,
          },
        },
      },
    })) as any;

    // Preparar itens da NF-e com dados fiscais completos
    const items = (updatedQuotation || quotation).quotationProduct.map(
      (qp, index) => {
        const fiscalData = qp.product?.fiscalData;

        // Quantidade COMERCIAL na unidade cadastrada do produto, valor bruto
        // e desconto em vDesc. O valor unitario fica sem toFixed(2) de
        // proposito: vProd sai de qCOM x vUnCom no payload, e o leiaute aceita
        // 10 casas em vUnCom. Arredondar aqui fazia 14 x 0,04 = 0,56 divergir
        // do total da nota (0,50) e a SEFAZ rejeitar.
        const linha = valoresDaLinhaParaNota(
          qp,
          fiscalData?.commercialUnit ?? null,
        );

        const selectedCfop =
          (clientAddress?.state === config.emitUf
            ? fiscalData?.cfopInState
            : fiscalData?.cfopOutState) ||
          config.defaultCfop ||
          '';

        return {
          itemNumber: index + 1,
          productId: qp.productId,
          productCode: qp.product?.code || '',
          // Descrição editada no item prevalece sobre o nome do produto do catálogo
          description: qp.description || qp.product?.name || 'Produto/Serviço',
          ncm: fiscalData?.ncm || '',
          cfop: selectedCfop,
          cstIcms: fiscalData?.icmsCst || '102',
          cstIpi: fiscalData?.ipiCst || '',
          cstPis: fiscalData?.pisCst || '',
          cstCofins: fiscalData?.cofinsCst || '',
          unit: linha.unit,
          // A tela exibe `unit`; o payload de emissao le `uCom` (NfeItemDto).
          // Mandar so um dos dois fazia a nota mostrar M2 e sair como UN.
          uCom: linha.unit,
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
          isService: qp.product?.isService || !!fiscalData?.isService,
          needsConfiguration:
            !fiscalData?.ncm || fiscalData.ncm.length !== 8 || !selectedCfop,
        };
      },
    );

    // Calcular totais: produtos é o bruto, e o desconto sai uma vez só. Antes
    // somava o líquido e abatia o desconto de novo.
    const {
      valorProdutos,
      valorDesconto: valorDescontos,
      valorTotal: valorNota,
    } = totaisDosItens(items);

    // Verificar se já existe NF-e emitida para esta ordem
    const activeEnvironment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');
    const activeEnvironmentNumber = activeEnvironment === 'PRODUCAO' ? 1 : 2;
    const nfesDaOrdem = [
      ...(quotation.order.nfes || []),
      ...(quotation.order.nfeOrders || []).map((item) => item.nfe),
    ].filter((nfe) => nfe && nfe.ambiente === activeEnvironmentNumber);

    // A nota "existente" da ordem e a que de fato impede uma nova emissao:
    // autorizada ou com CC-e. Sem esse criterio o `.find()` devolvia a
    // primeira linha que o banco retornasse, em ordem arbitraria — e uma nota
    // CANCELADA fazia a tela esconder o botao de emitir, porque o cabecalho so
    // mostra a barra de acoes para DRAFT, REJECTED ou nenhuma nota. Ordem com
    // mais de uma NF-e e o caso comum: cancelar e refazer gera outra linha.
    const nfesOrdenadas = [...nfesDaOrdem].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const existingNfe =
      nfesOrdenadas.find((nfe) => EMITIDA_NFE_STATUSES.includes(nfe.status)) ??
      // Senao, a mais recente: e o estado em que o usuario realmente parou.
      nfesOrdenadas[0];

    return {
      // Metadados
      orderId,
      quotationId: quotation.id,
      orderCode: `${quotation.series?.code || ''}-${quotation.series?.quotation || ''}`,
      hasExistingNfe: !!existingNfe,
      existingNfe: existingNfe
        ? {
            id: existingNfe.id,
            numero: existingNfe.numero,
            serie: existingNfe.serie,
            status: existingNfe.status,
            chaveAcesso: existingNfe.chaveAcesso,
            danfeUrl: existingNfe.danfeUrl,
            dataEmissao: existingNfe.dataEmissao,
          }
        : null,
      clientId: client.id,
      selectedAddressId: deliveryAddress?.id || null,
      clientAddresses: Array.isArray(client.address)
        ? client.address.map((addr: any) => ({
            id: addr.id,
            label: addr.type || 'Principal',
            street: addr.street,
            number: addr.number,
            neighborhood: addr.neighborhood,
            city: addr.city,
            state: addr.state,
            zipcode: addr.zipcode,
            complement: addr.complement,
          }))
        : [],

      // Configuração de emissão
      emissao: {
        emissor: config.company.legalName || config.company.name || '',
        emissorCnpj: config.company.cnpj || '',
        // Numeração do ambiente ativo, a mesma que reserveNfeNumber vai consumir.
        // Ler o campo legado global mostrava um número que não seria emitido.
        proximoDocumento: `${config.activeNumbering.nfe.nextNumber}/${config.activeNumbering.nfe.series}`,
        serie: config.activeNumbering.nfe.series,
        tipo: 1, // 1 = Saída
        finalidade: 1, // 1 = NF-e normal
        operationNature: config.defaultOperationNature || 'Venda de mercadoria',
        consumidorFinal: client.cnpj ? 0 : 1, // 0 = Não, 1 = Sim (pessoa física)
        presencaConsumidor: 1, // 1 = Operação presencial
        nfeReferenciada: null,
        dataSaida: new Date().toISOString(),
        destinoOperacao: this.resolveDestinoOperacao(
          clientAddress?.state,
          config.company.address.state,
        ),
        // Se a OS tem entrega por transportadora, usar modalidade CIF (0); senão, Sem ocorrência (9)
        modalidadeFrete:
          quotation.deliveryInfo?.deliveryType === 'CARRIER' ? 0 : 9,
        ambiente: environment,
      },

      // Destinatário
      destinatario: {
        razaoSocial: client.corporateName || client.name || '',
        cnpjCpf: client.cnpj || client.cpf || '',
        ie: client.stateRegistration || '',
        indIEDest: client.indicadorIE ?? 9,
        email: client.email || '',
        telefone: client.phone || '',
        cep: clientAddress?.zipcode || '',
        estado: clientAddress?.state || '',
        cidade: clientAddress?.city || '',
        bairro: clientAddress?.neighborhood || '',
        endereco: clientAddress?.street || '',
        numero: clientAddress?.number || 'S/N',
        complemento: clientAddress?.complement || '',
        pais: '1058', // Brasil
      },
      entrega: deliveryAddress
        ? {
            cnpjCpf: client.cnpj || client.cpf || '',
            endereco: deliveryAddress.street || '',
            numero: deliveryAddress.number || 'S/N',
            complemento: deliveryAddress.complement || '',
            bairro: deliveryAddress.neighborhood || '',
            cidade: deliveryAddress.city || '',
            estado: deliveryAddress.state || '',
            cep: deliveryAddress.zipcode || '',
          }
        : null,

      // Itens
      items,

      // Transportadora: pré-preencher com dados do supplier da OS quando deliveryType = CARRIER
      transportadora: (() => {
        const delivery = quotation.deliveryInfo;
        if (delivery?.deliveryType === 'CARRIER' && delivery.supplier) {
          const s = delivery.supplier;
          const sAddr = s.address?.[0];
          return {
            cnpjCpf: s.cnpj || s.cpf || '',
            razaoSocial: s.corporateName || s.name || '',
            ie: s.stateRegistration || '',
            endereco: sAddr
              ? `${sAddr.street || ''}, ${sAddr.number || 'S/N'}`
              : '',
            cidade: sAddr?.city || '',
            uf: sAddr?.state || '',
          };
        }
        return {
          cnpjCpf: '',
          razaoSocial: '',
          ie: '',
          endereco: '',
          cidade: '',
          uf: '',
        };
      })(),

      // Volumes: pré-preencher volume consolidado quando deliveryType = CARRIER
      volumes: (() => {
        const isCarrier = quotation.deliveryInfo?.deliveryType === 'CARRIER';
        if (!isCarrier) return [];

        const productItems = (
          updatedQuotation || quotation
        ).quotationProduct.filter((qp: any) => !qp.product?.isService);

        if (productItems.length === 0) return [];

        // Peso fica em MILIGRAMAS no banco (mesma escala que a tela converte
        // com milligramsToKilograms); a NF-e pede quilos. O comentario antigo
        // dizia "valor direto", mas a relacao `items` nunca era carregada, entao
        // pesoTotal era sempre 0 e a conversao errada nunca apareceu.
        const pesoTotal = productItems.reduce((acc: number, qp: any) => {
          const itemWeightMg = (qp.items || []).reduce(
            (s: number, i: any) => s + (i.weight || 0) * (i.quantity || 1),
            0,
          );
          return acc + itemWeightMg / 1_000_000;
        }, 0);

        const quantidadeTotal = productItems.reduce(
          (acc: number, qp: any) => acc + (qp.quantity || 1),
          0,
        );

        return [
          {
            quantidade: quantidadeTotal,
            especie: 'CX',
            marca: '',
            numeracao: '',
            pesoLiquido: Number(pesoTotal.toFixed(3)),
            pesoBruto: Number(pesoTotal.toFixed(3)),
          },
        ];
      })(),

      // Pagamento
      pagamento: {
        forma: getTPag(
          quotation.quotationPayment?.paymentCondition?.paymentMethod?.code,
        ),
        formaDescricao:
          quotation.quotationPayment?.paymentCondition?.name || 'Dinheiro',
        valor: valorNota,
      },

      // Duplicatas
      duplicatas: [],

      // Informações complementares
      informacoesComplementares: config.taxInfoText || '',

      // Totais
      totais: {
        valorProdutos: Number(valorProdutos.toFixed(2)),
        baseCalculoIcms: 0,
        valorIcms: 0,
        baseCalculoIcmsSt: 0,
        valorIcmsSt: 0,
        valorPis: 0,
        valorCofins: 0,
        valorIpi: 0,
        valorFrete: 0,
        valorSeguro: 0,
        outrasDesepesas: 0,
        valorDesconto: Number(valorDescontos.toFixed(2)),
        valorTotalTributos: 0,
        valorNota: Number(valorNota.toFixed(2)),
      },

      // Autorização para download (XML)
      autXml: [],
    };
  }

  async prepareConsolidatedFromOrders(
    companyId: string,
    orderIds: string[],
    ignoredNfeId?: string,
  ) {
    const uniqueOrderIds = [...new Set(orderIds.filter(Boolean))];

    if (uniqueOrderIds.length < 2) {
      throw new BadRequestException(
        'Selecione ao menos duas ordens para consolidar a NF-e',
      );
    }

    await this.assertOrdersNotCanceled(companyId, uniqueOrderIds);

    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuracao do Invoicy nao encontrada. Configure a integracao primeiro.',
      );
    }
    const activeEnvironment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');
    const activeEnvironmentNumber = activeEnvironment === 'PRODUCAO' ? 1 : 2;

    const quotations = (await this.prisma.quotation.findMany({
      where: {
        companyId,
        order: { id: { in: uniqueOrderIds } },
      },
      include: {
        client: true,
        series: true,
        order: {
          include: {
            nfes: true,
            nfeOrders: {
              include: {
                nfe: true,
              },
            },
          },
        },
      },
    })) as any[];

    if (quotations.length !== uniqueOrderIds.length) {
      throw new NotFoundException('Uma ou mais ordens nao foram encontradas');
    }

    const clientIds = new Set(
      quotations.map((q) => q.clientId).filter(Boolean),
    );
    if (clientIds.size !== 1) {
      throw new BadRequestException(
        'Todas as ordens selecionadas precisam pertencer ao mesmo cliente',
      );
    }

    for (const quotation of quotations) {
      const directNfes = quotation.order?.nfes || [];
      const pivotNfes =
        quotation.order?.nfeOrders?.map((item) => item.nfe).filter(Boolean) ||
        [];
      const blockingNfe = [...directNfes, ...pivotNfes].find(
        (nfe) =>
          nfe.id !== ignoredNfeId &&
          nfe.ambiente === activeEnvironmentNumber &&
          // CORRECTION_SENT e' nota autorizada que recebeu CC-e. Fora desta
          // lista a ordem era tratada como "sem nota" e entrava numa NF-e
          // nova, gerando documento fiscal duplicado para a mesma O.S.
          (nfe.status === NfeStatus.DRAFT ||
            this.isStatusAutorizado(nfe.status)),
      );

      if (blockingNfe) {
        const orderCode = `${quotation.series?.code || ''}-${quotation.series?.quotation || ''}`;
        throw new BadRequestException(
          `A OS ${orderCode} ja possui NF-e ${blockingNfe.status === NfeStatus.DRAFT ? 'em digitacao' : 'autorizada'}`,
        );
      }
    }

    const preparedOrders = await Promise.all(
      uniqueOrderIds.map((orderId) =>
        this.prepareFromOrder(companyId, orderId),
      ),
    );

    const items = preparedOrders.flatMap((preparedOrder) =>
      preparedOrder.items.map((item) => ({
        ...item,
        itemNumber: 0,
        sourceOrderId: preparedOrder.orderId,
        sourceOrderCode: preparedOrder.orderCode,
        description: `${item.description} (OS ${preparedOrder.orderCode})`,
      })),
    );

    items.forEach((item, index) => {
      item.itemNumber = index + 1;
    });

    const { valorProdutos, valorDesconto } = totaisDosItens(items);
    const valorFrete = items.reduce((acc, item) => acc + item.freight, 0);
    const valorSeguro = items.reduce((acc, item) => acc + item.insurance, 0);
    const valorNota = valorProdutos - valorDesconto + valorFrete + valorSeguro;
    const orderCodes = preparedOrders.map((order) => order.orderCode);

    return {
      ...preparedOrders[0],
      orderId: preparedOrders[0].orderId,
      orderIds: uniqueOrderIds,
      quotationId: preparedOrders[0].quotationId,
      orderCode: orderCodes.join(', '),
      orderCodes,
      hasExistingNfe: false,
      existingNfe: null,
      items,
      pagamento: {
        ...preparedOrders[0].pagamento,
        valor: Number(valorNota.toFixed(2)),
      },
      informacoesComplementares: [
        preparedOrders[0].informacoesComplementares,
        `NF-e consolidada das OSs: ${orderCodes.join(', ')}`,
      ]
        .filter(Boolean)
        .join('\n'),
      totais: {
        ...preparedOrders[0].totais,
        valorProdutos: Number(valorProdutos.toFixed(2)),
        valorDesconto: Number(valorDesconto.toFixed(2)),
        valorFrete: Number(valorFrete.toFixed(2)),
        valorSeguro: Number(valorSeguro.toFixed(2)),
        valorNota: Number(valorNota.toFixed(2)),
      },
    };
  }

  /**
   * Prepara os dados para emissão de NF-e avulsa (sem ordem de serviço).
   * Retorna dados padrão do emitente e, opcionalmente, dados do destinatário se clientId informado.
   */
  async prepareStandalone(companyId: string, clientId?: string) {
    // Buscar configuração do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    const environment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFE',
    );

    // Buscar dados do cliente, se informado
    let destinatario: Record<string, any> = {
      razaoSocial: '',
      cnpjCpf: '',
      ie: '',
      indIEDest: 9,
      email: '',
      telefone: '',
      cep: '',
      estado: '',
      cidade: '',
      bairro: '',
      endereco: '',
      numero: 'S/N',
      complemento: '',
      pais: '1058',
    };

    let clientAddresses: any[] = [];
    let selectedAddressId: string | null = null;

    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, companyId },
        include: { address: true },
      });

      if (!client) {
        throw new NotFoundException('Cliente não encontrado');
      }

      const clientAddress = (client as any).address?.[0];
      selectedAddressId = clientAddress?.id || null;
      clientAddresses = Array.isArray((client as any).address)
        ? (client as any).address.map((addr: any) => ({
            id: addr.id,
            label: addr.type || 'Principal',
            street: addr.street,
            number: addr.number,
            neighborhood: addr.neighborhood,
            city: addr.city,
            state: addr.state,
            zipcode: addr.zipcode,
            complement: addr.complement,
          }))
        : [];

      destinatario = {
        razaoSocial: (client as any).corporateName || client.name || '',
        cnpjCpf: (client as any).cnpj || (client as any).cpf || '',
        ie: (client as any).stateRegistration || '',
        indIEDest: (client as any).indicadorIE ?? 9,
        email: client.email || '',
        telefone: (client as any).phone || (client as any).mobile || '',
        cep: clientAddress?.zipcode || '',
        estado: clientAddress?.state || '',
        cidade: clientAddress?.city || '',
        bairro: clientAddress?.neighborhood || '',
        endereco: clientAddress?.street || '',
        numero: clientAddress?.number || 'S/N',
        complemento: clientAddress?.complement || '',
        pais: '1058',
      };
    }

    return {
      // Metadados
      orderId: null,
      quotationId: null,
      orderCode: null,
      hasExistingNfe: false,
      existingNfe: null,
      clientId: clientId || null,
      selectedAddressId,
      clientAddresses,
      entrega: null,

      // Configuração de emissão
      emissao: {
        emissor: config.company.legalName || config.company.name || '',
        emissorCnpj: config.company.cnpj || '',
        // Numeração do ambiente ativo, a mesma que reserveNfeNumber vai consumir.
        // Ler o campo legado global mostrava um número que não seria emitido.
        proximoDocumento: `${config.activeNumbering.nfe.nextNumber}/${config.activeNumbering.nfe.series}`,
        serie: config.activeNumbering.nfe.series,
        tipo: 1,
        finalidade: 1,
        operationNature: config.defaultOperationNature || 'Venda de mercadoria',
        consumidorFinal: 1,
        presencaConsumidor: 1,
        nfeReferenciada: null,
        dataSaida: new Date().toISOString(),
        // Era 1 fixo: a avulsa mostrava "operacao interna" para qualquer
        // cliente, inclusive nas notas que saiam interestaduais no XML.
        destinoOperacao: this.resolveDestinoOperacao(
          destinatario.estado,
          config.company.address.state,
        ),
        modalidadeFrete: 9,
        ambiente: environment,
      },

      // Destinatário
      destinatario,

      // Itens (vazio para nota avulsa)
      items: [],

      // Transportadora (vazio por padrão)
      transportadora: {
        cnpjCpf: '',
        razaoSocial: '',
        ie: '',
        endereco: '',
        cidade: '',
        uf: '',
      },

      // Volumes
      volumes: [],

      // Pagamento padrão
      pagamento: {
        forma: '01',
        formaDescricao: 'Dinheiro',
        valor: 0,
      },

      // Duplicatas
      duplicatas: [],

      // Informações complementares
      informacoesComplementares: config.taxInfoText || '',

      // Totais zerados
      totais: {
        valorProdutos: 0,
        baseCalculoIcms: 0,
        valorIcms: 0,
        baseCalculoIcmsSt: 0,
        valorIcmsSt: 0,
        valorPis: 0,
        valorCofins: 0,
        valorIpi: 0,
        valorFrete: 0,
        valorSeguro: 0,
        outrasDesepesas: 0,
        valorDesconto: 0,
        valorTotalTributos: 0,
        valorNota: 0,
      },

      // Autorização para download (XML)
      autXml: [],

      defaultCfop: config.defaultCfop || '',
    };
  }

  private parseXmlDataFallback(xml?: string | null) {
    if (!xml) return null;

    const extractTag = (x: string, t: string) => {
      const match = x.match(new RegExp(`<${t}[^>]*>(.*?)</${t}>`, 's'));
      return match ? match[1] : '';
    };

    const destXml = extractTag(xml, 'dest');
    let destinatario = null;
    if (destXml) {
      const enderDestXml = extractTag(destXml, 'enderDest');
      destinatario = {
        razaoSocial: extractTag(destXml, 'xNome'),
        cnpjCpf: extractTag(destXml, 'CNPJ') || extractTag(destXml, 'CPF'),
        idEstrangeiro: extractTag(destXml, 'idEstrangeiro'),
        ie: extractTag(destXml, 'IE'),
        indIEDest: Number(extractTag(destXml, 'indIEDest')) || undefined,
        email: extractTag(destXml, 'email'),
        endereco: extractTag(enderDestXml, 'xLgr'),
        numero: extractTag(enderDestXml, 'nro'),
        bairro: extractTag(enderDestXml, 'xBairro'),
        cidade: extractTag(enderDestXml, 'xMun'),
        estado: extractTag(enderDestXml, 'UF'),
        cep: extractTag(enderDestXml, 'CEP'),
        // cPais é o código BACEN (1058 = Brasil), mesmo formato usado no rascunho.
        pais: extractTag(enderDestXml, 'cPais') || '1058',
        complemento: extractTag(enderDestXml, 'xCpl'),
        telefone: extractTag(enderDestXml, 'fone'),
      };
    }

    const items = [];
    const detRegex = /<det[^>]*>(.*?)<\/det>/gs;
    let match;
    while ((match = detRegex.exec(xml)) !== null) {
      const detXml = match[1];
      const prodXml = extractTag(detXml, 'prod');
      if (prodXml) {
        items.push({
          itemNumber: items.length + 1,
          productId: extractTag(prodXml, 'cProd'),
          description: extractTag(prodXml, 'xProd'),
          productCode: extractTag(prodXml, 'cProd'),
          quantity: parseFloat(extractTag(prodXml, 'qCOM') || '0'),
          unitValue: parseFloat(extractTag(prodXml, 'vUnCom') || '0'),
          ncm: extractTag(prodXml, 'NCM'),
          cfop: extractTag(prodXml, 'CFOP'),
          uCom: extractTag(prodXml, 'uCOM'),
          ean: extractTag(prodXml, 'cEAN'),
          ceantrib: extractTag(prodXml, 'cEANTrib'),
          discount: parseFloat(extractTag(prodXml, 'vDesc') || '0'),
          freight: parseFloat(extractTag(prodXml, 'vFrete') || '0'),
          insurance: parseFloat(extractTag(prodXml, 'vSeg') || '0'),
          totalValue: parseFloat(extractTag(prodXml, 'vProd') || '0'),
          cstIcms: extractTag(detXml, 'CST') || extractTag(detXml, 'CSOSN'),
          cstIpi: extractTag(detXml, 'CST') /* from IPI tag, ideally */,
          cstPis: extractTag(detXml, 'CST') /* from PIS tag, ideally */,
          cstCofins: extractTag(detXml, 'CST') /* from COFINS tag, ideally */,
          isService: false,
          needsConfiguration: false,
        });
      }
    }

    // Extrair indFinal da tag <ide> — usado pelo prepareComplementary
    const ideXml = extractTag(xml, 'ide');
    const indFinal = ideXml
      ? parseInt(extractTag(ideXml, 'indFinal') || '0', 10)
      : 0;

    return { destinatario, items, indFinal };
  }

  /**
   * Cabecalho da emissao guardado no rascunho, nas DUAS formas possiveis.
   *
   * `draftData` chega ora como o DTO PLANO que `emit` grava (`operationNature`,
   * `finalidade`... na raiz), ora como o rascunho ANINHADO de `createDraft`
   * (tudo dentro de `emissao`). O destinatario ja era lido nas duas formas; o
   * cabecalho so era lido na aninhada, entao numa nota REJEITADA — onde o
   * draftData e sempre o DTO plano — tudo que o usuario tinha ajustado voltava
   * com o padrao do emissor ao clicar em "Corrigir e reemitir".
   */
  /** Devolve a data de saida apenas quando ela ainda nao venceu. */
  private dataSaidaSeAindaFutura(valor?: string): string | undefined {
    if (!valor) return undefined;
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return undefined;
    return data > new Date() ? valor : undefined;
  }

  /**
   * `idDest`: 1 interna, 2 interestadual, 3 exterior.
   *
   * Regra unica para a tela e para o XML. Antes cada ponto calculava do seu
   * jeito — a avulsa devolvia 1 fixo — e a tela dizia "operacao interna" numa
   * nota que saia interestadual no XML.
   *
   * Nao depende do CFOP: e o contrario, o CFOP e que e escolhido conforme a
   * operacao ser dentro ou fora do estado.
   *
   * Sem UF do destinatario nao da para afirmar interestadual, entao assume
   * interna; a emissao recalcula com a UF do CEP antes de transmitir.
   */
  private resolveDestinoOperacao(
    ufDestino?: string | null,
    ufEmitente?: string | null,
    isForeign = false,
  ): number {
    if (isForeign) return 3;

    const destino = (ufDestino || '').trim().toUpperCase();
    const emitente = (ufEmitente || '').trim().toUpperCase();
    if (!destino || !emitente) return 1;

    return destino === emitente ? 1 : 2;
  }

  private getEmissaoFromDraft(draftData: any): Record<string, any> {
    if (!draftData) return {};
    if (draftData.emissao) return draftData.emissao;

    const plano: Record<string, any> = {
      operationNature: draftData.operationNature,
      tipo: draftData.tipo,
      finalidade: draftData.finalidade,
      consumidorFinal: draftData.consumidorFinal,
      presencaConsumidor: draftData.presencaConsumidor,
      // So volta se ainda estiver no futuro: restaurar uma data vencida
      // reintroduz a 505. Vazia, o prepare repoe o instante atual.
      dataSaida: this.dataSaidaSeAindaFutura(draftData.dataSaida),
      nfeReferenciada: draftData.nfeReferenciada,
      modalidadeFrete: draftData.modalidadeFrete,
    };

    // `undefined` significa "nao veio no envio": manter o padrao do baseData em
    // vez de sobrescrever com vazio.
    return Object.fromEntries(
      Object.entries(plano).filter(([, valor]) => valor !== undefined),
    );
  }

  private getDestinatarioFromDraftOrXml(draftData: any, xmlData: any) {
    let destinatario: any = {};

    // 1. Tentar pegar do draftData (suportando tanto o formato de rascunho com .destinatario quanto o formato de envio plano com destX)
    if (draftData) {
      if (draftData.destinatario) {
        destinatario = { ...draftData.destinatario };
      } else if (draftData.destNome || draftData.destCnpjCpf) {
        destinatario = {
          razaoSocial: draftData.destNome || '',
          cnpjCpf: draftData.destCnpjCpf || '',
          ie: draftData.destIe || '',
          indIEDest: draftData.destIndIEDest ?? 9,
          email: draftData.destEmail || '',
          telefone: draftData.destTelefone || '',
          cep: draftData.destCep || '',
          estado: draftData.destUf || '',
          cidade: draftData.destMunicipio || '',
          bairro: draftData.destBairro || '',
          endereco: draftData.destEndereco || '',
          numero: draftData.destNumero || 'S/N',
          complemento: draftData.destComplemento || '',
          pais: draftData.destPais || '1058',
        };
      }
    }

    // 2. Tentar mesclar/sobrepor com dados reais do XML (xmlData), pois o XML é a fonte da verdade da NF emitida.
    //    Tags ausentes no XML (email, fone, idEstrangeiro...) vêm como '' e não podem apagar o que veio do rascunho.
    if (xmlData?.destinatario) {
      const fromXml = Object.fromEntries(
        Object.entries(xmlData.destinatario).filter(
          ([, value]) => value !== undefined && value !== null && value !== '',
        ),
      );
      destinatario = {
        ...destinatario,
        ...fromXml,
      };
    }

    // Garante o país sempre preenchido (1058 = Brasil) para o formulário não cair em "estrangeiro"
    if (!destinatario.pais) {
      destinatario.pais = '1058';
    }

    return destinatario;
  }

  async prepareDevolution(companyId: string, originalNfeId: string) {
    const originalNfe = await this.prisma.nfe.findFirst({
      where: { id: originalNfeId, companyId },
      include: {
        order: true,
        quotation: true,
      },
    });

    if (!originalNfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    // CORRECTION_SENT continua sendo uma nota autorizada: a CC-e corrige dados
    // da NF-e original e nao interfere na devolucao, que e' uma nota NOVA
    // referenciando a de origem. Sao procedimentos independentes.
    if (!this.isStatusAutorizado(originalNfe.status)) {
      throw new BadRequestException(
        'Apenas NF-e autorizadas podem ser devolvidas',
      );
    }

    const draftData =
      originalNfe.draftData && typeof originalNfe.draftData === 'object'
        ? (originalNfe.draftData as any)
        : null;

    const xmlData = this.parseXmlDataFallback(
      originalNfe.xmlAutorizado || originalNfe.xmlEnvio,
    );

    const destinatarioOverride = this.getDestinatarioFromDraftOrXml(
      draftData,
      xmlData,
    );

    let clientId;

    if (originalNfe.orderId) {
      const quotation = await this.prisma.quotation.findFirst({
        where: { order: { id: originalNfe.orderId } },
      });
      if (quotation) clientId = quotation.clientId;
    } else if (originalNfe.quotationId) {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: originalNfe.quotationId },
      });
      if (quotation) clientId = quotation.clientId;
    }

    if (!clientId && destinatarioOverride.cnpjCpf) {
      const client = await this.prisma.client.findFirst({
        where: {
          OR: [
            { cnpj: destinatarioOverride.cnpjCpf },
            { cpf: destinatarioOverride.cnpjCpf },
          ],
          companyId,
        },
      });
      if (client) clientId = client.id;
    }

    const baseData = await this.prepareStandalone(
      companyId,
      clientId || undefined,
    );

    let itemsOverride = draftData?.items || xmlData?.items || [];

    if (originalNfe.orderId && !itemsOverride.length) {
      try {
        const orderData = await this.prepareFromOrder(
          companyId,
          originalNfe.orderId,
        );
        itemsOverride = orderData.items;
      } catch (e) {
        this.logger.warn(
          `Could not load items for devolution from order: ${e.message}`,
        );
      }
    }

    const mappedItems = itemsOverride.map((item: any) => ({
      ...item,
      // Como a nota soma: vProd e vDesc arredondados no item.
      totalValue:
        item.totalValue ??
        totalDoItemNaNota({
          quantity: item.quantity ?? 0,
          unitValue: item.unitValue ?? 0,
          discount: item.discount ?? 0,
          freight: item.freight ?? 0,
          insurance: item.insurance ?? 0,
        }),
    }));

    // Fonte da verdade para a devolução é o que foi REALMENTE transmitido na
    // nota original, não a configuração atual — o emissor padrão e seus
    // defaults podem ter mudado desde a emissão.
    const payloadEnvio =
      originalNfe.invoicyPayloadEnvio &&
      typeof originalNfe.invoicyPayloadEnvio === 'object'
        ? (originalNfe.invoicyPayloadEnvio as any)
        : null;

    // UF do emitente: preferir o emissor que gerou a nota.
    const emissorOriginal = originalNfe.invoicyConfigId
      ? await this.prisma.invoicyConfig.findFirst({
          where: { id: originalNfe.invoicyConfigId, companyId },
          select: { id: true },
        })
      : null;
    const config = emissorOriginal
      ? await this.invoicyService.getById(emissorOriginal.id)
      : await this.invoicyService.getConfig(companyId);
    const emitUf = (
      payloadEnvio?.Documento?.emit?.enderEmit?.UF ||
      config?.company?.address?.state ||
      ''
    ).toUpperCase();

    // CFOP original: o snapshot tem o valor resolvido na emissão; draftData
    // costuma trazer cfop undefined, o que jogava a devolução no fallback.
    const originalCfop = (payloadEnvio?.Documento?.det?.[0]?.prod?.CFOP ||
      draftData?.items?.[0]?.cfop ||
      xmlData?.items?.[0]?.cfop ||
      0) as number;

    // Sugestão de CFOP para devolução com base no CFOP original
    const getSuggestedDevolutionCfop = (destUf: string): number => {
      const isInterestadual =
        emitUf && destUf && emitUf !== destUf.toUpperCase();
      const lastThree = originalCfop % 1000;
      // Produção própria (5101/6101) -> 1201/2201
      if (lastThree === 101) {
        return isInterestadual ? 2201 : 1201;
      }
      // Mercadoria adquirida (5102/6102) -> 1202/2202
      if (lastThree === 102) {
        return isInterestadual ? 2202 : 1202;
      }
      // Fallback
      return isInterestadual ? 2202 : 1202;
    };

    // getDestinatarioFromDraftOrXml retorna o campo como 'estado' (tanto do draftData quanto do XML)
    const destUfForCfop =
      (destinatarioOverride as any)?.estado ||
      (destinatarioOverride as any)?.uf ||
      (destinatarioOverride as any)?.destUf ||
      '';

    const suggestedCfop = getSuggestedDevolutionCfop(destUfForCfop);

    const mappedItemsWithCfop = mappedItems.map((item: any) => ({
      ...item,
      cfop: String(suggestedCfop),
    }));

    return {
      ...baseData,
      clientId: clientId || null,
      emissao: {
        ...baseData.emissao,
        tipo: 0,
        finalidade: 4,
        operationNature: 'Devolução de mercadoria',
        consumidorFinal: 0,
        nfeReferenciada: originalNfe.chaveAcesso,
      },
      destinatario: {
        ...baseData.destinatario,
        ...destinatarioOverride,
      },
      pagamento: {
        forma: '90',
        formaDescricao: 'Sem pagamento',
        valor: 0.0,
      },
      duplicatas: [],
      items: mappedItemsWithCfop.length ? mappedItemsWithCfop : baseData.items,
      originalNfeId: originalNfe.id,
      originalNfeNumero: originalNfe.numero,
      originalNfeChave: originalNfe.chaveAcesso,
      defaultCfop: String(suggestedCfop),
    };
  }

  async prepareComplementary(companyId: string, originalNfeId: string) {
    const originalNfe = await this.prisma.nfe.findFirst({
      where: { id: originalNfeId, companyId },
      include: {
        order: true,
        quotation: true,
      },
    });

    if (!originalNfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    // Ver comentario em prepareDevolution: a CC-e nao consome a nota original.
    if (!this.isStatusAutorizado(originalNfe.status)) {
      throw new BadRequestException(
        'Apenas NF-e autorizadas podem ser complementadas',
      );
    }

    const draftData =
      originalNfe.draftData && typeof originalNfe.draftData === 'object'
        ? (originalNfe.draftData as any)
        : null;

    const xmlData = this.parseXmlDataFallback(
      originalNfe.xmlAutorizado || originalNfe.xmlEnvio,
    );

    const destinatarioOverride = this.getDestinatarioFromDraftOrXml(
      draftData,
      xmlData,
    );

    let clientId: string | undefined;
    if (originalNfe.orderId) {
      const quotation = await this.prisma.quotation.findFirst({
        where: { order: { id: originalNfe.orderId } },
      });
      if (quotation) clientId = quotation.clientId;
    } else if (originalNfe.quotationId) {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: originalNfe.quotationId },
      });
      if (quotation) clientId = quotation.clientId;
    }

    if (!clientId && destinatarioOverride.cnpjCpf) {
      const client = await this.prisma.client.findFirst({
        where: {
          OR: [
            { cnpj: destinatarioOverride.cnpjCpf },
            { cpf: destinatarioOverride.cnpjCpf },
          ],
          companyId,
        },
      });
      if (client) clientId = client.id;
    }

    const baseData = await this.prepareStandalone(companyId, clientId);

    // Copiar consumidorFinal da nota original (fallback para 0 se ausente)
    const consumidorFinalOriginal =
      draftData?.emissao?.consumidorFinal ??
      draftData?.consumidorFinal ??
      (xmlData as any)?.indFinal ??
      0;

    const originalSalesCfop =
      draftData?.items?.[0]?.cfop ||
      xmlData?.items?.[0]?.cfop ||
      baseData.defaultCfop ||
      '5102';

    return {
      ...baseData,
      clientId: clientId || null,
      emissao: {
        ...baseData.emissao,
        tipo: 1,
        finalidade: 2,
        operationNature: 'Complemento de NF-e',
        consumidorFinal: consumidorFinalOriginal,
        nfeReferenciada: originalNfe.chaveAcesso,
      },
      destinatario: {
        ...baseData.destinatario,
        ...destinatarioOverride,
      },
      items: [],
      originalNfeId: originalNfe.id,
      originalNfeNumero: originalNfe.numero,
      originalNfeChave: originalNfe.chaveAcesso,
      defaultCfop: String(originalSalesCfop),
    };
  }

  async prepareReissue(companyId: string, rejectedNfeId: string) {
    const originalNfe = await this.prisma.nfe.findFirst({
      where: { id: rejectedNfeId, companyId },
    });

    if (!originalNfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    if (originalNfe.status !== NfeStatus.REJECTED) {
      throw new BadRequestException(
        'Apenas NF-e rejeitadas podem ser reemitidas por este fluxo',
      );
    }

    const draftData =
      originalNfe.draftData && typeof originalNfe.draftData === 'object'
        ? (originalNfe.draftData as any)
        : null;

    const xmlData = this.parseXmlDataFallback(
      originalNfe.xmlAutorizado || originalNfe.xmlEnvio,
    );

    const destinatarioOverride = this.getDestinatarioFromDraftOrXml(
      draftData,
      xmlData,
    );

    let clientId: string | undefined;
    if (originalNfe.orderId) {
      const quotation = await this.prisma.quotation.findFirst({
        where: { order: { id: originalNfe.orderId } },
      });
      if (quotation) clientId = quotation.clientId;
    } else if (originalNfe.quotationId) {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: originalNfe.quotationId },
      });
      if (quotation) clientId = quotation.clientId;
    }

    if (!clientId && destinatarioOverride.cnpjCpf) {
      const client = await this.prisma.client.findFirst({
        where: {
          OR: [
            { cnpj: destinatarioOverride.cnpjCpf },
            { cpf: destinatarioOverride.cnpjCpf },
          ],
          companyId,
        },
      });
      if (client) clientId = client.id;
    }

    const baseData = await this.prepareStandalone(companyId, clientId);

    const emissaoOverride = this.getEmissaoFromDraft(draftData);
    const itemsOverride = await this.itensComCstDoRegime(
      companyId,
      originalNfe,
      await this.itensParaReemitir(
        companyId,
        originalNfe,
        draftData,
        draftData?.items || xmlData?.items || [],
      ),
    );

    const mappedItems = itemsOverride.map((item: any) => ({
      ...item,
      // Como a nota soma: vProd e vDesc arredondados no item.
      totalValue:
        item.totalValue ??
        totalDoItemNaNota({
          quantity: item.quantity ?? 0,
          unitValue: item.unitValue ?? 0,
          discount: item.discount ?? 0,
          freight: item.freight ?? 0,
          insurance: item.insurance ?? 0,
        }),
    }));

    return {
      ...baseData,
      clientId: clientId || null,
      emissao: {
        ...baseData.emissao,
        ...emissaoOverride,
      },
      destinatario: {
        ...baseData.destinatario,
        ...destinatarioOverride,
      },
      items: mappedItems.length ? mappedItems : baseData.items,

      // O que o usuario digitou tem de sobreviver a rejeicao. `additionalInfo`
      // e o nome no DTO de emissao; `informacoesComplementares` e o nome no
      // rascunho e na resposta do prepare.
      informacoesComplementares:
        draftData?.additionalInfo ??
        draftData?.informacoesComplementares ??
        baseData.informacoesComplementares,
      transportadora: draftData?.transportadora ?? baseData.transportadora,
      volumes: draftData?.volumes ?? baseData.volumes,
      duplicatas: draftData?.duplicatas ?? baseData.duplicatas,
      autXml: draftData?.autXml ?? baseData.autXml,

      originalNfeId: originalNfe.id,
      originalNfeNumero: originalNfe.numero,
      motivoRejeicao: originalNfe.motivoRejeicao,
    };
  }

  // Emitir NF-e a partir de uma ordem de serviço (busca dados automaticamente)

  async emitFromOrder(companyId: string, dto: EmitNfeFromOrderDto) {
    await this.assertOrdersNotCanceled(companyId, [dto.orderId]);

    // Buscar a ordem via quotation para garantir o filtro por companyId
    const quotation = await this.prisma.quotation.findFirst({
      where: {
        companyId,
        order: { id: dto.orderId },
      },
      include: {
        client: {
          include: {
            address: true,
          },
        },
        order: true,
        quotationPayment: {
          include: {
            paymentCondition: {
              include: {
                paymentMethod: true,
              },
            },
          },
        },
        quotationProduct: {
          include: {
            product: {
              include: {
                fiscalData: true,
              },
            },
            // A quantidade medida (14 m2) vive nos items; sem esta relacao a
            // NF-e saia com a "Qtd. Item" (1) e o peso dos volumes zerado.
            items: true,
          },
        },
      },
    });

    if (!quotation || !quotation.order) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }
    const environment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');

    // Verificar se já existe NF-e autorizada para esta ordem
    // Inclui CORRECTION_SENT: sem isso, uma nota que recebeu CC-e deixava de
    // bloquear e a mesma O.S. podia receber uma segunda NF-e autorizada.
    const existingNfe = await this.prisma.nfe.findFirst({
      where: {
        orderId: dto.orderId,
        status: { in: EMITIDA_NFE_STATUSES },
        ambiente: environment === 'PRODUCAO' ? 1 : 2,
      },
    });

    if (existingNfe) {
      throw new BadRequestException(
        `Já existe uma NF-e autorizada para esta ordem de serviço (Nº ${existingNfe.numero}/${existingNfe.serie})`,
      );
    }

    const client = quotation.client;
    if (!client) {
      throw new BadRequestException('Cliente não encontrado no orçamento');
    }

    // Preparar itens da NF-e (usar totalValue ou finalValue dividido pela quantidade)
    // IMPORTANTE: Valores no banco estão em centavos, dividir por 100 para reais
    const items = quotation.quotationProduct.map((qp) => {
      // Mesma conta do prepare: sem isto a emissao a partir da ordem e a
      // emissao direta sairiam com quantidades e valores diferentes.
      const linha = valoresDaLinhaParaNota(
        qp,
        qp.product?.fiscalData?.commercialUnit ?? null,
      );
      return {
        productId: qp.productId,
        quantity: linha.quantity,
        uCom: linha.unit,
        unitValue: linha.unitValue,
        discount: linha.discount,
      };
    });

    if (items.length === 0) {
      throw new BadRequestException('Orçamento não possui itens');
    }

    // Obter endereço principal do cliente
    const clientAddress = client.address?.[0];

    // Construir DTO completo
    const fullDto: EmitNfeDto = {
      orderId: dto.orderId,
      quotationId: quotation.id,
      operationNature:
        dto.operationNature ||
        config.defaultOperationNature ||
        'Venda de mercadoria',
      tipo: dto.tipo,
      finalidade: dto.finalidade,
      consumidorFinal: dto.consumidorFinal,
      presencaConsumidor: dto.presencaConsumidor,
      dataSaida: dto.dataSaida,
      nfeReferenciada: dto.nfeReferenciada,
      additionalInfo: dto.additionalInfo || config.taxInfoText || '',
      destCnpjCpf: client.cnpj || client.cpf || '',
      destNome: client.corporateName || client.name || '',
      destEmail: client.email || '',
      destEndereco: clientAddress?.street || '',
      destNumero: clientAddress?.number || 'S/N',
      destComplemento: clientAddress?.complement || '',
      destBairro: clientAddress?.neighborhood || '',
      destCep: clientAddress?.zipcode || '',
      destMunicipio: clientAddress?.city || '',
      destUf: clientAddress?.state || '',
      destPais: '1058',
      destIe: client.stateRegistration || '',
      destIndIEDest: client.indicadorIE ?? 9,
      pagamento: {
        forma: getTPag(
          (quotation as any).quotationPayment?.paymentCondition?.paymentMethod
            ?.code,
        ),
        valor: 0, // recalculated from items
      },
      items,
    };

    // Validar dados obrigatórios
    if (!fullDto.destCnpjCpf) {
      throw new BadRequestException('Cliente não possui CPF/CNPJ cadastrado');
    }
    if (!fullDto.destNome) {
      throw new BadRequestException('Cliente não possui nome cadastrado');
    }
    if (!fullDto.destEndereco) {
      throw new BadRequestException('Cliente não possui endereço cadastrado');
    }

    // Delega para emit(): é lá que o imposto do Regime Normal é calculado.
    // Montar o payload direto aqui faria a emissão por ordem sair sem imposto.
    return this.emit(companyId, fullDto);
  }

  async findAll(companyId: string, filters: NfeFilterDto) {
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

    if (filters.avulsa !== undefined) {
      if (filters.avulsa === true || String(filters.avulsa) === 'true') {
        where.orderId = null;
      }
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

    // Obtém IDs de NF-es rejeitadas duplicadas para excluir da listagem
    const excludedRowsAll = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM nfes r
      WHERE r."companyId" = ${companyId}
        AND r.status = 'REJECTED'
        AND EXISTS (
          SELECT 1 FROM nfes a
          WHERE a."companyId" = r."companyId"
            AND a.numero = r.numero
            AND a.serie = r.serie
            AND a.status IN ('AUTHORIZED', 'CORRECTION_SENT')
            AND a."createdAt" > r."createdAt"
        )
    `;
    const excludedNfeIdsAll = excludedRowsAll.map((row) => row.id);
    if (excludedNfeIdsAll.length > 0) {
      where.id = { notIn: excludedNfeIdsAll };
    }

    const [items, total] = await Promise.all([
      this.prisma.nfe.findMany({
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
      this.prisma.nfe.count({ where }),
    ]);

    const mappedItems = items.map((nfe: any) => {
      const draftData =
        typeof nfe.draftData === 'string'
          ? JSON.parse(nfe.draftData)
          : nfe.draftData || {};
      const destNome =
        draftData?.destinatario?.razaoSocial || draftData?.destNome || null;
      return {
        ...nfe,
        destinatario: {
          nome: destNome,
        },
      };
    });

    return {
      items: mappedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string, companyId: string) {
    const nfe = await this.prisma.nfe.findFirst({
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

    if (!nfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    return nfe;
  }

  async findByChaveAcesso(chaveAcesso: string, companyId: string) {
    const nfe = await this.prisma.nfe.findFirst({
      where: { chaveAcesso, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    return nfe;
  }

  async emitConsolidated(companyId: string, dto: EmitNfeDto) {
    const uniqueOrderIds = [...new Set((dto.orderIds || []).filter(Boolean))];

    if (uniqueOrderIds.length < 2) {
      throw new BadRequestException(
        'Selecione ao menos duas ordens para emitir uma NF-e consolidada',
      );
    }

    const candidateDrafts = (await this.prisma.nfe.findMany({
      where: {
        companyId,
        status: NfeStatus.DRAFT,
        orders: {
          some: {
            orderId: { in: uniqueOrderIds },
          },
        },
      },
      include: {
        orders: true,
      },
    })) as any[];

    const existingDraft = candidateDrafts.find((draft) => {
      const draftOrderIds = draft.orders.map((item) => item.orderId).sort();
      return (
        draftOrderIds.length === uniqueOrderIds.length &&
        draftOrderIds.join('|') === [...uniqueOrderIds].sort().join('|')
      );
    });

    const preparedData = await this.prepareConsolidatedFromOrders(
      companyId,
      uniqueOrderIds,
      existingDraft?.id,
    );

    // Mesma razão de emitFromOrder: o cálculo do imposto vive em emit().
    return this.emit(companyId, {
      ...dto,
      orderId: uniqueOrderIds[0],
      orderIds: uniqueOrderIds,
      quotationId: dto.quotationId || preparedData.quotationId,
    });
  }

  /**
   * Leituras e validações que precedem qualquer efeito da emissão.
   *
   * Extraído de `emit` para a pré-visualização poder rodar exatamente as
   * mesmas checagens sem reservar número nem criar registro. Só lê: config,
   * ambiente e o CEP do destinatário (ViaCEP).
   */
  private async resolveNfeEmissionContext(
    companyId: string,
    dto: EmitNfeDto,
  ): Promise<NfeEmissionContext> {
    // Funil final da emissao: cobre tambem `emit-full`, que recebe o orderId
    // pronto do frontend sem passar pelos preparadores.
    await this.assertOrdersNotCanceled(companyId, [
      ...(dto.orderId ? [dto.orderId] : []),
      ...(dto.orderIds || []),
    ]);

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
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFE',
    );

    // Validar que temos itens
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('NF-e deve conter ao menos um item');
    }

    // Desconto maior que o valor do item deixa o item (ou a nota) negativo, e
    // o schema recusa. Barrar aqui, antes de reservar o número, e dizer qual
    // item: na tela, mudar a quantidade não mexe no desconto já digitado.
    dto.items.forEach((item, index) => {
      const { valorProduto, desconto } = valoresDoItemNoXml(item);
      if (desconto > valorProduto) {
        throw new BadRequestException(
          `O desconto do item ${index + 1} (${item.description || item.productCode || 'sem descrição'}) é de R$ ${desconto.toFixed(2)}, maior que o valor dele (R$ ${valorProduto.toFixed(2)}). Ajuste o desconto ou a quantidade.`,
        );
      }
    });

    // Validar destinatário
    const isForeign = dto.destPais && dto.destPais !== '1058';
    const cleanCnpjCpf = dto.destCnpjCpf?.replace(/\D/g, '') || '';
    if (!isForeign) {
      if (
        !cleanCnpjCpf ||
        (cleanCnpjCpf.length !== 11 && cleanCnpjCpf.length !== 14)
      ) {
        throw new BadRequestException(
          'CPF/CNPJ do destinatário é obrigatório e deve ser válido (11 dígitos para CPF ou 14 para CNPJ)',
        );
      }
    } else {
      if (
        !dto.destIdEstrangeiro ||
        dto.destIdEstrangeiro.length < 5 ||
        dto.destIdEstrangeiro.length > 20
      ) {
        throw new BadRequestException(
          'Para destinatários estrangeiros, a Identificação do Estrangeiro (idEstrangeiro) é obrigatória e deve ter entre 5 e 20 caracteres',
        );
      }
    }

    const cleanReferencedNfe = (dto.nfeReferenciada || '').replace(/\D/g, '');
    if (cleanReferencedNfe && cleanReferencedNfe.length !== 44) {
      throw new BadRequestException(
        'NF-e referenciada deve conter uma chave de acesso com 44 digitos',
      );
    }

    const now = new Date();
    const dataSaidaInformada = dto.dataSaida ? new Date(dto.dataSaida) : now;
    if (Number.isNaN(dataSaidaInformada.getTime())) {
      throw new BadRequestException('Data de saida/entrada invalida');
    }

    // dhSaiEnt anterior a dhEmi e rejeicao 505 na SEFAZ.
    //
    // A data de saida e capturada quando a tela monta, mas dhEmi so nasce aqui,
    // na hora de transmitir. Entre os dois instantes esta todo o tempo de
    // preenchimento da nota — e o campo datetime-local ainda truncava os
    // segundos, entao a saida ja nascia no passado mesmo sem demora nenhuma.
    //
    // Data futura e intencional ("sai amanha") e fica preservada; so o passado
    // e puxado para o instante da emissao, que e o que "saida agora" significa.
    const dataSaida = dataSaidaInformada < now ? now : dataSaidaInformada;

    // Buscar código IBGE do município do destinatário via CEP
    let destCmun = isForeign ? 9999999 : 0;
    let destUfFromCep = isForeign ? 'EX' : dto.destUf || '';
    let destMunFromCep = isForeign
      ? dto.destMunicipio || 'EXTERIOR'
      : dto.destMunicipio || '';
    if (!isForeign && dto.destCep) {
      this.logger.log(
        `Buscando código IBGE para CEP do destinatário: ${dto.destCep}`,
      );
      const cepData = await fetchCepData(dto.destCep);
      if (cepData) {
        destCmun = parseInt(cepData.codigoIbge, 10) || 0;
        destUfFromCep = cepData.uf; // Usar UF do CEP para garantir consistência
        destMunFromCep = cepData.cidade; // Usar cidade do CEP
        this.logger.log(
          `Código IBGE do destinatário: ${destCmun} (${destMunFromCep}/${destUfFromCep})`,
        );
      } else {
        this.logger.warn(`CEP do destinatário não encontrado: ${dto.destCep}`);
      }
    } else if (!isForeign) {
      this.logger.warn('Destinatário sem CEP cadastrado');
    }

    // Validar que temos o código IBGE do destinatário
    if (!destCmun) {
      throw new BadRequestException(
        'CEP do destinatário é obrigatório para emissão de NF-e. Cadastre um CEP válido para o cliente.',
      );
    }

    return {
      config,
      environment,
      isForeign: !!isForeign,
      cleanReferencedNfe,
      now,
      dataSaida,
      destCmun,
      destUfFromCep,
      destMunFromCep,
    };
  }

  /**
   * Valores da nota. `vProd` é bruto e o desconto entra só em `vDesc`, porque
   * a SEFAZ valida vNF = vProd - vDesc + frete + seguro + outros. Os totais
   * somam os itens já arredondados como vão ao XML (`valoresDoItemNoXml`):
   * cada total é conferido com a soma dos itens.
   */
  private totaisDaNota(dto: EmitNfeDto) {
    return totaisDosItens(dto.items);
  }

  /**
   * `draftData` de uma tentativa de emissão: o DTO enviado, marcado com a
   * versão da regra dos itens (ver `itensParaReemitir`).
   */
  private draftDataDaEmissao(dto: EmitNfeDto): any {
    return { ...dto, versaoItens: VERSAO_ITENS_NOTA };
  }

  /** O.S. de uma nota: as do vínculo (consolidada) ou a da própria linha. */
  private async ordensDaNota(nfe: {
    id: string;
    orderId?: string | null;
  }): Promise<string[]> {
    const vinculos = await this.prisma.nfeOrder.findMany({
      where: { nfeId: nfe.id },
      select: { orderId: true },
    });
    const orderIds = vinculos.map((vinculo) => vinculo.orderId);
    if (!orderIds.length && nfe.orderId) orderIds.push(nfe.orderId);
    return [...new Set(orderIds)];
  }

  /**
   * Impressão das linhas das O.S. que geram os itens da nota. Muda quando a
   * O.S. muda o que a nota leva (produto, quantidade, valores, medidas ou
   * descrição) e não muda num salvamento sem alteração: não entram ids nem
   * datas, e as linhas são ordenadas pelo conteúdo.
   */
  private async impressaoDasLinhas(
    companyId: string,
    orderIds: string[],
  ): Promise<string> {
    const linhas = orderIds.length
      ? await this.prisma.quotationProduct.findMany({
          where: {
            quotation: { companyId, order: { id: { in: orderIds } } },
          },
          select: {
            productId: true,
            quantity: true,
            totalValue: true,
            finalValue: true,
            description: true,
            items: {
              select: {
                quantity: true,
                originalQuantity: true,
                unitKind: true,
                width: true,
                height: true,
                length: true,
                volume: true,
                weight: true,
                distance: true,
                duration: true,
              },
            },
          },
        })
      : [];

    const conteudo = linhas
      .map((linha) =>
        JSON.stringify([
          linha.productId,
          linha.quantity,
          linha.totalValue,
          linha.finalValue,
          linha.description,
          linha.items
            .map((item) =>
              JSON.stringify([
                item.quantity,
                item.originalQuantity,
                item.unitKind,
                item.width,
                item.height,
                item.length,
                item.volume,
                item.weight,
                item.distance,
                item.duration,
              ]),
            )
            .sort(),
        ]),
      )
      .sort();

    return createHash('sha1').update(JSON.stringify(conteudo)).digest('hex');
  }

  /**
   * Item do rascunho na forma da tela. O item gravado por PATCH traz o CFOP
   * como número (é o que o DTO aceita) e a tela trabalha com texto; o total é
   * sempre refeito pelos valores, e `isService` vem do cadastro atual.
   */
  private itemDoRascunhoParaTela(
    item: any,
    index: number,
    itensDaOrdem: any[],
  ) {
    const daOrdem = itensDaOrdem.find(
      (preparado) => preparado.productId === item.productId,
    );

    return {
      ...item,
      itemNumber: item.itemNumber ?? index + 1,
      unit: item.unit || item.uCom || 'UN',
      cfop:
        item.cfop === undefined || item.cfop === null ? '' : String(item.cfop),
      // Como a nota soma; a conta crua dava um centavo a menos que o
      // diálogo e o total ao reabrir (2,5 x R$ 4,01).
      totalValue: totalDoItemNaNota({
        quantity: item.quantity ?? 0,
        unitValue: item.unitValue ?? 0,
        discount: item.discount ?? 0,
        freight: item.freight ?? 0,
        insurance: item.insurance ?? 0,
      }),
      isService: daOrdem?.isService ?? item.isService ?? false,
    };
  }

  /**
   * Itens que a tela recebe ao reabrir um rascunho de NF-e de O.S.
   *
   * O rascunho guardava os itens do dia em que nasceu, e a tela nunca gravava
   * as edições: reabrir desfazia o que o usuário tinha ajustado (a GrafK
   * "altera e volta para o valor errado"), e uma O.S. corrigida depois não
   * chegava à nota. Agora:
   * - itens editados na tela (PATCH com `items`) ficam enquanto a O.S. não
   *   mudar depois da edição;
   * - sem edição, valem os itens da O.S. de agora, com o cadastro fiscal atual;
   * - rascunho da regra antiga (sem `versaoItens`) é refeito pela O.S.
   *
   * Quando vale a O.S., o rascunho é regravado com ela: é o total dele que a
   * lista de notas mostra. `editados` diz à tela que os itens não são os da
   * O.S., para ela manter o aviso de valores ajustados à mão; `origem` é a
   * impressão da O.S. de onde saem os itens, que a tela devolve no PATCH.
   */
  private async itensAoReabrirRascunho(
    companyId: string,
    draft: { id: string; draftData: unknown; updatedAt?: Date },
    itensDaOrdem: any[],
    orderIds: string[],
  ): Promise<{ itens: any[]; editados: boolean; origem: string }> {
    const draftData = (draft.draftData as Record<string, any>) || {};
    const editados =
      draftData.versaoItens === VERSAO_ITENS_NOTA &&
      draftData.itensEditados === true &&
      Array.isArray(draftData.items) &&
      draftData.items.length > 0;

    const atual = await this.impressaoDasLinhas(companyId, orderIds);
    const valeAEdicao = editados && atual === draftData.origemItens;
    const itens: any[] = valeAEdicao ? draftData.items : itensDaOrdem;

    if (!valeAEdicao) {
      // Conteúdo comparado sem a ordem das chaves: o jsonb não a guarda, e a
      // comparação direta regravava o rascunho a cada abertura.
      const desatualizado =
        draftData.versaoItens !== VERSAO_ITENS_NOTA ||
        draftData.itensEditados !== false ||
        draftData.origemItens !== atual ||
        jsonCanonico(draftData.items) !== jsonCanonico(itensDaOrdem);
      if (desatualizado) {
        // Só se o rascunho não mudou desde a leitura: um PATCH de itens
        // gravado nesse meio-tempo (outra aba) não pode ser desfeito aqui.
        await this.prisma.nfe.updateMany({
          where: {
            id: draft.id,
            ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
          },
          data: {
            valorTotal: totaisDosItens(itensDaOrdem).valorTotal,
            draftData: JSON.parse(
              JSON.stringify({
                ...draftData,
                items: itensDaOrdem,
                versaoItens: VERSAO_ITENS_NOTA,
                itensEditados: false,
                origemItens: atual,
              }),
            ),
          },
        });
      }
    }

    return {
      itens: itens.map((item, index) =>
        this.itemDoRascunhoParaTela(item, index, itensDaOrdem),
      ),
      editados: valeAEdicao,
      origem: atual,
    };
  }

  /**
   * Itens para reemitir uma NF-e rejeitada.
   *
   * Valem os da tentativa (o que o usuário mandou), com uma exceção: o item
   * da regra antiga (sem `versaoItens`) cujo desconto veio da O.S. Nele o
   * valor unitário já era o líquido e o desconto era abatido outra vez —
   * percentual lido como reais, acréscimo como desconto negativo —, e a SEFAZ
   * rejeitava pela soma dos descontos. Reemitido agora, passaria cobrando
   * menos que a venda; por isso os valores dele são refeitos pela O.S.
   *
   * O desconto veio da O.S. quando é negativo (só a regra antiga gerava) ou
   * quando a linha da O.S. tem desconto. Desconto digitado numa linha sem
   * desconto fica, assim como descrição e dados fiscais da tentativa.
   */
  /**
   * Relê do cadastro o CST de ICMS dos itens cujo código guardado não serve ao
   * regime do emissor.
   *
   * O CST do item vence o do cadastro no cálculo — é o que permite mudar a
   * tributação de uma operação específica. Mas a tentativa rejeitada guardou o
   * código que ERA o do cadastro, e "Corrigir e reemitir" existe justamente
   * para depois de arrumar o cadastro: sem reler, a nota volta a sair com o
   * CSOSN que o cálculo acabou de recusar, e quem corrigiu os produtos conclui
   * que a correção não funcionou.
   *
   * Troca só o código do outro regime (CSOSN em emissor do Regime Normal, CST
   * em optante do Simples), que nunca é escolha deliberada: o cálculo o
   * recusa, e a SEFAZ também. Um CST válido digitado na nota continua valendo.
   */
  private async itensComCstDoRegime(
    companyId: string,
    nfe: { invoicyConfigId?: string | null },
    itens: any[],
  ): Promise<any[]> {
    const productIds = [
      ...new Set(itens.map((item) => item?.productId).filter(Boolean)),
    ] as string[];
    if (!productIds.length) return itens;

    // O emissor da tentativa, não o padrão de hoje: a nota pode ter saído por
    // outro, com regime diferente.
    const emissor = await this.prisma.invoicyConfig.findFirst({
      where: nfe.invoicyConfigId
        ? { id: nfe.invoicyConfigId, companyId }
        : { companyId, isDefault: true },
      select: { emitCrt: true },
    });

    const doOutroRegime = new Set(codigosCstDeOutroRegime(emissor?.emitCrt));
    const precisaReler = itens.some((item) =>
      doOutroRegime.has(String(item?.cstIcms ?? '').trim()),
    );
    if (!precisaReler) return itens;

    const fiscais = await this.prisma.productFiscalData.findMany({
      where: { productId: { in: productIds }, product: { companyId } },
      select: { productId: true, icmsCst: true },
    });
    const porProduto = new Map(fiscais.map((f) => [f.productId, f]));

    return itens.map((item) => {
      const guardado = String(item?.cstIcms ?? '').trim();
      if (!doOutroRegime.has(guardado)) return item;

      const doCadastro = (
        porProduto.get(item?.productId)?.icmsCst || ''
      ).trim();
      // Cadastro ainda não corrigido: mantém o código e deixa o cálculo barrar
      // com a mensagem que manda arrumar o produto. Apagar aqui trocaria essa
      // orientação por um erro de campo vazio.
      if (!doCadastro || doOutroRegime.has(doCadastro)) return item;

      this.logger.log(
        `Reemissão: item ${item?.productId} tinha CST ${guardado}, do outro ` +
          `regime; relido do cadastro como ${doCadastro}.`,
      );
      return { ...item, cstIcms: doCadastro };
    });
  }

  private async itensParaReemitir(
    companyId: string,
    nfe: { id: string; orderId?: string | null },
    draftData: any,
    itens: any[],
  ): Promise<any[]> {
    const regraAntiga = draftData?.versaoItens !== VERSAO_ITENS_NOTA;
    const comDesconto = itens.some((item) => Number(item?.discount || 0) !== 0);
    if (!regraAntiga || !comDesconto) return itens;

    // Na ordem em que a tentativa foi montada (o DTO da consolidada guarda
    // `orderIds`): o vínculo nfe_orders não tem ordem, e o mesmo produto em
    // duas O.S. casaria com a linha da O.S. errada.
    const orderIds: string[] =
      Array.isArray(draftData?.orderIds) && draftData.orderIds.length
        ? [...new Set<string>(draftData.orderIds)]
        : await this.ordensDaNota(nfe);
    if (!orderIds.length) return itens;

    // O.S. por O.S., sem a checagem da consolidada: um rascunho aberto para
    // as mesmas O.S. não pode impedir de corrigir a tentativa.
    const daOrdem: any[] = [];
    for (const orderId of orderIds) {
      try {
        daOrdem.push(
          ...(await this.prepareFromOrder(companyId, orderId)).items,
        );
      } catch (e) {
        this.logger.warn(
          `Reemissão da NF-e ${nfe.id} sem refazer os itens pela O.S. ${orderId}: ${e.message}`,
        );
        return itens;
      }
    }

    // Casa cada item com a linha da O.S. pela ordem dentro do mesmo produto.
    const porProduto = new Map<string, any[]>();
    for (const linha of daOrdem) {
      const lista = porProduto.get(linha.productId) || [];
      lista.push(linha);
      porProduto.set(linha.productId, lista);
    }
    const usados = new Map<string, number>();

    return itens.map((item) => {
      const ordem = usados.get(item?.productId) || 0;
      usados.set(item?.productId, ordem + 1);
      const linha = porProduto.get(item?.productId)?.[ordem];
      const descontoDaTentativa = Number(item?.discount || 0);
      const veioDaOrdem =
        descontoDaTentativa < 0 ||
        (descontoDaTentativa > 0 && Number(linha?.discount || 0) > 0);
      if (!linha || !veioDaOrdem) return item;

      return {
        ...item,
        quantity: linha.quantity,
        unit: linha.unit,
        uCom: linha.uCom,
        unitValue: linha.unitValue,
        discount: linha.discount,
        totalValue: linha.totalValue,
      };
    });
  }

  async emit(companyId: string, dto: EmitNfeDto) {
    const ctx = await this.resolveNfeEmissionContext(companyId, dto);
    const { config, environment } = ctx;

    // Reserva ATÔMICA do número, antes de qualquer transmissão.
    //
    // Antes: lia `config.proximoNumeroNfe` sem lock e só incrementava após a
    // autorização — duas emissões concorrentes montavam o payload com o mesmo
    // número e a segunda era rejeitada como duplicada pela SEFAZ.
    // Mesmo contrato já usado pela NFC-e (reserveNfceNumber).
    const { reservedNumber: numero, series: serieReservada } =
      await this.prisma.$transaction((tx) =>
        this.fiscalCredentialResolver.reserveNfeNumber(
          tx,
          config.id,
          environment,
        ),
      );

    const { valorTotal } = this.totaisDaNota(dto);

    // Criar ou atualizar registro da NF-e
    let nfe;
    const consolidatedOrderIds = [
      ...new Set((dto.orderIds || []).filter(Boolean)),
    ];

    // Tentativa anterior REJEITADA, informada pelo cliente ao reemitir.
    //
    // Nota rejeitada nunca existiu na SEFAZ, entao reaproveitar a linha e
    // legitimo — e evita uma linha nova a cada tentativa, que era o que
    // acontecia na emissao avulsa: sem orderId, o fluxo caia direto no create.
    // O motivo da rejeicao anterior e sobrescrito de proposito: o que importa
    // na tela e o da ultima tentativa.
    if (dto.reissueOfNfeId) {
      const anterior = await this.prisma.nfe.findFirst({
        where: {
          id: dto.reissueOfNfeId,
          companyId,
          status: NfeStatus.REJECTED,
        },
      });

      if (anterior) {
        nfe = await this.prisma.nfe.update({
          where: { id: anterior.id },
          data: {
            numero,
            serie: serieReservada,
            status: NfeStatus.PROCESSING,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            invoicyConfigId: config.id,
            valorTotal,
            motivoRejeicao: null,
            chaveAcesso: null,
            draftData: this.draftDataDaEmissao(dto),
          },
        });
      }
    }

    // Se for vinculada a ordens consolidadas, buscar rascunho pela pivot
    if (!nfe && consolidatedOrderIds.length > 1) {
      const draftNfes = (await this.prisma.nfe.findMany({
        where: {
          companyId,
          status: NfeStatus.DRAFT,
          orders: {
            some: {
              orderId: { in: consolidatedOrderIds },
            },
          },
        },
        include: {
          orders: true,
        },
      })) as any[];

      const draftNfe = draftNfes.find((draft) => {
        const draftOrderIds = draft.orders.map((item) => item.orderId).sort();
        return (
          draftOrderIds.length === consolidatedOrderIds.length &&
          draftOrderIds.join('|') === [...consolidatedOrderIds].sort().join('|')
        );
      });

      if (draftNfe) {
        nfe = await this.prisma.nfe.update({
          where: { id: draftNfe.id },
          data: {
            numero,
            serie: serieReservada,
            status: NfeStatus.PROCESSING,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            invoicyConfigId: config.id,
            valorTotal,
            motivoRejeicao: null,
            draftData: this.draftDataDaEmissao(dto),
          },
        });
      }
    } else if (!nfe && dto.orderId) {
      // REJECTED entra junto com DRAFT: so o rascunho era reaproveitado, entao
      // da segunda tentativa em diante a nota da ordem tambem virava linha nova.
      const draftNfe = await this.prisma.nfe.findFirst({
        where: {
          companyId,
          orderId: dto.orderId,
          status: { in: [NfeStatus.DRAFT, NfeStatus.REJECTED] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (draftNfe) {
        nfe = await this.prisma.nfe.update({
          where: { id: draftNfe.id },
          data: {
            numero,
            serie: serieReservada,
            status: NfeStatus.PROCESSING,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            invoicyConfigId: config.id,
            valorTotal,
            // Limpar possível mensagem de erro anterior ao tentar emitir novamente
            motivoRejeicao: null,
            draftData: this.draftDataDaEmissao(dto),
          },
        });
      }
    }

    // Se não encontrou rascunho (ou é avulsa sem ordem), cria nova
    if (!nfe) {
      nfe = await this.prisma.nfe.create({
        data: {
          companyId,
          orderId: dto.orderId,
          quotationId: dto.quotationId,
          numero,
          serie: serieReservada,
          status: NfeStatus.PROCESSING,
          ambiente: environment === 'PRODUCAO' ? 1 : 2,
          invoicyConfigId: config.id,
          valorTotal,
          draftData: this.draftDataDaEmissao(dto),
        },
      });
    }

    if (consolidatedOrderIds.length > 1) {
      await this.prisma.nfeOrder.createMany({
        data: consolidatedOrderIds.map((orderId) => ({
          nfeId: nfe.id,
          orderId,
        })),
        skipDuplicates: true,
      });
    } else if (dto.orderId) {
      await this.prisma.nfeOrder.createMany({
        data: [{ nfeId: nfe.id, orderId: dto.orderId }],
        skipDuplicates: true,
      });
    }

    try {
      this.logger.log(`Emitindo NF-e ${numero} para empresa ${companyId}`);

      const montagem = await this.buildNfeInvoicyRequest(companyId, dto, ctx, {
        numero,
        serie: serieReservada,
      });
      const { invoicyRequest } = montagem;

      // O cache do IBGE do emitente é o único efeito que a montagem produz;
      // a pré-visualização o descobre igual, mas não grava.
      if (montagem.emitCmunResolvidoViaCep) {
        await this.prisma.invoicyConfig.update({
          where: { id: config.id },
          data: { emitCmun: montagem.emitCmunResolvidoViaCep },
        });
        this.logger.log(`IBGE do emitente persistido no InvoicyConfig`);
      }

      // Persistir o payload ANTES de transmitir: se a chamada falhar ou o
      // processo cair, o snapshot do que seria enviado continua disponível
      // para diagnóstico e para devolução/CC-e posteriores.
      await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: { invoicyPayloadEnvio: invoicyRequest as any },
      });

      // Chamar API do Invoicy
      // O ambiente resolvido para o payload (ide.tpAmb) vai junto: sem ele o
      // transporte resolveria de novo, pelo campo global activeEnvironment.
      const invoicyResponses = await this.invoicyApiService.emitNfe(
        companyId,
        [invoicyRequest],
        config.id,
        environment,
      );
      return await this.processarRespostaEmissao({
        dto,
        nfe,
        config,
        environment,
        numero,
        invoicyResponses,
      });
    } catch (error) {
      return await this.tratarFalhaEmissao({ nfe, numero, error });
    }
  }

  /**
   * Pré-visualização da NF-e antes de emitir.
   *
   * Roda o mesmo contexto e o mesmo montador da emissão — é o que garante que
   * a prévia mostre o que será enviado, e não uma segunda versão da verdade
   * que envelhece sozinha. Não reserva número, não cria registro, não chama o
   * provedor. Cobre emissão por ordem, avulsa e consolidada, porque as três
   * telas mandam o mesmo `EmitNfeDto`.
   *
   * Devolve 200 mesmo quando a nota não pode ser emitida: a prévia existe
   * justamente para mostrar o que corrigir. Quem lança é o `emit`.
   */
  async preview(companyId: string, dto: EmitNfeDto): Promise<NfePreview> {
    const ctx = await this.resolveNfeEmissionContext(companyId, dto);
    const numeracao = ctx.config.activeNumbering?.nfe;

    let montagem: NfeMontagem;
    try {
      montagem = await this.buildNfeInvoicyRequest(companyId, dto, ctx, {
        numero: numeracao?.nextNumber ?? ctx.config.proximoNumeroNfe ?? 1,
        serie: numeracao?.series ?? ctx.config.serieNfe ?? 1,
      });
    } catch (error) {
      const mensagem = error?.message ?? 'Não foi possível montar a nota.';
      return {
        podeEmitir: false,
        // As mensagens do montador já vêm em lista quando são várias.
        bloqueios: String(mensagem)
          .split(String.fromCharCode(10))
          .map((linha) => linha.trim())
          .filter(Boolean),
        avisos: [],
      };
    }

    const { invoicyRequest: payload, impostosCalculados } = montagem;

    // Logo, telefone e e-mail do emitente aparecem no quadro do emitente da
    // DANFE, mas não fazem parte do payload nem do mapeamento do emissor. São
    // lidos só aqui, para a prévia; a emissão não muda.
    let empresa: {
      logoUrl: string | null;
      phone: string | null;
      mobile: string | null;
      email: string | null;
    } | null = null;
    try {
      empresa = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { logoUrl: true, phone: true, mobile: true, email: true },
      });
    } catch {
      empresa = null;
    }
    const doc = payload.Documento;

    return {
      podeEmitir: true,
      bloqueios: [],
      avisos: [
        'Número previsto: o definitivo é reservado no momento da emissão.',
        ...montagem.avisos,
      ],
      documento: {
        modelo: doc.ide.mod,
        ambiente: ctx.environment,
        numeroPrevisto: doc.ide.nNF,
        serie: doc.ide.serie,
        naturezaOperacao: doc.ide.natOp,
        tipo: doc.ide.tpNf,
        finalidade: doc.ide.finNFe,
        idDest: doc.ide.idDest,
        indFinal: doc.ide.indFinal,
        indPres: doc.ide.indPres,
        dataEmissaoPrevista: doc.ide.dhEmi,
        dataSaidaEntrada: doc.ide.dhSaiEnt,
        nfeReferenciada: ctx.cleanReferencedNfe || undefined,
      },
      emitente: doc.emit,
      emitenteContato: {
        logoUrl: empresa?.logoUrl ?? null,
        fone: empresa?.phone || empresa?.mobile || null,
        email: empresa?.email ?? null,
      },
      destinatario: doc.dest,
      entrega: doc.entrega ?? null,
      itens: doc.det.map((item: any, index: number) => ({
        sequencia: index + 1,
        ...item.prod,
        tributos: item.imposto,
      })),
      totais: {
        ...doc.total,
        // Repetidos fora do grupo do layout para a tela não ter de conhecê-lo.
        valorProdutos: montagem.valorProdutos,
        valorNota: montagem.valorTotal,
        temImpostoCalculado: !!impostosCalculados,
      },
      transporte: doc.transp,
      pagamento: doc.pag?.[0],
      duplicatas: doc.cobr?.dup ?? [],
      autXml: doc.autXML ?? [],
      informacoesComplementares: doc.infAdic?.infCpl ?? null,
      payloadInvoicy: payload,
    };
  }

  /**
   * Monta o payload do Invoicy a partir do DTO e do contexto.
   *
   * Puro em relação ao banco: lê cadastro fiscal e natureza de operação, mas
   * não escreve nada — o único efeito que existia aqui (cache do IBGE do
   * emitente) sai como `emitCmunResolvidoViaCep` para quem chamou decidir.
   * É esta função que a pré-visualização executa, e é por isso que a prévia
   * mostra exatamente o que seria transmitido.
   */
  private async buildNfeInvoicyRequest(
    companyId: string,
    dto: EmitNfeDto,
    ctx: NfeEmissionContext,
    numeracao: { numero: number; serie?: number | null },
  ): Promise<NfeMontagem> {
    const {
      config,
      environment,
      isForeign,
      cleanReferencedNfe,
      now,
      dataSaida,
      destCmun,
      destUfFromCep,
      destMunFromCep,
    } = ctx;
    const { numero, serie: serieReservada } = numeracao;
    const {
      valorProdutos,
      valorDesconto,
      valorFrete,
      valorSeguro,
      valorTotal,
    } = this.totaisDaNota(dto);
    const valoresDosItens = dto.items.map((item) => valoresDoItemNoXml(item));
    let emitCmunResolvidoViaCep: string | undefined;

    {
      // Ensure we have emitter IBGE code
      let emitCmun = config.ibgeCode;
      const emitCep = config.company.address.zipcode;

      if (!emitCmun && emitCep) {
        this.logger.log(
          `Emitente (Empresa) sem código IBGE configurado. Buscando via CEP do emitente: ${emitCep}`,
        );
        const cepData = await fetchCepData(emitCep);
        if (cepData) {
          emitCmun = cepData.codigoIbge;
          this.logger.log(`IBGE do emitente encontrado: ${emitCmun}`);

          // Cache IBGE code to avoid external API calls on subsequent emissions.
          // Escopado ao emissor desta emissão — emissores distintos podem ter
          // endereços (e portanto municípios) diferentes. Quem chamou grava:
          // a pré-visualização usa o valor e não escreve.
          emitCmunResolvidoViaCep = emitCmun;
        } else {
          this.logger.warn(
            `Não foi possível encontrar IBGE para CEP do emitente: ${emitCep}`,
          );
        }
      }

      // Natureza de operação cadastrada, quando existir. O catálogo
      // OperationNature já carrega o trio que precisa viajar coerente
      // (finalidade, presença do consumidor e CFOP interno/interestadual),
      // mas nada disso era lido na emissão — o CFOP saía de aritmética
      // ±1000 sobre um escalar por empresa.
      //
      // Opt-in por DADO, não por flag: só entra em cena quando a empresa
      // cadastrou a natureza E preencheu os CFOPs. Sem isso, o caminho
      // anterior é preservado integralmente.
      const naturezaDescricao =
        dto.operationNature || config.defaultOperationNature || null;
      const natureza = naturezaDescricao
        ? await this.prisma.operationNature.findFirst({
            where: {
              companyId,
              description: naturezaDescricao,
              isActive: true,
            },
            include: { cfopInternal: true, cfopExternal: true },
          })
        : null;

      // Resolver o CFOP de cada item ANTES de montar o payload: o tipo do
      // documento (tpNF) precisa ser coerente com a família do CFOP, senão a
      // SEFAZ rejeita (CFOP de entrada em documento de saída).
      const isInterestadual = destUfFromCep !== config.company.address.state;
      const isDevolucao = dto.finalidade === 4;

      // CFOP declarado pela natureza para o escopo desta operação.
      const cfopDaNatureza = isInterestadual
        ? natureza?.cfopExternal?.code
        : natureza?.cfopInternal?.code;

      /**
       * Regime Normal calcula e destaca o imposto de cada item; o Simples
       * Nacional segue o caminho antigo, que envia apenas os códigos — é o que
       * mantém inalteradas as notas de quem já emite hoje.
       */
      const regimeNormal = isRegimeNormal(config.emitCrt);
      const impostosCalculados = regimeNormal
        ? await this.calcularImpostosRegimeNormal(companyId, dto, config, {
            ufOrigem: config.company.address.state,
            ufDestino: destUfFromCep,
            interestadual: isInterestadual,
          })
        : null;

      if (impostosCalculados?.bloqueios.length) {
        // Barrar aqui é deliberado: sem os dados de cálculo a nota sairia com
        // imposto zerado, que é pior do que não sair.
        throw new BadRequestException(
          [
            'Não foi possível calcular os impostos da NF-e:',
            ...impostosCalculados.bloqueios,
          ].join(String.fromCharCode(10)),
        );
      }

      /**
       * Total da nota com os tributos que o destinatário paga por fora.
       *
       * `vNF` soma vST, vFCPST e vIPI (tag W16). Enquanto só o Simples emitia,
       * esses valores eram sempre zero e `valorTotal` servia como vNF; no
       * Regime Normal, a primeira nota com ST ou IPI sairia com vNF menor que
       * a soma dos itens e voltaria rejeitada pela SEFAZ.
       *
       * O mesmo valor serve a vNF, ao pagamento e à cobrança: a SEFAZ confere
       * o pagamento contra vNF, e deixar o vPag no total sem os tributos
       * trocaria uma rejeição por outra.
       */
      const valorTotalNota = arredondar(
        valorTotal + (impostosCalculados?.acrescimosNoTotal ?? 0),
        2,
      );

      const resolvedCfops = dto.items.map((item) => {
        // Precedência: CFOP do item > CFOP da natureza > default do emissor.
        // O item vence porque um produto pode legitimamente exigir CFOP
        // distinto do resto da nota (ex: 5101 produção própria vs 5102
        // revenda) — a natureza descreve a operação, não cada mercadoria.
        const baseCfop =
          item.cfop ||
          (cfopDaNatureza ? parseInt(cfopDaNatureza, 10) : undefined) ||
          parseInt(config.defaultCfop || '5102', 10);

        return this.resolveItemCfop({
          baseCfop,
          isForeign,
          isInterestadual,
          isDevolucao,
        });
      });

      const hasCfopEntrada = resolvedCfops.some((c) => this.isCfopEntrada(c));
      const hasCfopSaida = resolvedCfops.some((c) => !this.isCfopEntrada(c));
      if (hasCfopEntrada && hasCfopSaida) {
        throw new BadRequestException(
          'A nota mistura CFOP de entrada e de saída no mesmo documento. ' +
            'Separe os itens em notas distintas.',
        );
      }

      // CFOP de entrada obriga documento de entrada; caso contrário respeita o DTO.
      const tipoDocumento = hasCfopEntrada ? 0 : (dto.tipo ?? 1);

      this.assertFiscalItemsReady(dto.items, resolvedCfops);

      // Finalidade e presença do consumidor herdadas da natureza quando a
      // emissão não as informa. Campos são String no modelo; ignora valor
      // não-numérico em vez de gerar NaN no XML.
      const parseNat = (v?: string | null): number | undefined => {
        if (v === null || v === undefined || v === '') return undefined;
        const n = Number(v);
        return Number.isInteger(n) ? n : undefined;
      };
      const finalidadeNatureza = parseNat(natureza?.finality);
      const presencaNatureza = parseNat(natureza?.consumerPresence);

      // Construir payload para o Invoicy
      const invoicyRequest: InvoicyNfeRequest = {
        Documento: {
          ModeloDocumento: 'NFe',
          Versao: 4,
          ide: {
            cUF: this.getUfCode(config.company.address.state),
            natOp:
              dto.operationNature ||
              config.defaultOperationNature ||
              'Venda de mercadoria',
            mod: '55',
            serie: serieReservada?.toString() || '1',
            nNF: numero,
            dhEmi: now.toISOString(),
            dhSaiEnt: dataSaida.toISOString(),
            fusoHorario: '-03:00',
            tpNf: tipoDocumento, // 0 = Entrada, 1 = Saida
            // Mesma regra da tela; aqui a UF vem do CEP, que e o dado que
            // tambem alimenta cMun.
            idDest: this.resolveDestinoOperacao(
              destUfFromCep,
              config.company.address.state,
              isForeign,
            ),
            cMunFg: parseInt(emitCmun || '0', 10),
            tpImp: 1, // DANFE retrato
            tpEmis: 1, // Emissão normal
            cDV: 0, // Será calculado pelo Invoicy
            tpAmb: environment === 'PRODUCAO' ? 1 : 2,
            finNFe: dto.finalidade ?? finalidadeNatureza ?? 1, // NF-e normal
            indFinal:
              dto.consumidorFinal ??
              (dto.destCnpjCpf?.replace(/\D/g, '').length === 11 ? 1 : 0),
            indPres: dto.presencaConsumidor ?? presencaNatureza ?? 1,
            procEmi: 0, // Aplicativo do contribuinte
            verProc: 'Atrupe 1.0',
            // `NFRef`, com R maiusculo: e o nome no contrato do provedor
            // (Envio_NFe-NFCe 4.0.xsd), que casa chaves com diferenca de caixa.
            // Enviavamos `NFref` — a grafia da tag no XML da SEFAZ —, o provedor
            // ignorava a chave desconhecida e a nota saia sem documento
            // referenciado: rejeicao 321 em toda devolucao.
            //
            // O nivel `NFRefItem` do XSD fica implicito no array, como em
            // det/detItem, dup/dupItem e pag/pagItem, que ja funcionam assim.
            ...(cleanReferencedNfe
              ? { NFRef: [{ refNFe: cleanReferencedNfe }] }
              : {}),
          },
          emit: {
            CNPJ_emit: (config.company.cnpj || '').replace(/\D/g, ''),
            xNome: config.company.legalName || '',
            IE: (config.company.stateRegistration || '').replace(/\D/g, ''),
            // IM com espaco sobrando (comum em dado migrado) reprovava no
            // schema; so espacos vira vazio, que tambem reprova, e o campo e
            // opcional — entao sai do payload.
            IM:
              sanitizeFiscalText(config.company.municipalRegistration) ||
              undefined,
            CRT: config.emitCrt || 1,
            enderEmit: {
              xLgr: config.company.address.street || '',
              nro: config.company.address.number || 'S/N',
              xBairro: config.company.address.neighborhood || '',
              cMun: parseInt(emitCmun || '0', 10),
              xMun: config.company.address.city || '',
              UF: config.company.address.state || '',
              CEP:
                parseInt(
                  (config.company.address.zipcode || '').replace(/\D/g, ''),
                  10,
                ) || 0,
            },
          },
          dest: {
            ...(isForeign
              ? { idEstrangeiro: dto.destIdEstrangeiro || 'ESTRANGEIRO' }
              : {
                  ...(dto.destCnpjCpf?.replace(/\D/g, '').length === 14
                    ? { CNPJ_dest: dto.destCnpjCpf.replace(/\D/g, '') }
                    : {}),
                  ...(dto.destCnpjCpf?.replace(/\D/g, '').length === 11
                    ? { CPF_dest: dto.destCnpjCpf.replace(/\D/g, '') }
                    : {}),
                }),
            // Em homologação, SEFAZ exige este nome exato para o destinatário
            xNome_dest:
              environment === 'HOMOLOGACAO'
                ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
                : dto.destNome || '',
            indIEDest: isForeign ? 9 : (dto.destIndIEDest ?? 9),
            ...(!isForeign && dto.destIndIEDest === 1 && dto.destIe
              ? { IE_dest: dto.destIe.replace(/\D/g, '') }
              : {}),
            enderDest: {
              xLgr_dest: dto.destEndereco || '',
              nro_dest: dto.destNumero || 'S/N',
              xBairro_dest: dto.destBairro || '',
              cMun_dest: destCmun, // Código IBGE do município do destinatário
              xMun_dest: destMunFromCep, // Nome do município (do CEP)
              UF_dest: destUfFromCep, // UF do destinatário (do CEP para garantir consistência)
              ...(!isForeign
                ? {
                    CEP_dest:
                      parseInt((dto.destCep || '').replace(/\D/g, ''), 10) || 0,
                  }
                : {}),
              cPais_dest: parseInt(dto.destPais || '1058', 10),
            },
          },
          entrega: await this.buildEntregaInline(dto),
          det: dto.items.map((item, index) => ({
            prod: {
              // cProd e a coluna "COD. PROD." do DANFE: tem de ser o codigo
              // cadastrado do produto. Vinha o id interno (UUID) porque o
              // codigo nao era enviado pela tela nem existia no DTO, e era
              // esse UUID que o cliente final via impresso na nota.
              cProd: item.productCode || item.productId || `ITEM${index + 1}`,
              cEAN:
                item.ean &&
                /^\d+$/.test(item.ean) &&
                [8, 12, 13, 14].includes(item.ean.length)
                  ? item.ean
                  : 'SEM GTIN',
              cEANTrib:
                item.ceantrib &&
                /^\d+$/.test(item.ceantrib) &&
                [8, 12, 13, 14].includes(item.ceantrib.length)
                  ? item.ceantrib
                  : 'SEM GTIN',
              xProd: item.description || `Produto ${index + 1}`,
              NCM: (item.ncm || '00000000').replace(/\D/g, ''),
              CFOP: resolvedCfops[index],
              uCOM: item.uCom || 'UN',
              qCOM: valoresDosItens[index].quantidade.toFixed(4),
              vUnCom: item.unitValue.toFixed(10),
              vProd: valoresDosItens[index].valorProduto.toFixed(2),
              uTrib: item.uCom || 'UN', // Usually same as uCom
              qTrib: valoresDosItens[index].quantidade.toFixed(4),
              vUnTrib: item.unitValue.toFixed(10),
              // Frete e seguro do item, logo depois de vUnTrib, na ordem do
              // leiaute. A tela os somava no total e a base do ICMS também,
              // mas o XML não os levava: a nota saía sem eles.
              ...(valoresDosItens[index].frete > 0
                ? { vFrete: valoresDosItens[index].frete.toFixed(2) }
                : {}),
              ...(valoresDosItens[index].seguro > 0
                ? { vSeg: valoresDosItens[index].seguro.toFixed(2) }
                : {}),
              // Desconto do item, entre vSeg e vOutro_item como pede o
              // leiaute. Só o total levava vDesc, e a SEFAZ rejeitava toda nota
              // com desconto porque o total não batia com a soma dos itens. O
              // schema não aceita 0.00, por isso o campo só vai com valor.
              ...(valoresDosItens[index].desconto > 0
                ? { vDesc: valoresDosItens[index].desconto.toFixed(2) }
                : {}),
              indTot: 1,
            },
            // Regime Normal usa o imposto calculado; Simples mantém os
            // códigos, que é o que a apuração dele exige.
            imposto: impostosCalculados?.impostos[index] ?? {
              ICMS: {
                orig: 0, // Nacional
                CST: item.cstIcms || '102', // Default Simples Nacional if missing
              },
              PIS: {
                CST_pis: item.cstPis || '49',
              },
              COFINS: {
                CST_cofins: item.cstCofins || '49',
              },
              // O schema exige `cEnq` ao lado e o CST dentro de `CSTIPI`. O
              // formato antigo, com `CST_ipi` solto, nao existe no layout: o
              // grupo ia sem os dois filhos obrigatorios e era descartado.
              IPI: {
                cEnq: '999',
                CSTIPI: { CST_IPI: item.cstIpi || '99' },
              },
            },
          })),
          total: {
            ICMStot: {
              // Sem cálculo (Simples), os totalizadores seguem zerados: a
              // apuração é no documento único de arrecadação, não na nota.
              ...(impostosCalculados?.totais ?? {
                vBC_ttlnfe: '0.00',
                vICMS_ttlnfe: '0.00',
                vBCST_ttlnfe: '0.00',
                vIPI_ttlnfe: '0.00',
                vPIS_ttlnfe: '0.00',
                vCOFINS_ttlnfe: '0.00',
              }),
              vICMSDeson_ttlnfe: '0.00',
              vProd_ttlnfe: valorProdutos.toFixed(2),
              vFrete_ttlnfe: valorFrete.toFixed(2),
              vSeg_ttlnfe: valorSeguro.toFixed(2),
              vDesc_ttlnfe: valorDesconto.toFixed(2),
              vII_ttlnfe: '0.00',
              vOutro: '0.00',
              vNF: valorTotalNota.toFixed(2),
            },
            // Totalizador da Reforma. `vNFIBScbsIS` e' irmao de ICMStot, nao
            // filho: e' o total COM os novos tributos, que a regra nacional
            // manda nao somar em vProd/vNF durante 2025 e 2026.
            ...(impostosCalculados?.ibsCbsTotais
              ? {
                  IBSCBSTot: impostosCalculados.ibsCbsTotais,
                  vNFIBScbsIS: calcularVNFIBScbsIS(
                    valorTotalNota,
                    impostosCalculados.ibsCbsTotais,
                  ),
                }
              : {}),
          },
          pag: [
            {
              tPag: dto.pagamento?.forma || '99',
              vPag:
                dto.pagamento?.forma === '90'
                  ? '0.00'
                  : valorTotalNota.toFixed(2),
            },
          ],
          transp: {
            modFrete: String(dto.modalidadeFrete ?? 9),
          },
          // Informações adicionais / complementares
          // infCpl e texto livre digitado pelo usuario: sem limpeza, uma quebra
          // de linha colada de outro sistema derruba a validacao do XML com um
          // erro generico que nao aponta o campo.
          ...(() => {
            const infCpl = sanitizeInfCpl(
              dto.additionalInfo || (config as any).taxInfoText,
            );
            return infCpl ? { infAdic: { infCpl } } : {};
          })(),
          // Duplicatas/Cobrança
          ...(dto.duplicatas && dto.duplicatas.length > 0
            ? {
                cobr: {
                  fat: {
                    nFat: numero.toString(),
                    vOrig: valorTotalNota.toFixed(2),
                    vDesc: '0.00',
                    vLiq: valorTotalNota.toFixed(2),
                  },
                  dup: dto.duplicatas.map((d) => ({
                    nDup: d.numero || '',
                    dVenc: d.dataVencimento || '',
                    vDup: (d.valor || 0).toFixed(2),
                  })),
                },
              }
            : {}),
          // Autorização de download
          ...(dto.autXml && dto.autXml.length > 0
            ? {
                autXML: dto.autXml.map((doc) => {
                  const cleanDoc = doc.replace(/\D/g, '');
                  return cleanDoc.length === 14
                    ? { CNPJ: cleanDoc }
                    : { CPF: cleanDoc };
                }),
              }
            : {}),
        },
      };

      // Avisos: o que a nota faz e o usuário não pediu explicitamente. Não
      // bloqueiam nada; existem para a pré-visualização explicar antes, em vez
      // de o usuário descobrir depois de autorizar.
      const avisos: string[] = [];
      if (environment === 'HOMOLOGACAO') {
        avisos.push(
          'Ambiente de homologação: a nota não tem valor fiscal e o nome do destinatário é substituído pelo texto exigido pela SEFAZ.',
        );
      }
      if (!regimeNormal) {
        avisos.push(
          'Emissor no Simples Nacional: a nota leva só os códigos de tributação, sem destaque de imposto — a apuração é no documento único de arrecadação.',
        );
      }
      if (cfopDaNatureza && dto.items.some((item) => !item.cfop)) {
        avisos.push(
          `Itens sem CFOP próprio usam o ${cfopDaNatureza}, da natureza de operação.`,
        );
      }
      if (tipoDocumento === 0 && (dto.tipo ?? 1) === 1) {
        avisos.push(
          'A nota sai como documento de entrada porque os CFOPs dos itens são de entrada.',
        );
      }
      const semGtin = dto.items.filter(
        (item, index) =>
          !!item.ean &&
          invoicyRequest.Documento.det[index]?.prod?.cEAN === 'SEM GTIN',
      );
      if (semGtin.length > 0) {
        avisos.push(
          `${semGtin.length} item(ns) com código de barras fora do padrão GTIN: a nota sai com "SEM GTIN".`,
        );
      }

      return {
        // Normaliza o payload inteiro: espaco nas pontas e caractere de
        // controle reprovam no schema da NF-e, e um campo esquecido custa
        // uma rejeicao ilegivel para o cliente.
        invoicyRequest: normalizeFiscalStrings(invoicyRequest),
        impostosCalculados,
        resolvedCfops,
        tipoDocumento,
        valorProdutos,
        // O valor da nota é o vNF transmitido, com ST, FCP-ST e IPI: é o que
        // a listagem, o financeiro e a DANFE precisam mostrar.
        valorTotal: valorTotalNota,
        emitCmun,
        emitCmunResolvidoViaCep,
        avisos,
      };
    }
  }

  /**
   * Grava a resposta da SEFAZ na NF-e e devolve o registro atualizado.
   * Rejeição conclusiva devolve o número reservado e vira 400.
   */
  private async processarRespostaEmissao(params: {
    dto: EmitNfeDto;
    nfe: any;
    config: any;
    environment: FiscalEnvironment;
    numero: number;
    invoicyResponses: InvoicyResponse[];
  }) {
    const { dto, nfe, config, environment, numero, invoicyResponses } = params;

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
    if (!doc) {
      throw new Error('Documento não retornado pelo Invoicy');
    }

    // Verificar situação do documento
    const situacao = doc.Situacao;
    const isAuthorized =
      situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;

    // Check for key collision before updating
    if (doc.DocChaAcesso) {
      const conflictingNfe = await this.prisma.nfe.findFirst({
        where: {
          chaveAcesso: doc.DocChaAcesso,
          id: { not: nfe.id },
        },
      });

      if (conflictingNfe) {
        this.logger.warn(
          `Conflito de chave de acesso detectado. NFe antiga: ${conflictingNfe.id}, Nova NFe: ${nfe.id}. Removendo chave da antiga para prosseguir.`,
        );
        // Opção: Limpar a chave da antiga ou deletá-la se for lixo/rejeitada.
        // Como estamos em um novo processo, vamos limpar a chave da antiga para permitir a atualização.
        await this.prisma.nfe.update({
          where: { id: conflictingNfe.id },
          data: { chaveAcesso: null },
        });
      }
    }

    // Atualizar NF-e com resposta
    const updatedNfe = await this.prisma.nfe.update({
      where: { id: nfe.id },
      data: {
        status: isAuthorized ? NfeStatus.AUTHORIZED : NfeStatus.REJECTED,
        chaveAcesso: doc.DocChaAcesso || null,
        protocolo: doc.DocProtocolo || null,
        invoicyId: doc.DocIDUnico || null,
        invoicyProtocol: doc.DocProtocolo || null,
        dataEmissao: new Date(),
        dataAutorizacao: isAuthorized ? new Date() : null,
        danfeUrl: doc.DocPDFDownload || null,
        xmlAutorizado: doc.DocXMLBase64
          ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
          : null,
        motivoRejeicao: !isAuthorized ? situacao?.SitDescricao : null,
      },
    });

    if (!isAuthorized) {
      const orientacao = this.getRejectionHint(situacao?.SitCodigo);
      // Recusa cuja providência está fora da nota (habilitação, situação
      // cadastral). Vai na mensagem, e é ela que tratarFalhaEmissao grava
      // como motivo — por isso aparece também no modal de motivo.
      const providencia = orientacaoRejeicaoFiscal({
        origem: 'SEFAZ',
        codigo: situacao?.SitCodigo,
        modelo: 'NF-e',
      });
      // Resposta CONCLUSIVA da SEFAZ: a nota nao foi autorizada, entao o
      // numero continua livre. Devolver aqui e o unico ponto seguro — no
      // catch abaixo cai tambem falha de transporte, onde a nota PODE ter
      // sido autorizada.
      await this.releaseRejectedNfeNumber(config.id, environment, numero);

      throw new BadRequestException(
        mensagemComOrientacao(
          `NF-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}` +
            (orientacao ? ` — ${orientacao}` : ''),
          providencia,
        ),
      );
    }

    await this.persistDanfePdf(nfe.id, doc).catch((danfeError) => {
      this.logger.warn(
        `Nao foi possivel armazenar a DANFE da NF-e ${nfe.id}: ${danfeError.message}`,
      );
    });

    // O número já foi reservado atomicamente antes da transmissão
    // (reserveNfeNumber). Incrementar aqui pularia um número a cada emissão.

    await this.nfeEmailService
      .sendAuthorizedNfeEmail({
        nfe: updatedNfe,
        config,
        recipientEmail: dto.destEmail,
        recipientName: dto.destNome,
        automatic: true,
      })
      .catch((emailError) => {
        this.logger.warn(
          `Envio automatico de e-mail da NF-e ${updatedNfe.id} falhou: ${emailError.message}`,
        );
      });

    return updatedNfe;
  }

  /**
   * Marca a nota como rejeitada e propaga o erro.
   *
   * Cobre também falha de transporte, em que a nota PODE ter sido autorizada
   * sem a resposta chegar — por isso NÃO devolve o número reservado aqui.
   */
  private async tratarFalhaEmissao(params: {
    nfe: any;
    numero: number;
    error: any;
  }): Promise<never> {
    const { nfe, error } = params;

    // Atualizar status para rejeitado em caso de erro
    await this.prisma.nfe.update({
      where: { id: nfe.id },
      data: {
        status: NfeStatus.REJECTED,
        motivoRejeicao: error.message,
      },
    });

    this.logger.error(`Erro ao emitir NF-e: ${error.message}`, error.stack);
    throw new BadRequestException(`Erro ao emitir NF-e: ${error.message}`);
  }

  /**
   * Orientacao pratica para as rejeicoes que o texto da SEFAZ nao explica.
   *
   * O `xMotivo` costuma nomear o campo quando o problema e de conteudo
   * ("Rejeicao: CFOP invalido"), e nesses casos ele basta. O que ele NAO diz e
   * o que fazer quando a causa nao esta na nota — e a 656 e o caso extremo:
   * "Consumo Indevido" nao tem nada a ver com os dados, e a reacao natural do
   * usuario (clicar em "Corrigir e reemitir") piora o bloqueio.
   *
   * Lista curada de proposito: so codigos onde a orientacao acrescenta algo
   * que o texto da SEFAZ nao carrega. Sem entrada, a mensagem original passa
   * intacta.
   */
  private getRejectionHint(sitCodigo?: number): string | null {
    const hints: Record<number, string> = {
      // Bloqueio temporario por excesso de requisicoes do mesmo CNPJ.
      656: 'a SEFAZ bloqueou temporariamente este CNPJ por excesso de tentativas. NAO reenvie agora: novas tentativas renovam o bloqueio. Aguarde cerca de 1 hora e emita uma unica vez.',
      // Duplicidade: numero ja usado na SEFAZ.
      539: 'ja existe nota autorizada com este numero e serie. Ajuste o proximo numero em Configuracoes > Emissores, na aba do documento, com o ambiente correto selecionado.',
      204: 'esta nota ja foi transmitida antes. Consulte a situacao dela antes de emitir de novo.',
      // Cadastro do emitente.
      209: 'a inscricao estadual do emitente esta invalida. Confira o numero em Configuracoes da empresa > Nota Fiscal.',
      210: 'a inscricao estadual nao pertence a este CNPJ no cadastro da SEFAZ. Confira se o IE e o CNPJ sao do mesmo estabelecimento (matriz ou filial).',
      // Ambiente / credenciais.
      252: 'o ambiente da nota diverge do ambiente autorizado para este emissor.',
    };

    return hints[sitCodigo ?? -1] ?? null;
  }

  /**
   * Devolve a sequencia ao numero reservado quando a SEFAZ rejeita a nota.
   *
   * A reserva e atomica e acontece ANTES da transmissao — e isso que impede
   * duas emissoes concorrentes de montarem o payload com o mesmo numero. O
   * custo e que toda rejeicao queima um numero: a nota nunca existiu na SEFAZ,
   * mas a sequencia ja andou, e o vao resultante so se regulariza com
   * inutilizacao. Reaproveitar numero de nota rejeitada e legitimo.
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
  private async releaseRejectedNfeNumber(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    reservedNumber: number,
  ): Promise<void> {
    try {
      const released = await this.prisma.$executeRaw`
        UPDATE invoicy_environment_configs
        SET "nfeNextNumber" = ${reservedNumber}
        WHERE "invoicyConfigId" = ${invoicyConfigId}
          AND environment = ${environment}::"FiscalEnvironment"
          AND "docType" = 'NFE'::"FiscalDocType"
          AND "nfeNextNumber" = ${reservedNumber + 1}
      `;

      if (released > 0) {
        this.logger.log(
          `Numero ${reservedNumber} devolvido a sequencia de NF-e (${environment}) apos rejeicao da SEFAZ.`,
        );
      } else {
        this.logger.log(
          `Numero ${reservedNumber} nao devolvido: a sequencia de NF-e (${environment}) ja avancou. ` +
            'O numero fica vago e precisara de inutilizacao.',
        );
      }
    } catch (error) {
      // Best-effort: devolver numero nunca pode mascarar a rejeicao original,
      // que e o que o usuario precisa ver.
      this.logger.warn(
        `Falha ao devolver o numero ${reservedNumber} a sequencia de NF-e: ${error.message}`,
      );
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
    const code = ufCodes[uf?.toUpperCase()];
    if (!code) {
      // Falha fechada: um default silencioso (RS) rotearia o documento para a
      // SEFAZ errada e gravaria cUF divergente na chave de acesso.
      throw new BadRequestException(
        `UF do emitente inválida ou não informada: "${uf ?? ''}". ` +
          'Verifique o endereço da empresa em Configurações > Empresa.',
      );
    }
    return code;
  }

  /**
   * Resolve o CFOP de um item conforme destino, finalidade e CFOP base.
   *
   * Ordem dos branches importa: devolução (finNFe=4) é avaliada ANTES de
   * exterior, senão uma devolução para o exterior sai com CFOP de venda.
   */
  private resolveItemCfop(params: {
    baseCfop: number;
    isForeign: boolean;
    isInterestadual: boolean;
    isDevolucao: boolean;
  }): number {
    const { baseCfop, isForeign, isInterestadual, isDevolucao } = params;
    const lastThree = baseCfop % 1000;
    const prefix = Math.floor(baseCfop / 1000);

    if (isDevolucao) {
      if (isForeign) {
        // Saída para o exterior em devolução de compra: 7201/7202
        return lastThree === 101 || lastThree === 201 ? 7201 : 7202;
      }
      if (lastThree === 101 || lastThree === 201) {
        return isInterestadual ? 2201 : 1201;
      }
      if (lastThree === 102 || lastThree === 202) {
        return isInterestadual ? 2202 : 1202;
      }
      if (prefix === 1 && isInterestadual) return baseCfop + 1000;
      if (prefix === 2 && !isInterestadual) return baseCfop - 1000;
      return isInterestadual ? 2202 : 1202;
    }

    if (isForeign) {
      if (prefix === 5 || prefix === 6) {
        return baseCfop - prefix * 1000 + 7000;
      }
      return baseCfop;
    }

    // Operação interestadual com CFOP interno (5xxx) → 6xxx
    if (isInterestadual && prefix === 5) return baseCfop + 1000;
    // Operação interna com CFOP interestadual (6xxx) → 5xxx
    if (!isInterestadual && prefix === 6) return baseCfop - 1000;

    return baseCfop;
  }

  /** CFOPs de entrada (1xxx/2xxx/3xxx) exigem documento de entrada (tpNF=0). */
  private isCfopEntrada(cfop: number): boolean {
    const prefix = Math.floor(cfop / 1000);
    return prefix === 1 || prefix === 2 || prefix === 3;
  }

  /**
   * Valida os dados fiscais mínimos de cada item antes de montar o XML.
   *
   * Portado de NfceService.assertFiscalItemsReady: sem isso a NF-e sai com
   * NCM '00000000' e CFOP inválido e é rejeitada pela SEFAZ com mensagem
   * genérica, depois do usuário ter preenchido a nota inteira.
   */
  private assertFiscalItemsReady(
    items: EmitNfeDto['items'],
    resolvedCfops: number[],
  ) {
    for (const [index, item] of items.entries()) {
      const label = item.description || `Item ${index + 1}`;
      const ncm = (item.ncm || '').replace(/\D/g, '');
      const cfop = String(resolvedCfops[index] ?? '').replace(/\D/g, '');

      if (ncm.length !== 8 || ncm === '00000000') {
        throw new BadRequestException(
          `Dados fiscais incompletos para ${label}: informe um NCM válido ` +
            '(8 dígitos). Cadastre em Configurações > Produtos > Dados Fiscais.',
        );
      }

      if (cfop.length !== 4) {
        throw new BadRequestException(
          `Dados fiscais incompletos para ${label}: informe um CFOP válido.`,
        );
      }

      // Unidade comercial não é validada: o payload já aplica o default 'UN'
      // e a SEFAZ não confere uCom contra tabela. Exigir aqui bloquearia
      // emissões que hoje passam sem nenhum ganho fiscal.
    }
  }

  /**
   * Constrói bloco de local de entrega para emissão inline
   */
  private async buildEntregaInline(dto: EmitNfeDto): Promise<any> {
    if (!dto.entregaEndereco) {
      return undefined;
    }

    let cmun = 0;
    let uf = dto.entregaUf || '';
    let municipio = dto.entregaMunicipio || '';

    if (dto.entregaCep) {
      this.logger.log(
        `Buscando código IBGE de entrega para CEP: ${dto.entregaCep}`,
      );
      const cepData = await fetchCepData(dto.entregaCep);
      if (cepData) {
        cmun = parseInt(cepData.codigoIbge, 10) || 0;
        uf = cepData.uf;
        municipio = cepData.cidade;
        this.logger.log(`Código IBGE da entrega: ${cmun} (${municipio}/${uf})`);
      }
    }

    if (!cmun) {
      throw new BadRequestException(
        'CEP de entrega inválido ou código IBGE não encontrado para o endereço de entrega.',
      );
    }

    const cleanCnpjCpf = (dto.entregaCnpjCpf || dto.destCnpjCpf || '').replace(
      /\D/g,
      '',
    );

    return {
      ...(cleanCnpjCpf.length === 14 ? { CNPJ_entrega: cleanCnpjCpf } : {}),
      ...(cleanCnpjCpf.length === 11 ? { CPF_entrega: cleanCnpjCpf } : {}),
      xLgr_entrega: dto.entregaEndereco,
      nro_entrega: dto.entregaNumero || 'S/N',
      xCpl_entrega: dto.entregaComplemento || undefined,
      xBairro_entrega: dto.entregaBairro || '',
      cMun_entrega: cmun,
      xMun_entrega: municipio,
      UF_entrega: uf,
      CEP_entrega:
        parseInt((dto.entregaCep || '').replace(/\D/g, ''), 10) || undefined,
    };
  }

  async cancel(id: string, companyId: string, dto: CancelNfeDto) {
    const nfe = await this.findById(id, companyId);

    if (nfe.status !== NfeStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Apenas NF-e autorizadas podem ser canceladas',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    // O prazo corre da AUTORIZACAO DE USO, nao da emissao, e quem o valida e
    // a SEFAZ da UF do emitente. A regra antiga barrava tudo em 24 horas e
    // impedia o cancelamento extemporaneo que varios estados aceitam — Sao
    // Paulo recebe o evento ate 480 horas. Aqui so barramos o que nenhuma UF
    // aceita; entre o prazo regular e o teto, avisamos e deixamos a SEFAZ
    // decidir.
    const limiteConfigurado = nfe.invoicyConfigId
      ? await this.prisma.invoicyConfig
          .findFirst({
            where: { id: nfe.invoicyConfigId, companyId },
            select: { prazoCancelamentoNfeHoras: true },
          })
          .then((cfg) => cfg?.prazoCancelamentoNfeHoras ?? null)
      : null;

    const prazo = avaliarPrazoCancelamento({
      autorizadaEm: nfe.dataAutorizacao,
      emitidaEm: nfe.dataEmissao,
      limiteConfiguradoHoras: limiteConfigurado,
    });

    if (!prazo.podeTentar) {
      throw new BadRequestException(prazo.bloqueio);
    }

    if (prazo.aviso) {
      this.logger.warn(
        `Cancelamento fora do prazo regular da NF-e ${nfe.numero}: ` +
          `${Math.floor(prazo.horasDecorridas)}h desde a autorizacao.`,
      );
    }

    try {
      this.logger.log(
        `Cancelando NF-e ${nfe.numero} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy para cancelamento
      const invoicyResponses = await this.invoicyApiService.cancelNfe(
        companyId,
        nfe.chaveAcesso,
        dto.justificativa,
        nfe.ambiente,
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
        const orientacao = orientacaoRejeicaoCancelamento(situacao?.SitCodigo);
        throw new Error(
          (situacao?.SitDescricao || 'Cancelamento nao autorizado pela SEFAZ') +
            (orientacao ? ` — ${orientacao}` : ''),
        );
      }

      const updatedNfe = await this.prisma.nfe.update({
        where: { id },
        data: {
          status: NfeStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
          protocoloCancelamento: doc?.DocProtocolo || null,
        },
      });

      // O aviso do prazo viaja junto: cancelamento extemporaneo foi aceito,
      // mas pode gerar penalidade, e o usuario precisa saber disso.
      return prazo.aviso
        ? { ...updatedNfe, avisoPrazo: prazo.aviso }
        : updatedNfe;
    } catch (error) {
      this.logger.error(`Erro ao cancelar NF-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao cancelar NF-e: ${error.message}`);
    }
  }

  async consultStatus(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);

    if (!nfe.chaveAcesso) {
      return {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        status: nfe.status,
        statusDescription: 'Chave de acesso não disponível para consulta',
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      this.logger.log(`Consultando status real NF-e ${nfe.numero} na SEFAZ`);

      const invoicyResponses = await this.invoicyApiService.consultNfeSefaz(
        companyId,
        nfe.chaveAcesso,
      );

      const response = invoicyResponses[0];
      const doc = response?.Documentos?.[0];
      const situacao = doc?.Situacao;

      const newStatus = this.mapSefazCodToStatus(
        situacao?.SitCodigo,
        doc?.DocEveTp,
      );

      let currentStatus = nfe.status;
      let xmlDisponivel = !!nfe.xmlAutorizado;
      if (
        newStatus &&
        newStatus !== nfe.status &&
        this.isAllowedSefazTransition(nfe.status, newStatus)
      ) {
        this.logger.log(
          `Status NF-e ${nfe.numero} mudou: ${nfe.status} -> ${newStatus}`,
        );

        // Ao autorizar por consulta, gravar o que a autorizacao sincrona
        // grava. Sem isso a nota ficava AUTHORIZED sem XML nem datas e sumia
        // da exportacao em ZIP.
        const autorizacao = this.isStatusAutorizado(newStatus)
          ? await this.dadosDeAutorizacao(nfe, doc)
          : {};
        await this.prisma.nfe.update({
          where: { id: nfe.id },
          data: { status: newStatus as any, ...autorizacao },
        });
        currentStatus = newStatus as any;
        xmlDisponivel = xmlDisponivel || !!autorizacao.xmlAutorizado;
      } else if (newStatus && newStatus !== nfe.status) {
        this.logger.warn(
          `Transicao de status ignorada para NF-e ${nfe.numero}: ${nfe.status} -> ${newStatus} (cStat ${situacao?.SitCodigo})`,
        );
      }

      // "Consultar status" e' o que o usuario faz ao ver uma nota autorizada
      // sem XML; aproveitar para recupera-lo do provedor.
      if (!xmlDisponivel && this.isStatusAutorizado(currentStatus)) {
        xmlDisponivel = !!(await this.refreshXmlFromProvider(nfe, companyId));
      }

      return {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        status: currentStatus,
        statusChanged: currentStatus !== nfe.status,
        xmlDisponivel,
        sefazCode: situacao?.SitCodigo,
        sefazDescription: situacao?.SitDescricao,
        chaveAcesso: nfe.chaveAcesso,
        protocolo: nfe.protocolo,
        dataEmissao: nfe.dataEmissao,
        dataAutorizacao: nfe.dataAutorizacao,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status NF-e ${nfe.numero}: ${error.message}`,
        error.stack,
      );
      return {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        status: nfe.status,
        sefazError: error.message,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * O cStat 135 ("evento registrado e vinculado a NF-e") e' generico: vale tanto
   * para carta de correcao quanto para cancelamento. Sem olhar o tipo do evento
   * (DocEveTp), um cancelamento consultado na SEFAZ era gravado como
   * CORRECTION_SENT e a nota voltava a aparecer como valida.
   */
  private mapSefazCodToStatus(
    sitCodigo?: number,
    tipoEvento?: number,
  ): string | null {
    if (!sitCodigo) return null;

    if (sitCodigo === 135 || sitCodigo === 136) {
      if (tipoEvento === 110111) return 'CANCELLED';
      if (tipoEvento === 110110) return 'CORRECTION_SENT';
      // Tipo de evento desconhecido: nao ha' como decidir com seguranca.
      return null;
    }

    const map: Record<number, string> = {
      100: 'AUTHORIZED',
      101: 'CANCELLED',
      102: 'CANCELLED',
      204: 'AUTHORIZED',
      217: 'REJECTED',
    };

    return map[sitCodigo] || null;
  }

  /**
   * Estados terminais nao podem ser revertidos por uma consulta, e uma nota que
   * ja' recebeu CC-e nao volta a AUTHORIZED.
   */
  private isAllowedSefazTransition(current: string, next: string): boolean {
    if (current === NfeStatus.CANCELLED) return false;
    if (
      current === NfeStatus.CORRECTION_SENT &&
      next === NfeStatus.AUTHORIZED
    ) {
      return false;
    }
    return true;
  }

  private async persistDanfePdf(
    nfeId: string,
    doc: InvoicyDocumentResult,
  ): Promise<boolean> {
    const pdf = await this.resolveDanfePdf(doc);
    if (!pdf) {
      this.logger.warn(
        `DANFE da NF-e ${nfeId} nao foi retornada como PDF valido`,
      );
      return false;
    }

    await this.prisma.nfeDanfeDocument.upsert({
      where: { nfeId },
      create: { nfeId, pdf },
      update: { pdf },
    });
    return true;
  }

  /**
   * Rebusca a DANFE no provedor e substitui a versao armazenada.
   *
   * A DANFE e gravada no banco na autorizacao e servida de la (getDanfeUrl):
   * ela nao se atualiza sozinha. Depois de um cancelamento o usuario continuava
   * baixando o PDF da nota valida, sem a marca dagua de CANCELADA. A consulta
   * devolve o documento no estado ATUAL, entao e dela que sai o PDF novo.
   *
   * Nunca lanca. Quando isto roda, o evento ja esta registrado na SEFAZ — falhar
   * em atualizar um PDF nao pode derrubar a operacao nem virar uma mensagem de
   * erro para uma operacao que deu certo.
   */
  async refreshDanfeFromProvider(
    nfe: {
      id: string;
      chaveAcesso?: string | null;
      invoicyConfigId?: string | null;
    },
    companyId: string,
  ): Promise<boolean> {
    if (!nfe?.chaveAcesso) return false;

    try {
      const responses = await this.invoicyApiService.consultNfeSefaz(
        companyId,
        nfe.chaveAcesso,
        nfe.invoicyConfigId ?? undefined,
      );

      const doc = responses?.[0]?.Documentos?.[0];
      if (!doc) {
        this.logger.warn(
          `Consulta da NF-e ${nfe.id} nao devolveu documento; DANFE mantida como estava.`,
        );
        return false;
      }

      const persisted = await this.persistDanfePdf(nfe.id, doc);
      if (persisted) {
        this.logger.log(
          `DANFE da NF-e ${nfe.id} atualizada apos evento fiscal.`,
        );
      }
      return persisted;
    } catch (error) {
      this.logger.warn(
        `Nao foi possivel atualizar a DANFE da NF-e ${nfe.id}: ${error.message}`,
      );
      return false;
    }
  }

  private async resolveDanfePdf(
    doc: Pick<InvoicyDocumentResult, 'DocPDFBase64' | 'DocPDFDownload'>,
  ): Promise<Buffer | null> {
    if (doc.DocPDFBase64) {
      const base64 = doc.DocPDFBase64.replace(
        /^data:application\/pdf;base64,/i,
        '',
      );
      const pdf = Buffer.from(base64, 'base64');
      if (this.isPdf(pdf)) return pdf;
    }

    if (!doc.DocPDFDownload) return null;

    try {
      const response = await fetch(doc.DocPDFDownload, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return null;

      const pdf = Buffer.from(await response.arrayBuffer());
      return this.isPdf(pdf) ? pdf : null;
    } catch (error) {
      this.logger.warn(
        `Nao foi possivel baixar a DANFE retornada pelo Invoicy: ${error.message}`,
      );
      return null;
    }
  }

  private isPdf(content: Buffer): boolean {
    return content.subarray(0, 5).toString('ascii') === '%PDF-';
  }

  private isStatusAutorizado(status: string): boolean {
    return (
      status === NfeStatus.AUTHORIZED || status === NfeStatus.CORRECTION_SENT
    );
  }

  /** Data devolvida pelo provedor (ISO com fuso); null quando ausente ou inválida. */
  private parseProviderDate(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private isNfeXml(content: string): boolean {
    return content.startsWith('<') && /<(nfeProc|NFe)[\s>]/.test(content);
  }

  /** Aceita base64 ou XML puro; devolve o XML apenas se for de NF-e. */
  private decodeXml(content: string): string | null {
    const raw = content.trim();
    if (!raw) return null;
    if (this.isNfeXml(raw)) return raw;

    const decoded = Buffer.from(raw, 'base64').toString('utf-8').trim();
    return this.isNfeXml(decoded) ? decoded : null;
  }

  /**
   * XML autorizado a partir de um documento devolvido pelo provedor.
   *
   * Emissao e consulta usam nomes diferentes para o mesmo conteudo
   * (DocXMLBase64/DocXMLDownload na emissao, DocXML/DocXMLLink na consulta
   * GET). Base64 primeiro, link em seguida; nunca lanca.
   */
  private async resolveXmlAutorizado(
    doc?: Partial<InvoicyDocumentResult> | null,
  ): Promise<string | null> {
    if (!doc) return null;

    const inline = doc.DocXMLBase64 || doc.DocXML;
    if (inline) {
      const xml = this.decodeXml(inline);
      if (xml) return xml;
    }

    const link = doc.DocXMLDownload || doc.DocXMLLink;
    if (!link) return null;

    try {
      const response = await fetch(link, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return null;
      return this.decodeXml(await response.text());
    } catch (error) {
      this.logger.warn(
        `Nao foi possivel baixar o XML retornado pelo Invoicy: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Campos que a autorizacao sincrona grava e a consulta de status esquecia:
   * XML, datas, protocolo, DANFE e id no provedor. Nunca sobrescreve o que ja'
   * esta' gravado — a consulta devolve o documento no estado atual, e um XML
   * bom nao pode ser trocado por vazio.
   */
  private async dadosDeAutorizacao(
    nfe: {
      xmlAutorizado?: string | null;
      dataAutorizacao?: Date | null;
      dataEmissao?: Date | null;
      protocolo?: string | null;
      danfeUrl?: string | null;
      invoicyId?: string | null;
    },
    doc?: Partial<InvoicyDocumentResult> | null,
  ): Promise<{
    xmlAutorizado?: string;
    dataAutorizacao?: Date;
    dataEmissao?: Date;
    protocolo?: string;
    danfeUrl?: string;
    invoicyId?: string;
  }> {
    const dataAutorizacao =
      nfe.dataAutorizacao ??
      this.parseProviderDate(doc?.DocDhAut) ??
      new Date();
    const xml = nfe.xmlAutorizado ? null : await this.resolveXmlAutorizado(doc);

    return {
      ...(xml ? { xmlAutorizado: xml } : {}),
      ...(nfe.dataAutorizacao ? {} : { dataAutorizacao }),
      ...(nfe.dataEmissao ? {} : { dataEmissao: dataAutorizacao }),
      ...(!nfe.protocolo && doc?.DocProtocolo
        ? { protocolo: doc.DocProtocolo }
        : {}),
      ...(!nfe.danfeUrl && doc?.DocPDFDownload
        ? { danfeUrl: doc.DocPDFDownload }
        : {}),
      ...(!nfe.invoicyId && doc?.DocIDUnico
        ? { invoicyId: doc.DocIDUnico }
        : {}),
    };
  }

  /**
   * Rebusca o XML autorizado no provedor e o persiste.
   *
   * O XML so' era gravado na resposta sincrona da emissao. Quando ela vinha
   * sem DocXMLBase64, ou quando a nota era autorizada depois pela consulta de
   * status, a NF-e ficava AUTHORIZED sem XML: sumia da exportacao em ZIP e do
   * "Baixar XML". Consulta o documento com ParmXMLCompleto=S e, se vier vazio,
   * cai na consulta de sincronizacao, que devolve o mesmo documento.
   *
   * Nunca lanca: quem chama decide o que fazer sem XML.
   */
  async refreshXmlFromProvider(
    nfe: {
      id: string;
      chaveAcesso?: string | null;
      ambiente?: number | null;
      invoicyConfigId?: string | null;
      dataAutorizacao?: Date | null;
    },
    companyId: string,
  ): Promise<string | null> {
    if (!nfe?.chaveAcesso) return null;
    const chaveAcesso = nfe.chaveAcesso;

    const consultas = [
      () =>
        this.invoicyApiService.consultDocumentXml(
          companyId,
          chaveAcesso,
          nfe.ambiente ?? undefined,
          nfe.invoicyConfigId ?? undefined,
        ),
      () =>
        this.invoicyApiService.consultNfeSefaz(
          companyId,
          chaveAcesso,
          nfe.invoicyConfigId ?? undefined,
        ),
    ];

    for (const consultar of consultas) {
      try {
        const responses = await consultar();
        const doc = responses?.[0]?.Documentos?.[0];
        const xml = await this.resolveXmlAutorizado(doc);
        if (!xml) continue;

        const dataAutorizacao = nfe.dataAutorizacao
          ? undefined
          : (this.parseProviderDate(doc?.DocDhAut) ?? undefined);
        await this.prisma.nfe.update({
          where: { id: nfe.id },
          data: { xmlAutorizado: xml, dataAutorizacao },
        });
        this.logger.log(`XML da NF-e ${nfe.id} recuperado do provedor.`);
        return xml;
      } catch (error) {
        this.logger.warn(
          `Nao foi possivel recuperar o XML da NF-e ${nfe.id}: ${error.message}`,
        );
      }
    }

    return null;
  }

  async getDanfeUrl(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);
    const danfeDocument = await this.prisma.nfeDanfeDocument.findUnique({
      where: { nfeId: nfe.id },
    });

    if (!danfeDocument && !nfe.danfeUrl) {
      // TODO: Buscar DANFE da API do Invoicy se não estiver armazenado
      throw new NotFoundException('DANFE não disponível para esta NF-e');
    }

    return {
      pdfBase64: danfeDocument?.pdf.toString('base64') || null,
      url: nfe.danfeUrl,
    };
  }

  async getXml(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);

    if (nfe.xmlAutorizado) return { xml: nfe.xmlAutorizado };

    // Nota autorizada cujo XML nao veio na emissao: rebuscar antes de negar.
    const xml = await this.refreshXmlFromProvider(nfe, companyId);
    if (!xml) {
      throw new NotFoundException('XML não disponível para esta NF-e');
    }

    return { xml };
  }

  async sendAuthorizedEmail(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);
    const config = await this.invoicyService.getConfig(companyId);

    if (!config) {
      throw new BadRequestException('Configuracao do Invoicy nao encontrada.');
    }

    return this.nfeEmailService.sendAuthorizedNfeEmail({
      nfe,
      config,
      automatic: false,
    });
  }

  // ==================== Draft Methods ====================

  /**
   * Cria um rascunho de NF-e ou retorna um existente.
   * Se já existe um rascunho para esta ordem, retorna os dados dele.
   * Se não existe, cria um novo com os dados do prepareFromOrder.
   */
  async createOrGetDraft(companyId: string, orderId: string) {
    await this.assertOrdersNotCanceled(companyId, [orderId]);

    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuracao do Invoicy nao encontrada.');
    }

    // Documento de outro ambiente nao bloqueia a O.S.: NF-e de homologacao nao
    // tem validade fiscal, entao a ordem segue liberada para emitir em
    // producao. Mesmo criterio ja usado em prepareConsolidatedFromOrders.
    const ambienteAtivo =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
        config,
        'NFE',
      ) === 'PRODUCAO'
        ? 1
        : 2;

    const existingLinkedNfe = await this.prisma.nfe.findFirst({
      where: {
        companyId,
        status: {
          in: [
            NfeStatus.AUTHORIZED,
            NfeStatus.CORRECTION_SENT,
            NfeStatus.DRAFT,
          ],
        },
        ambiente: ambienteAtivo,
        orders: {
          some: { orderId },
        },
      },
      include: {
        orders: true,
      },
    });

    if (
      existingLinkedNfe &&
      ((existingLinkedNfe as any).orders?.length > 1 ||
        this.isStatusAutorizado(existingLinkedNfe.status))
    ) {
      throw new BadRequestException(
        'Esta ordem ja esta vinculada a uma NF-e consolidada',
      );
    }

    // Verificar se já existe rascunho para esta ordem
    const existingDraft = await this.prisma.nfe.findFirst({
      where: {
        companyId,
        orderId,
        status: NfeStatus.DRAFT,
        ambiente: ambienteAtivo,
      },
    });

    // Se já existe rascunho, retornar dados preparados com dados do rascunho
    if (existingDraft) {
      const preparedData = await this.prepareFromOrder(companyId, orderId);
      const draftData = (existingDraft.draftData as Record<string, any>) || {};
      const reaberto = await this.itensAoReabrirRascunho(
        companyId,
        existingDraft,
        preparedData.items,
        [orderId],
      );

      return {
        ...preparedData,
        draftId: existingDraft.id,
        isDraft: true,
        // Sobrescrever com dados do rascunho
        emissao: draftData.emissao
          ? { ...preparedData.emissao, ...draftData.emissao }
          : preparedData.emissao,
        destinatario: draftData.destinatario || preparedData.destinatario,
        items: reaberto.itens,
        itensEditados: reaberto.editados,
        origemItens: reaberto.origem,
        transportadora: draftData.transportadora || preparedData.transportadora,
        volumes: draftData.volumes || preparedData.volumes,
        pagamento: draftData.pagamento || preparedData.pagamento,
        duplicatas: draftData.duplicatas || preparedData.duplicatas,
        autXml: draftData.autXml || preparedData.autXml,
        informacoesComplementares:
          draftData.informacoesComplementares ||
          preparedData.informacoesComplementares,
      };
    }

    // Buscar dados preparados
    const preparedData = await this.prepareFromOrder(companyId, orderId);
    // Impressão da O.S. de onde saem os itens: a tela a devolve no PATCH.
    const origemItens = await this.impressaoDasLinhas(companyId, [orderId]);

    // Criar novo rascunho
    const draft = await this.prisma.nfe.create({
      data: {
        companyId,
        orderId,
        quotationId: preparedData.quotationId,
        // Numero provisorio do rascunho: a reserva definitiva acontece no emit.
        // Vem da linha ambiental para o rascunho nao exibir um numero que a
        // emissao nunca usaria.
        numero: config.activeNumbering.nfe.nextNumber,
        serie: config.activeNumbering.nfe.series,
        status: NfeStatus.DRAFT,
        // Ambiente resolvido por documento: `config.ambiente` e o campo global
        // e divergia quando NF-e e NFC-e estavam em ambientes diferentes.
        ambiente: ambienteAtivo,
        valorTotal: preparedData.totais.valorNota,
        draftData: JSON.parse(
          JSON.stringify({
            destinatario: preparedData.destinatario,
            emissao: preparedData.emissao,
            items: preparedData.items,
            versaoItens: VERSAO_ITENS_NOTA,
            itensEditados: false,
            origemItens,
            transportadora: preparedData.transportadora,
            volumes: preparedData.volumes,
            pagamento: preparedData.pagamento,
            duplicatas: preparedData.duplicatas,
            autXml: preparedData.autXml,
            informacoesComplementares: preparedData.informacoesComplementares,
          }),
        ),
        orders: {
          create: [{ orderId }],
        },
      },
    });

    this.logger.log(
      `Rascunho de NF-e criado: ${draft.id} para ordem ${orderId}`,
    );

    return {
      ...preparedData,
      draftId: draft.id,
      isDraft: true,
      origemItens,
    };
  }

  async createOrGetConsolidatedDraft(companyId: string, orderIds: string[]) {
    const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];

    if (uniqueOrderIds.length < 2) {
      throw new BadRequestException(
        'Selecione ao menos duas ordens para consolidar a NF-e',
      );
    }

    const candidateDrafts = (await this.prisma.nfe.findMany({
      where: {
        companyId,
        status: NfeStatus.DRAFT,
        orders: {
          some: {
            orderId: { in: uniqueOrderIds },
          },
        },
      },
      include: {
        orders: true,
      },
    })) as any[];

    const existingDraft = candidateDrafts.find((draft) => {
      const draftOrderIds = draft.orders.map((item) => item.orderId).sort();
      return (
        draftOrderIds.length === uniqueOrderIds.length &&
        draftOrderIds.join('|') === [...uniqueOrderIds].sort().join('|')
      );
    });

    if (existingDraft) {
      const preparedData = await this.prepareConsolidatedFromOrders(
        companyId,
        uniqueOrderIds,
        existingDraft.id,
      );
      const draftData = (existingDraft.draftData as Record<string, any>) || {};
      const reaberto = await this.itensAoReabrirRascunho(
        companyId,
        existingDraft,
        preparedData.items,
        uniqueOrderIds,
      );

      return {
        ...preparedData,
        draftId: existingDraft.id,
        isDraft: true,
        emissao: draftData.emissao
          ? { ...preparedData.emissao, ...draftData.emissao }
          : preparedData.emissao,
        destinatario: draftData.destinatario || preparedData.destinatario,
        items: reaberto.itens,
        itensEditados: reaberto.editados,
        origemItens: reaberto.origem,
        transportadora: draftData.transportadora || preparedData.transportadora,
        volumes: draftData.volumes || preparedData.volumes,
        pagamento: draftData.pagamento || preparedData.pagamento,
        duplicatas: draftData.duplicatas || preparedData.duplicatas,
        autXml: draftData.autXml || preparedData.autXml,
        informacoesComplementares:
          draftData.informacoesComplementares ||
          preparedData.informacoesComplementares,
      };
    }

    const preparedData = await this.prepareConsolidatedFromOrders(
      companyId,
      uniqueOrderIds,
    );
    // Impressão das O.S. de onde saem os itens: a tela a devolve no PATCH.
    const origemItens = await this.impressaoDasLinhas(
      companyId,
      uniqueOrderIds,
    );

    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuracao do Invoicy nao encontrada.');
    }

    const draft = await this.prisma.nfe.create({
      data: {
        companyId,
        orderId: preparedData.orderId,
        quotationId: preparedData.quotationId,
        // Numero provisorio e ambiente saem da MESMA linha ambiental. Antes o
        // numero vinha da coluna global e o ambiente de `config.ambiente`, o que
        // permitia gravar rascunho com numero de producao e ambiente 2.
        numero: config.activeNumbering.nfe.nextNumber,
        serie: config.activeNumbering.nfe.series,
        status: NfeStatus.DRAFT,
        ambiente: config.activeNumbering.nfe.environment === 'PRODUCAO' ? 1 : 2,
        valorTotal: preparedData.totais.valorNota,
        draftData: JSON.parse(
          JSON.stringify({
            orderIds: uniqueOrderIds,
            orderCodes: preparedData.orderCodes,
            emissao: preparedData.emissao,
            destinatario: preparedData.destinatario,
            items: preparedData.items,
            versaoItens: VERSAO_ITENS_NOTA,
            itensEditados: false,
            origemItens,
            transportadora: preparedData.transportadora,
            volumes: preparedData.volumes,
            pagamento: preparedData.pagamento,
            duplicatas: preparedData.duplicatas,
            autXml: preparedData.autXml,
            informacoesComplementares: preparedData.informacoesComplementares,
          }),
        ),
        orders: {
          create: uniqueOrderIds.map((relatedOrderId) => ({
            orderId: relatedOrderId,
          })),
        },
      },
    });

    this.logger.log(
      `Rascunho consolidado de NF-e criado: ${draft.id} para ordens ${uniqueOrderIds.join(', ')}`,
    );

    return {
      ...preparedData,
      draftId: draft.id,
      isDraft: true,
      origemItens,
    };
  }

  /**
   * Atualiza os dados de um rascunho.
   */
  async updateDraft(
    companyId: string,
    draftId: string,
    dto: UpdateNfeDraftDto,
  ) {
    const draft = await this.prisma.nfe.findFirst({
      where: {
        id: draftId,
        companyId,
        status: NfeStatus.DRAFT,
      },
    });

    if (!draft) {
      throw new NotFoundException('Rascunho não encontrado');
    }

    const existingDraftData = (draft.draftData as Record<string, any>) || {};

    // Itens editados na tela ficam no rascunho enquanto a O.S. não mudar
    // depois da edição (ver itensAoReabrirRascunho). A impressão guardada é a
    // da O.S. de onde a tela tirou os itens, que ela devolve: com a de agora,
    // uma aba aberta antes de a O.S. ser corrigida gravaria a edição velha
    // como se fosse posterior à correção. Sem ela (cliente antigo), a de agora.
    const marcaDosItens = dto.items
      ? {
          versaoItens: VERSAO_ITENS_NOTA,
          itensEditados: true,
          origemItens:
            dto.origemItens ||
            (await this.impressaoDasLinhas(
              companyId,
              await this.ordensDaNota(draft),
            )),
        }
      : {};

    // Mesclar dados existentes com novos dados
    const updatedDraftData = {
      ...existingDraftData,
      ...(dto.emissao && {
        emissao: {
          ...(existingDraftData.emissao || {}),
          ...dto.emissao,
        },
      }),
      ...(dto.destinatario && { destinatario: dto.destinatario }),
      ...(dto.items && { items: dto.items }),
      ...marcaDosItens,
      ...(dto.transportadora && { transportadora: dto.transportadora }),
      ...(dto.volumes && { volumes: dto.volumes }),
      ...(dto.pagamento && { pagamento: dto.pagamento }),
      ...(dto.duplicatas && { duplicatas: dto.duplicatas }),
      ...(dto.autXml && { autXml: dto.autXml }),
      ...(dto.informacoesComplementares !== undefined && {
        informacoesComplementares: dto.informacoesComplementares,
      }),
    };

    const updatedDraft = await this.prisma.nfe.update({
      where: { id: draftId },
      data: {
        draftData: JSON.parse(JSON.stringify(updatedDraftData)),
        // A lista de notas mostra o total do rascunho (mesmo critério da
        // criação, que soma todos os itens).
        ...(dto.items && { valorTotal: totaisDosItens(dto.items).valorTotal }),
      },
    });

    this.logger.log(`Rascunho de NF-e atualizado: ${draftId}`);

    return {
      id: updatedDraft.id,
      success: true,
      draftData: updatedDraftData,
    };
  }

  /**
   * Deleta um rascunho (cancelar digitação).
   */
  async deleteDraft(companyId: string, draftId: string) {
    const draft = await this.prisma.nfe.findFirst({
      where: {
        id: draftId,
        companyId,
        status: NfeStatus.DRAFT,
      },
    });

    if (!draft) {
      throw new NotFoundException('Rascunho não encontrado');
    }

    await this.prisma.nfe.delete({
      where: { id: draftId },
    });

    this.logger.log(`Rascunho de NF-e deletado: ${draftId}`);

    return {
      success: true,
      message: 'Rascunho deletado com sucesso',
    };
  }

  /**
   * Inutiliza uma faixa de numeração de NF-e na SEFAZ.
   */
  async inutilizar(companyId: string, dto: InutilizarNfeDto) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuração do Invoicy não encontrada.');
    }

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

    const serie = dto.serie ?? config.serieNfe ?? 1;

    try {
      this.logger.log(
        `Inutilizando NF-e ${dto.numeroInicial} a ${dto.numeroFinal} (série ${serie}) para empresa ${companyId}`,
      );

      const invoicyResponses = await this.invoicyApiService.inutilizarNfe(
        companyId,
        serie,
        dto.numeroInicial,
        dto.numeroFinal,
        dto.justificativa,
      );

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
        serie,
        numeroInicial: dto.numeroInicial,
        numeroFinal: dto.numeroFinal,
        protocolo: doc?.DocProtocolo || null,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao inutilizar NF-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao inutilizar NF-e: ${error.message}`,
      );
    }
  }

  /**
   * Lista o histórico de cartas de correção de uma NF-e
   */
  async listCorrectionEvents(nfeId: string, companyId: string) {
    const nfe = await this.prisma.nfe.findFirst({
      where: { id: nfeId, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    const events = await this.prisma.nfeCorrectionEvent.findMany({
      where: { nfeId },
      orderBy: { sequenciaEvento: 'asc' },
      select: {
        id: true,
        sequenciaEvento: true,
        correcao: true,
        status: true,
        protocolo: true,
        dataEvento: true,
        motivoRejeicao: true,
        sitCodigo: true,
        ambiente: true,
        createdBy: true,
        createdByName: true,
        createdAt: true,
        xmlEvento: true,
      },
    });

    return events.map(({ xmlEvento, ...event }) => ({
      ...event,
      hasXml: !!xmlEvento,
    }));
  }

  async getCorrectionEventXml(
    nfeId: string,
    eventId: string,
    companyId: string,
  ) {
    // Validação de posse: a NF-e deve pertencer à empresa
    const nfe = await this.prisma.nfe.findFirst({
      where: { id: nfeId, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    const event = await this.prisma.nfeCorrectionEvent.findFirst({
      where: { id: eventId, nfeId },
    });

    if (!event) {
      throw new NotFoundException('Evento de correção não encontrado');
    }

    if (!event.xmlEvento) {
      throw new NotFoundException(
        'XML não disponível para este evento. O XML pode não ter sido retornado pela Invoicy no momento do envio.',
      );
    }

    return { xml: event.xmlEvento, sequencia: event.sequenciaEvento };
  }

  /**
   * Devolve o DACCE (PDF da carta de correcao) em base64.
   *
   * O provedor nao devolve o PDF no retorno do envio do evento, so' na consulta
   * do documento com ParmEventos=S. Como e' uma chamada externa, o resultado e'
   * cacheado em nfe_correction_documents na primeira vez.
   */
  async getCorrectionEventPdf(
    nfeId: string,
    eventId: string,
    companyId: string,
  ) {
    const nfe = await this.prisma.nfe.findFirst({
      where: { id: nfeId, companyId },
      select: { id: true, chaveAcesso: true, ambiente: true },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    const event = await this.prisma.nfeCorrectionEvent.findFirst({
      where: { id: eventId, nfeId },
      select: {
        id: true,
        sequenciaEvento: true,
        status: true,
        ambiente: true,
        document: { select: { pdf: true } },
      },
    });

    if (!event) {
      throw new NotFoundException('Evento de correção não encontrado');
    }

    if (event.document?.pdf) {
      return {
        pdfBase64: event.document.pdf.toString('base64'),
        sequencia: event.sequenciaEvento,
      };
    }

    if (event.status !== NfeCorrectionStatus.REGISTERED) {
      throw new NotFoundException(
        'A DACCE só existe para cartas de correção registradas na SEFAZ.',
      );
    }

    if (!nfe.chaveAcesso) {
      throw new NotFoundException(
        'NF-e sem chave de acesso: não é possível consultar a DACCE no provedor.',
      );
    }

    const pdf = await this.fetchCorrectionPdfFromProvider(
      companyId,
      nfe.chaveAcesso,
      event.ambiente ?? nfe.ambiente,
      event.sequenciaEvento,
    );

    if (!pdf) {
      throw new NotFoundException(
        'A DACCE ainda não está disponível no provedor fiscal. ' +
          'O documento costuma levar alguns minutos após o registro do evento; tente novamente mais tarde.',
      );
    }

    await this.prisma.nfeCorrectionDocument.upsert({
      where: { correctionEventId: event.id },
      create: { correctionEventId: event.id, pdf },
      update: { pdf },
    });

    return {
      pdfBase64: pdf.toString('base64'),
      sequencia: event.sequenciaEvento,
    };
  }

  /**
   * Consulta o documento no provedor e extrai o PDF do evento com a sequencia
   * pedida. Devolve null quando o provedor ainda nao tem a DACCE pronta.
   */
  private async fetchCorrectionPdfFromProvider(
    companyId: string,
    chaveAcesso: string,
    ambiente: number,
    sequenciaEvento: number,
  ): Promise<Buffer | null> {
    let responses: any[];
    try {
      responses = await this.invoicyApiService.consultDocumentEvents(
        companyId,
        chaveAcesso,
        ambiente,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao consultar a DACCE da NF-e ${chaveAcesso} seq ${sequenciaEvento}: ${error.message}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível falar com o serviço fiscal para obter a DACCE. Tente novamente em instantes.',
      );
    }

    const eventos: InvoicyDocumentEvent[] = (responses || []).flatMap(
      (response) =>
        (response?.Documentos || []).flatMap((doc: any) => doc?.Eventos || []),
    );

    const evento = eventos.find(
      (item) => Number(item?.DocEvenSeq) === sequenciaEvento,
    );

    if (!evento) {
      this.logger.warn(
        `Provedor nao retornou o evento seq ${sequenciaEvento} da NF-e ${chaveAcesso} (${eventos.length} evento(s) na resposta)`,
      );
      return null;
    }

    return this.resolveEventPdf(evento);
  }

  private async resolveEventPdf(
    evento: InvoicyDocumentEvent,
  ): Promise<Buffer | null> {
    if (evento.DocEvePDF) {
      const base64 = evento.DocEvePDF.replace(
        /^data:application\/pdf;base64,/i,
        '',
      );
      const pdf = Buffer.from(base64, 'base64');
      if (this.isPdf(pdf)) return pdf;
    }

    if (!evento.DocEvePDFLink) return null;

    try {
      const response = await fetch(evento.DocEvePDFLink, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return null;

      const pdf = Buffer.from(await response.arrayBuffer());
      return this.isPdf(pdf) ? pdf : null;
    } catch (error) {
      this.logger.warn(
        `Nao foi possivel baixar a DACCE pelo link do provedor: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * XMLs das NF-e autorizadas do periodo em ZIP, com as CC-e de cada nota.
   *
   * O periodo e' lido no fuso da operacao (America/Sao_Paulo): em UTC, uma
   * nota das 22h caia no dia seguinte. Nota autorizada sem XML gravado
   * (emissao respondida sem base64, ou autorizacao posterior por consulta) e'
   * rebuscada no provedor aqui mesmo; a que ainda assim ficar sem XML vai
   * listada em FALTANTES.txt e no retorno, em vez de sumir em silencio como
   * "nenhuma nota no periodo".
   */
  async exportXml(
    companyId: string,
    startDate: string,
    endDate: string,
  ): Promise<ExportXmlResult> {
    const start = startDate && parseProjectDayBoundary(startDate, 'start');
    const end = endDate && parseProjectDayBoundary(endDate, 'end');
    if (!start || !end) {
      throw new BadRequestException(
        'Informe o período no formato AAAA-MM-DD (startDate e endDate)',
      );
    }
    if (start > end) {
      throw new BadRequestException(
        'A data inicial não pode ser maior que a final',
      );
    }

    const periodo = { gte: start, lte: end };

    // CORRECTION_SENT precisa entrar: uma NF-e que recebeu carta de correcao
    // continua sendo um documento autorizado e valido para a escrituracao.
    const nfes = await this.prisma.nfe.findMany({
      where: {
        companyId,
        status: { in: ['AUTHORIZED', 'CORRECTION_SENT'] },
        // dataEmissao so' e' gravada na resposta sincrona da emissao; a nota
        // autorizada depois por consulta pode nao te-la.
        OR: [
          { dataEmissao: periodo },
          { dataEmissao: null, dataAutorizacao: periodo },
          { dataEmissao: null, dataAutorizacao: null, createdAt: periodo },
        ],
      },
      select: {
        id: true,
        numero: true,
        serie: true,
        chaveAcesso: true,
        ambiente: true,
        invoicyConfigId: true,
        xmlAutorizado: true,
        dataEmissao: true,
        dataAutorizacao: true,
        correctionEvents: {
          where: {
            status: NfeCorrectionStatus.REGISTERED,
            xmlEvento: { not: null },
          },
          select: { sequenciaEvento: true, xmlEvento: true },
          orderBy: { sequenciaEvento: 'asc' },
        },
      },
      orderBy: { numero: 'asc' },
    });

    const periodoTexto = `${formatarDataBr(startDate)} e ${formatarDataBr(endDate)}`;
    if (nfes.length === 0) {
      throw new NotFoundException(
        `Nenhuma NF-e autorizada entre ${periodoTexto}.`,
      );
    }

    // Poucas por vez: cada consulta conta no limite do provedor, e o XML
    // recuperado fica gravado — a proxima exportacao nao volta aqui.
    const semXml = nfes.filter((nfe) => !nfe.xmlAutorizado);
    const recuperados = new Map<string, string>();
    for (let i = 0; i < semXml.length; i += 3) {
      const lote = semXml.slice(i, i + 3);
      const resultados = await Promise.allSettled(
        lote.map((nfe) => this.refreshXmlFromProvider(nfe, companyId)),
      );
      resultados.forEach((resultado, index) => {
        if (resultado.status === 'fulfilled' && resultado.value) {
          recuperados.set(lote[index].id, resultado.value);
        }
      });
    }

    const faltantes = semXml
      .filter((nfe) => !recuperados.has(nfe.id))
      .map(({ numero, serie, chaveAcesso }) => ({
        numero,
        serie,
        chaveAcesso,
      }));

    if (faltantes.length === nfes.length) {
      const lista = faltantes.map((n) => `${n.numero}/${n.serie}`).join(', ');
      throw new NotFoundException(
        `${nfes.length} NF-e autorizada(s) no período, mas nenhum XML pôde ser obtido do provedor (notas ${lista}).`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JSZip = require('jszip');
    const zip = new JSZip();

    let correctionCount = 0;
    for (const nfe of nfes) {
      const xml = nfe.xmlAutorizado || recuperados.get(nfe.id);
      if (!xml) continue;

      const identifier = nfe.chaveAcesso || nfe.id;
      zip.file(`NFe_${nfe.numero}_${identifier}.xml`, xml);

      // O XML do evento 110110 integra o documento fiscal e precisa ser
      // guardado junto da nota pelo mesmo prazo decadencial.
      for (const event of nfe.correctionEvents) {
        zip.file(
          `CCe_${identifier}_seq_${event.sequenciaEvento}.xml`,
          event.xmlEvento,
        );
        correctionCount++;
      }
    }

    if (faltantes.length > 0) {
      zip.file(
        'FALTANTES.txt',
        [
          `NF-e autorizadas entre ${periodoTexto} cujo XML não pôde ser obtido do provedor:`,
          ...faltantes.map(
            (n) =>
              `- Nº ${n.numero} série ${n.serie} chave ${n.chaveAcesso ?? '(sem chave)'}`,
          ),
          '',
          'Use "Consultar status" na nota para tentar recuperar o XML.',
        ].join('\n'),
      );
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    this.logger.log(
      `Exportados ${nfes.length - faltantes.length} XMLs de NF-e (${recuperados.size} rebuscados no provedor, ${faltantes.length} faltantes) e ${correctionCount} XMLs de CC-e para ZIP - empresa ${companyId}`,
    );

    return { zip: buffer, total: nfes.length, faltantes };
  }

  /**
   * Calcula os impostos de todos os itens para emissores do Regime Normal.
   *
   * As alíquotas vivem no cadastro fiscal do produto, não no DTO da emissão —
   * por isso a busca aqui. A alíquota interna da UF de destino vem do serviço
   * parametrizável, que aplica os ajustes do superadmin sobre os padrões.
   */
  /**
   * Alíquotas de IBS/CBS quando a Reforma está ativa para o emissor.
   *
   * Devolve `null` enquanto o provedor não ativar o layout da Reforma para a
   * empresa — que é o estado de todos os emissores hoje. As alíquotas do
   * emissor vencem o padrão nacional porque a parcela municipal do IBS é
   * definida por cada município.
   */
  private aliquotasReformaTributaria(config: any): IbsCbsAliquotas | null {
    const { aliquotas, faseCoberta } = aliquotasReformaTributaria(config);
    // Emitir com as alíquotas de teste de 2026 numa fase de alíquotas cheias
    // subdeclararia a nota em duas ordens de grandeza. Barra.
    if (aliquotas && !faseCoberta) {
      throw new BadRequestException(
        'As alíquotas de IBS/CBS da fase vigente ainda não estão confirmadas ' +
          'no sistema. Atualize as alíquotas do emissor antes de emitir com a ' +
          'Reforma Tributária ativa.',
      );
    }
    return aliquotas;
  }

  private async calcularImpostosRegimeNormal(
    companyId: string,
    dto: EmitNfeDto,
    config: any,
    operacao: { ufOrigem: string; ufDestino: string; interestadual: boolean },
  ): Promise<ImpostosNfeMontados> {
    const productIds = [
      ...new Set(dto.items.map((i) => i.productId).filter(Boolean)),
    ] as string[];

    // Escopo por empresa: os productIds vêm do corpo da requisição, e sem o
    // filtro a nota de um tenant era calculada com o cadastro fiscal (NCM,
    // CST, alíquota, MVA) de um produto de outro.
    const fiscais = productIds.length
      ? await this.prisma.productFiscalData.findMany({
          where: { productId: { in: productIds }, product: { companyId } },
        })
      : [];
    const porProduto = new Map(fiscais.map((f) => [f.productId, f]));

    // Regras de ST da UF de destino. Sem linha para a UF, valem os campos de
    // ST do próprio produto, que funcionam como padrão.
    const regrasSt = productIds.length
      ? await this.prisma.productStRule.findMany({
          where: {
            productId: { in: productIds },
            ufDestino: operacao.ufDestino,
            product: { companyId },
          },
        })
      : [];
    const stPorProduto = new Map(regrasSt.map((r) => [r.productId, r]));

    // A alíquota interna do destino também é a "ALQ intra" da MVA ajustada.
    const aliquotaInternaDestino = await this.icmsAliquotaInterna.resolver(
      operacao.ufDestino,
    );
    const optanteSimples = isOptanteSimples(config.emitCrt);

    const aliquotaInterestadual = operacao.interestadual
      ? aliquotaInterestadualIcms(
          operacao.ufOrigem,
          operacao.ufDestino,
          // A origem é do item, mas a alíquota da operação é uma só: os 4% da
          // Resolução 13/2012 valem se houver mercadoria importada na nota.
          fiscais.find((f) =>
            ['1', '2', '3', '8'].includes(String(f.icmsOrigin ?? '')),
          )?.icmsOrigin,
        )
      : null;

    /**
     * Parâmetros de ST do item: a regra da UF vence o padrão do produto, e a
     * MVA passa por `resolverMva`, que aplica o ajuste interestadual e a
     * dispensa do Simples Nacional (Convênio ICMS 35/2011).
     */
    const montarSt = (fiscal: any, productId?: string) => {
      const regra: any = productId ? stPorProduto.get(productId) : undefined;
      const mvaOriginal = regra?.mva ?? fiscal?.icmsStMva;
      if (mvaOriginal === undefined || mvaOriginal === null) return {};

      const aliquotaSt =
        regra?.aliquotaInterna ?? fiscal?.icmsStRate ?? aliquotaInternaDestino;

      return {
        stMva:
          aliquotaSt === null || aliquotaSt === undefined
            ? mvaOriginal
            : resolverMva({
                mvaOriginal,
                aliquotaInterestadual: aliquotaInterestadual ?? 0,
                aliquotaInterna: aliquotaSt,
                optanteSimples,
                interestadual: operacao.interestadual,
              }),
        stAliquota: aliquotaSt,
        stReducaoBase: regra?.reducaoBase ?? fiscal?.icmsStReducao,
        stFcpRate: regra?.fcpStRate ?? fiscal?.fcpStRate,
      };
    };

    const itens: ItemParaCalculo[] = dto.items.map((item) => {
      const fiscal: any = item.productId
        ? porProduto.get(item.productId)
        : undefined;
      // A base do imposto parte dos mesmos vProd, vFrete, vSeg e vDesc que
      // vão ao XML.
      const noXml = valoresDoItemNoXml(item);

      return {
        valores: {
          valorProdutos: noXml.valorProduto,
          frete: noXml.frete,
          seguro: noXml.seguro,
          desconto: noXml.desconto,
        },
        // O CST do item vence o do cadastro: a emissão pode legitimamente
        // mudar a tributação de uma operação específica.
        tributacao: {
          icmsCst: item.cstIcms || fiscal?.icmsCst || '',
          icmsOrigin: fiscal?.icmsOrigin,
          icmsRate: fiscal?.icmsRate,
          icmsReducao: fiscal?.icmsReducao,
          icmsBaseModality: fiscal?.icmsBaseModality,
          fcpRate: fiscal?.fcpRate,
          pisCst: item.cstPis || fiscal?.pisCst,
          pisRate: fiscal?.pisRate,
          cofinsCst: item.cstCofins || fiscal?.cofinsCst,
          cofinsRate: fiscal?.cofinsRate,
          ipiCst: item.cstIpi || fiscal?.ipiCst,
          ipiRate: fiscal?.ipiRate,
          ...montarSt(fiscal, item.productId),
        },
        ipiEnquadramento: fiscal?.ipiFramework,
        cstIbsCbs: fiscal?.cstIbsCbs,
        codClassificacao: fiscal?.codClassificacao,
      };
    });

    // Consumidor final e contribuinte definem a incidência do DIFAL.
    // indIEDest 1 = contribuinte do ICMS; 2 (isento) e 9 (não contribuinte) não.
    const consumidorFinal = (dto.consumidorFinal ?? 0) === 1;
    const contribuinte = (dto.destIndIEDest ?? 9) === 1;

    const precisaDifal =
      operacao.interestadual && consumidorFinal && !contribuinte;

    return montarImpostosNfe(itens, {
      interestadual: operacao.interestadual,
      consumidorFinal,
      contribuinte,
      aliquotaInterestadual,
      aliquotaInternaDestino: precisaDifal
        ? await this.icmsAliquotaInterna.resolver(operacao.ufDestino)
        : null,
      aliquotaFcpDestino: null,
      reformaTributaria: this.aliquotasReformaTributaria(config),
    });
  }

  async findUnified(companyId: string, filters: any) {
    const page = parseInt(filters.page || '1', 10);
    const limit = parseInt(filters.limit || '20', 10);
    const itemsToFetch = page * limit;

    const recordType = filters.recordType || 'TODOS'; // 'TODOS', 'PEDIDOS', 'NOTAS_AVULSAS'
    const status = filters.status || 'TODOS';
    const search = filters.search || '';

    // Filtro por tipo de documento fiscal (abas NF-e / NFS-e / NFC-e).
    const docType = filters.docType || 'TODOS'; // 'TODOS', 'NFE', 'NFSE', 'NFCE'
    const includeNfe = docType === 'TODOS' || docType === 'NFE';
    const includeNfse = docType === 'TODOS' || docType === 'NFSE';
    const includeNfce = docType === 'TODOS' || docType === 'NFCE';
    // Pedidos de venda alimentam a fila de emissão de NF-e e NFS-e (produtos e
    // serviços); não fazem parte do fluxo de NFC-e (venda ao consumidor).
    const includeOrders = includeNfe || includeNfse;
    const config = await this.invoicyService.getConfig(companyId);
    const resolveEnvironmentNumber = (documentType: 'NFE' | 'NFSE' | 'NFCE') =>
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
        config,
        documentType,
      ) === 'PRODUCAO'
        ? 1
        : 2;
    const fiscalEnvironments = {
      nfe: resolveEnvironmentNumber('NFE'),
      nfse: resolveEnvironmentNumber('NFSE'),
      nfce: resolveEnvironmentNumber('NFCE'),
    };

    // Filtro explícito de ambiente (1 = produção, 2 = homologação). Ausente ou
    // inválido significa "todos". Quando informado, ele passa a valer também
    // para resolver o status dos pedidos: sem isso, filtrar homologação com o
    // emissor ativo em produção devolveria pedidos marcados "Não emitida",
    // porque o status olharia um ambiente e o filtro outro.
    const ambienteFiltro =
      filters.ambiente === '1' || filters.ambiente === 1
        ? 1
        : filters.ambiente === '2' || filters.ambiente === 2
          ? 2
          : undefined;
    const envNfe = ambienteFiltro ?? fiscalEnvironments.nfe;
    const envNfse = ambienteFiltro ?? fiscalEnvironments.nfse;

    let ordersPromise = Promise.resolve([]);
    let nfeAvulsasPromise = Promise.resolve([]);
    let nfseAvulsasPromise = Promise.resolve([]);
    let nfceAvulsasPromise = Promise.resolve([]);

    // Rascunho de nota avulsa: nao e' documento fiscal, vive em tabela
    // propria, e aparece aqui para a pessoa achar o que deixou pela metade.
    let rascunhosPromise = Promise.resolve([] as any[]);
    let ordersCountPromise = Promise.resolve(0);
    let nfeCountPromise = Promise.resolve(0);
    let nfseCountPromise = Promise.resolve(0);
    let nfceCountPromise = Promise.resolve(0);

    const orderWhere: any = { quotation: { companyId } };
    const nfeWhere: any = { companyId, orderId: null, quotationId: null };
    const nfseWhere: any = { companyId, orderId: null, quotationId: null };
    const nfceWhere: any = { companyId, quotationId: null };

    if (filters.startDate || filters.endDate) {
      // O período escolhido é o dia CIVIL brasileiro. Fixar em UTC fazia o dia
      // começar às 21h do dia anterior, incluindo e excluindo notas erradas nas
      // pontas — e divergindo do cabeçalho de grupo, que agrupa por data local.
      const createdAtFilter: any = {};
      const start =
        filters.startDate &&
        parseProjectDayBoundary(filters.startDate, 'start');
      const end =
        filters.endDate && parseProjectDayBoundary(filters.endDate, 'end');
      if (start) createdAtFilter.gte = start;
      if (end) createdAtFilter.lte = end;
      orderWhere.createdAt = createdAtFilter;
      nfeWhere.createdAt = createdAtFilter;
      nfseWhere.createdAt = createdAtFilter;
      nfceWhere.createdAt = createdAtFilter;
    }

    // Nas avulsas o ambiente é coluna própria do documento. Nos pedidos ele é
    // herdado dos documentos e só pode ser aplicado depois dos branches de
    // status, que atribuem orderWhere.AND diretamente.
    if (ambienteFiltro) {
      nfeWhere.ambiente = ambienteFiltro;
      nfseWhere.ambiente = ambienteFiltro;
      nfceWhere.ambiente = ambienteFiltro;
    }

    // Item 1: Obtém IDs de NF-es rejeitadas que já têm versão autorizada posterior
    // com mesmo numero+serie para não exibi-las em duplicidade
    const excludedRows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM nfes r
      WHERE r."companyId" = ${companyId}
        AND r.status = 'REJECTED'
        AND EXISTS (
          SELECT 1 FROM nfes a
          WHERE a."companyId" = r."companyId"
            AND a.numero = r.numero
            AND a.serie = r.serie
            AND a.status IN ('AUTHORIZED', 'CORRECTION_SENT')
            AND a."createdAt" > r."createdAt"
        )
    `;
    const excludedNfeIds = excludedRows.map((row) => row.id);
    if (excludedNfeIds.length > 0) {
      nfeWhere.id = { notIn: excludedNfeIds };
    }

    if ((recordType === 'TODOS' || recordType === 'PEDIDOS') && includeOrders) {
      if (status === 'EMITIDA') {
        orderWhere.OR = [
          {
            nfes: {
              some: {
                status: { in: EMITIDA_NFE_STATUSES },
                ambiente: envNfe,
              },
            },
          },
          {
            nfeOrders: {
              some: {
                nfe: {
                  status: { in: EMITIDA_NFE_STATUSES },
                  ambiente: envNfe,
                },
              },
            },
          },
          {
            nfses: {
              some: {
                status: NfseStatus.AUTHORIZED,
                ambiente: envNfse,
              },
            },
          },
          // Ordem coberta por uma NFS-e consolidada: a nota esta' no vinculo,
          // nao em `nfses`, que so' guarda a ordem principal.
          {
            nfseOrders: {
              some: {
                nfse: {
                  status: NfseStatus.AUTHORIZED,
                  ambiente: envNfse,
                },
              },
            },
          },
        ];
      } else if (status === 'EM_DIGITACAO') {
        orderWhere.OR = [
          {
            nfes: {
              some: { status: 'DRAFT', ambiente: envNfe },
            },
          },
          {
            nfeOrders: {
              some: {
                nfe: { status: 'DRAFT', ambiente: envNfe },
              },
            },
          },
          {
            nfses: {
              some: {
                status: {
                  in: [
                    NfseStatus.DRAFT,
                    NfseStatus.PENDING,
                    NfseStatus.PROCESSING,
                  ],
                },
                ambiente: envNfse,
              },
            },
          },
          {
            nfseOrders: {
              some: {
                nfse: {
                  status: {
                    in: [
                      NfseStatus.DRAFT,
                      NfseStatus.PENDING,
                      NfseStatus.PROCESSING,
                    ],
                  },
                  ambiente: envNfse,
                },
              },
            },
          },
        ];
        orderWhere.AND = [
          {
            nfes: {
              none: {
                status: { in: EMITIDA_NFE_STATUSES },
                ambiente: envNfe,
              },
            },
          },
          {
            nfeOrders: {
              none: {
                nfe: {
                  status: { in: EMITIDA_NFE_STATUSES },
                  ambiente: envNfe,
                },
              },
            },
          },
          {
            nfses: {
              none: {
                status: NfseStatus.AUTHORIZED,
                ambiente: envNfse,
              },
            },
          },
          {
            nfseOrders: {
              none: {
                nfse: {
                  status: NfseStatus.AUTHORIZED,
                  ambiente: envNfse,
                },
              },
            },
          },
        ];
      } else if (status === 'NAO_EMITIDA') {
        orderWhere.AND = [
          {
            nfes: {
              none: {
                status: { in: [...EMITIDA_NFE_STATUSES, 'DRAFT'] },
                ambiente: envNfe,
              },
            },
          },
          {
            nfeOrders: {
              none: {
                nfe: {
                  status: { in: [...EMITIDA_NFE_STATUSES, 'DRAFT'] },
                  ambiente: envNfe,
                },
              },
            },
          },
          {
            nfses: {
              none: {
                status: {
                  in: [
                    NfseStatus.AUTHORIZED,
                    NfseStatus.DRAFT,
                    NfseStatus.PENDING,
                    NfseStatus.PROCESSING,
                  ],
                },
                ambiente: envNfse,
              },
            },
          },
          // Sem este `none`, as demais ordens de uma NFS-e consolidada caiam
          // no filtro de nao emitidas — e a entrada agrupada aparecia ali
          // dizendo "Emitida".
          {
            nfseOrders: {
              none: {
                nfse: {
                  status: {
                    in: [
                      NfseStatus.AUTHORIZED,
                      NfseStatus.DRAFT,
                      NfseStatus.PENDING,
                      NfseStatus.PROCESSING,
                    ],
                  },
                  ambiente: envNfse,
                },
              },
            },
          },
        ];
        orderWhere.status = { not: 'CANCELED' };
      } else if (status === 'CANCELADA') {
        /**
         * O filtro se chama "Status da NF": o que se procura e' pedido cujo
         * DOCUMENTO foi cancelado. Antes este branch filtrava
         * `orderWhere.status = 'CANCELED'`, que e' o pedido cancelado — coisa
         * diferente. Com isso o caso comum (cancelar a NF-e de uma O.S. que
         * segue ativa) nao aparecia, e apareciam vendas canceladas que nunca
         * tiveram nota. O pedido cancelado continua na lista quando tem
         * documento cancelado, porque e' o documento que o OR procura.
         */
        orderWhere.OR = [
          {
            nfes: {
              some: { status: NfeStatus.CANCELLED, ambiente: envNfe },
            },
          },
          {
            nfeOrders: {
              some: {
                nfe: { status: NfeStatus.CANCELLED, ambiente: envNfe },
              },
            },
          },
          {
            nfses: {
              some: { status: NfseStatus.CANCELLED, ambiente: envNfse },
            },
          },
          {
            nfseOrders: {
              some: {
                nfse: { status: NfseStatus.CANCELLED, ambiente: envNfse },
              },
            },
          },
        ];
      } else if (status === 'REJEITADA') {
        /**
         * Mesma ideia do branch acima, para o pedido cujo documento foi
         * recusado. Sem este branch o valor caia no fim da cadeia e a lista de
         * pedidos voltava sem filtro nenhum, enquanto as avulsas vinham
         * filtradas — duas respostas diferentes para o mesmo seletor.
         *
         * `excludedNfeIds` entra aqui pelo mesmo motivo que entra nas avulsas:
         * sao rejeicoes que ja' ganharam uma versao autorizada depois, com o
         * mesmo numero e serie. Quem filtra "Rejeitada" procura o que ainda
         * precisa de atencao, nao o que ja' foi resolvido numa segunda
         * tentativa. A lista nao cobre NFS-e porque essa deduplicacao so'
         * existe para NF-e.
         */
        const nfeRejeitada: any = {
          status: NfeStatus.REJECTED,
          ambiente: envNfe,
          ...(excludedNfeIds.length > 0
            ? { id: { notIn: excludedNfeIds } }
            : {}),
        };
        orderWhere.OR = [
          { nfes: { some: nfeRejeitada } },
          { nfeOrders: { some: { nfe: nfeRejeitada } } },
          {
            nfses: {
              some: { status: NfseStatus.REJECTED, ambiente: envNfse },
            },
          },
          // Ordem coberta por consolidada, como nos demais filtros: a nota
          // esta' no vinculo, nao em `nfses`.
          {
            nfseOrders: {
              some: {
                nfse: { status: NfseStatus.REJECTED, ambiente: envNfse },
              },
            },
          },
        ];
      }

      // Precisa vir DEPOIS dos branches acima, que atribuem orderWhere.AND
      // diretamente: aplicar antes seria descartado junto com o filtro de
      // status. Por isso empilha em AND em vez de atribuir.
      if (ambienteFiltro) {
        // O pedido não tem ambiente próprio — herda o dos documentos emitidos a
        // partir dele. Pedido ainda sem documento aparece em qualquer ambiente:
        // está por emitir e não pertence a nenhum.
        const ambienteOr: any[] = [
          ...(includeNfe
            ? [
                { nfes: { some: { ambiente: ambienteFiltro } } },
                { nfeOrders: { some: { nfe: { ambiente: ambienteFiltro } } } },
              ]
            : []),
          ...(includeNfse
            ? [{ nfses: { some: { ambiente: ambienteFiltro } } }]
            : []),
          {
            AND: [
              { nfes: { none: {} } },
              { nfeOrders: { none: {} } },
              { nfses: { none: {} } },
            ],
          },
        ];

        const existingAnd = orderWhere.AND
          ? Array.isArray(orderWhere.AND)
            ? orderWhere.AND
            : [orderWhere.AND]
          : [];
        orderWhere.AND = [...existingAnd, { OR: ambienteOr }];
      }

      if (search) {
        const searchAsNumber = Number(search.replace(/\D/g, ''));
        orderWhere.quotation.OR = [
          { description: { contains: search, mode: 'insensitive' } },
          { client: { name: { contains: search, mode: 'insensitive' } } },
        ];
        if (!isNaN(searchAsNumber) && searchAsNumber > 0) {
          orderWhere.quotation.OR.push({ quotationNumber: searchAsNumber });
        }
      }

      ordersPromise = this.prisma.order.findMany({
        where: orderWhere,
        take: itemsToFetch,
        orderBy: { createdAt: 'desc' },
        include: {
          quotation: {
            include: {
              client: true,
              series: true,
              seller: { include: { user: true } },
            },
          },
          nfes: true,
          nfeOrders: { include: { nfe: true } },
          nfses: true,
          // A NFS-e consolidada cobre varias ordens e so' a principal aparece
          // em `nfses`. O vinculo diz quais ordens a nota cobre, e a contagem
          // aninhada diz se ela e' consolidada (mais de uma) ou comum.
          nfseOrders: {
            include: {
              nfse: { include: { nfseOrders: { select: { orderId: true } } } },
            },
          },
        },
      });
      ordersCountPromise = this.prisma.order.count({ where: orderWhere });
    }

    if (recordType === 'TODOS' || recordType === 'NOTAS_AVULSAS') {
      if (includeNfe) {
        if (status === 'EMITIDA')
          nfeWhere.status = { in: EMITIDA_NFE_STATUSES };
        else if (status === 'EM_DIGITACAO') nfeWhere.status = 'DRAFT';
        else if (status === 'CANCELADA') nfeWhere.status = 'CANCELLED';
        else if (status === 'REJEITADA') nfeWhere.status = 'REJECTED';
        else if (status === 'NAO_EMITIDA') nfeWhere.id = 'not-possible';

        if (search) {
          const searchAsNumber = Number(search.replace(/\D/g, ''));
          if (!isNaN(searchAsNumber) && searchAsNumber > 0) {
            nfeWhere.numero = searchAsNumber;
          } else {
            nfeWhere.chaveAcesso = { contains: search };
          }
        }

        nfeAvulsasPromise = this.prisma.nfe.findMany({
          where: nfeWhere,
          take: itemsToFetch,
          orderBy: { createdAt: 'desc' },
        });
        nfeCountPromise = this.prisma.nfe.count({ where: nfeWhere });
      }

      if (includeNfse) {
        if (status === 'EMITIDA') nfseWhere.status = 'AUTHORIZED';
        else if (status === 'EM_DIGITACAO') nfseWhere.status = 'DRAFT';
        else if (status === 'CANCELADA') nfseWhere.status = 'CANCELLED';
        else if (status === 'REJEITADA') nfseWhere.status = 'REJECTED';
        else if (status === 'NAO_EMITIDA') nfseWhere.id = 'not-possible';

        if (search) {
          const searchAsNumber = Number(search.replace(/\D/g, ''));
          if (!isNaN(searchAsNumber) && searchAsNumber > 0) {
            nfseWhere.numero = searchAsNumber;
          } else {
            nfseWhere.codigoVerificacao = { contains: search };
          }
        }

        nfseAvulsasPromise = this.prisma.nfse.findMany({
          where: nfseWhere,
          take: itemsToFetch,
          orderBy: { createdAt: 'desc' },
        });
        nfseCountPromise = this.prisma.nfse.count({ where: nfseWhere });
      }

      if (includeNfce) {
        if (status === 'EMITIDA') nfceWhere.status = 'AUTHORIZED';
        else if (status === 'EM_DIGITACAO') nfceWhere.status = 'PROCESSING';
        else if (status === 'CANCELADA') nfceWhere.status = 'CANCELLED';
        else if (status === 'REJEITADA') nfceWhere.status = 'REJECTED';
        else if (status === 'NAO_EMITIDA') nfceWhere.id = 'not-possible';

        if (search) {
          const searchAsNumber = Number(search.replace(/\D/g, ''));
          if (!isNaN(searchAsNumber) && searchAsNumber > 0) {
            nfceWhere.numero = searchAsNumber;
          } else {
            nfceWhere.chaveAcesso = { contains: search };
          }
        }

        nfceAvulsasPromise = this.prisma.nfce.findMany({
          where: nfceWhere,
          take: itemsToFetch,
          orderBy: { createdAt: 'desc' },
          include: {
            order: {
              include: {
                quotation: {
                  include: {
                    client: true,
                    series: true,
                  },
                },
              },
            },
          },
        });
        nfceCountPromise = this.prisma.nfce.count({ where: nfceWhere });
      }
    }

    // So' entram quando o filtro de status admite algo ainda nao emitido.
    const statusAceitaRascunho =
      status === 'TODOS' || status === 'EM_DIGITACAO';
    if (
      statusAceitaRascunho &&
      (recordType === 'TODOS' || recordType === 'NOTAS_AVULSAS')
    ) {
      const docTypesDoRascunho = [
        ...(includeNfe ? ['NFE'] : []),
        ...(includeNfse ? ['NFSE'] : []),
        ...(includeNfce ? ['NFCE'] : []),
      ];
      rascunhosPromise = this.prisma.fiscalStandaloneDraft.findMany({
        where: {
          companyId,
          docType: { in: docTypesDoRascunho as any },
          ...(nfeWhere.createdAt ? { updatedAt: nfeWhere.createdAt } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: itemsToFetch,
      }) as any;
    }

    const [
      orders,
      nfeAvulsas,
      nfseAvulsas,
      nfceAvulsas,
      rascunhos,
      ordersCount,
      nfeCount,
      nfseCount,
      nfceCount,
    ] = await Promise.all([
      ordersPromise,
      nfeAvulsasPromise,
      nfseAvulsasPromise,
      nfceAvulsasPromise,
      rascunhosPromise,
      ordersCountPromise,
      nfeCountPromise,
      nfseCountPromise,
      nfceCountPromise,
    ]);

    const unifiedItems = [];

    /**
     * Uma NFS-e consolidada cobre varias ordens, e a lista mostrava uma linha
     * por ordem: so' a principal dizia "Emitida", as outras diziam "Nao
     * emitida", e o valor exibido era o da ordem, nao o da nota. As ordens
     * cobertas viram uma entrada unica, com o numero da nota, o valor dela e
     * um unico PDF.
     *
     * A desduplicacao vale dentro da requisicao: `itemsToFetch` e' page*limit,
     * entao toda ordem anterior a' pagina pedida ja' veio junto e a nota e'
     * vista uma vez so'.
     */
    const referenciaDaOrdem = (o: any) =>
      o.quotation?.series?.code
        ? `${o.quotation.series.code}-${o.quotation.quotationNumber}`
        : `OS ${o.quotation?.quotationNumber || ''}`;

    const consolidadasEmitidas = new Set<string>();
    let ordensAbsorvidas = 0;

    for (const o of orders as any[]) {
      const notaConsolidada = (o.nfseOrders || [])
        .map((vinculo: any) => vinculo.nfse)
        .find((n: any) => n && (n.nfseOrders?.length ?? 0) > 1);

      if (notaConsolidada) {
        ordensAbsorvidas++;
        if (consolidadasEmitidas.has(notaConsolidada.id)) continue;
        consolidadasEmitidas.add(notaConsolidada.id);

        const ordensDaNota = notaConsolidada.nfseOrders.length;
        unifiedItems.push({
          type: 'NFSE_CONSOLIDADA',
          id: notaConsolidada.id,
          // A data e' a da emissao, nao a da ordem: a entrada representa a
          // nota, e as ordens dela podem ser de dias diferentes.
          createdAt: notaConsolidada.createdAt,
          status: notaConsolidada.status,
          clientName: o.quotation?.client?.name || 'Cliente não identificado',
          reference: `NFS-e ${notaConsolidada.numero || 's/n'} · ${ordensDaNota} O.S.`,
          totalValue: notaConsolidada.valorServicos || 0,
          consolidatedOrderCount: ordensDaNota,
          nfes: [],
          nfses: [notaConsolidada],
          nfse: notaConsolidada,
          originalData: notaConsolidada,
        });
        continue;
      }

      unifiedItems.push({
        type: 'ORDER',
        id: o.id,
        createdAt: o.createdAt,
        status: o.status,
        clientName: o.quotation?.client?.name || 'Cliente não identificado',
        reference: referenciaDaOrdem(o),
        totalValue: (o.quotation?.totalValue || 0) / 100,
        nfes: [
          ...(o.nfes || []),
          ...(o.nfeOrders?.map((no) => no.nfe) || []),
        ].filter((n) => !excludedNfeIds.includes(n.id)),
        nfses: o.nfses || [],
        nfse: (o.nfses || [])[0] || null,
        originalData: o,
      });
    }

    // Lista as ordens de cada consolidada que vieram nesta busca, para a tela
    // mostrar quais O.S. entraram sem precisar de outra chamada.
    if (consolidadasEmitidas.size > 0) {
      const ordensPorNota = new Map<string, any[]>();
      for (const o of orders as any[]) {
        for (const vinculo of o.nfseOrders || []) {
          const nota = vinculo.nfse;
          if (!nota || !consolidadasEmitidas.has(nota.id)) continue;
          const lista = ordensPorNota.get(nota.id) ?? [];
          lista.push({
            id: o.id,
            reference: referenciaDaOrdem(o),
            totalValue: (o.quotation?.totalValue || 0) / 100,
          });
          ordensPorNota.set(nota.id, lista);
        }
      }
      for (const item of unifiedItems as any[]) {
        if (item.type !== 'NFSE_CONSOLIDADA') continue;
        item.consolidatedOrders = ordensPorNota.get(item.id) ?? [];
      }
    }

    for (const n of nfeAvulsas as any[]) {
      const draftData =
        typeof n.draftData === 'string'
          ? JSON.parse(n.draftData)
          : n.draftData || {};
      const finalidade =
        draftData?.emissao?.finalidade ?? draftData?.finalidade ?? 1;
      unifiedItems.push({
        type: 'NFE_AVULSA',
        id: n.id,
        createdAt: n.createdAt,
        status: n.status,
        finalidade,
        clientName:
          draftData?.destinatario?.razaoSocial ||
          draftData?.destNome ||
          'Avulsa s/ Destinatário',
        reference: `NF-e ${n.numero}`,
        totalValue: n.valorTotal || 0,
        nfes: [n],
        originalData: n,
      });
    }

    for (const s of nfseAvulsas as any[]) {
      const draftData =
        typeof s.draftData === 'string'
          ? JSON.parse(s.draftData)
          : s.draftData || {};
      unifiedItems.push({
        type: 'NFSE_AVULSA',
        id: s.id,
        createdAt: s.createdAt,
        status: s.status,
        clientName: draftData?.tomador?.razaoSocial || 'Avulsa s/ Tomador',
        reference: `NFS-e ${s.numero}`,
        totalValue: s.valorServicos || 0,
        nfes: [],
        nfse: s,
        originalData: s,
      });
    }

    for (const nf of nfceAvulsas as any[]) {
      const order = nf.order;
      const orderReference = order?.quotation?.series?.code
        ? `${order.quotation.series.code}-${order.quotation.quotationNumber}`
        : order?.quotation?.quotationNumber
          ? `OS ${order.quotation.quotationNumber}`
          : null;
      unifiedItems.push({
        type: 'NFCE_AVULSA',
        id: nf.id,
        createdAt: nf.createdAt,
        status: nf.status,
        clientName:
          nf.consumidorNome ||
          order?.quotation?.client?.name ||
          'Consumidor não identificado',
        reference: orderReference
          ? `NFC-e ${nf.numero} · ${orderReference}`
          : `NFC-e ${nf.numero}`,
        totalValue: nf.valorTotal || 0,
        nfes: [],
        nfce: nf,
        originalData: nf,
      });
    }

    const rotuloDoDoc: Record<string, string> = {
      NFE: 'NF-e',
      NFSE: 'NFS-e',
      NFCE: 'NFC-e',
    };
    for (const r of rascunhos as any[]) {
      unifiedItems.push({
        type: 'RASCUNHO_AVULSO',
        id: r.id,
        // Ordena pela ultima edicao: e' o que a pessoa quer achar primeiro.
        createdAt: r.updatedAt,
        status: 'DRAFT',
        docType: r.docType,
        clientName: r.description || 'Sem destinatário',
        reference: `${rotuloDoDoc[r.docType] || r.docType} avulsa`,
        totalValue: r.totalValue || 0,
        nfes: [],
        originalData: r,
      });
    }

    unifiedItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const startIndex = (page - 1) * limit;
    const paginatedItems = unifiedItems.slice(startIndex, startIndex + limit);

    const groupedItems = [];
    let currentDate = null;
    let currentGroup = null;

    for (const item of paginatedItems) {
      // Data local da operação, não UTC: agrupar por UTC jogava as emissões
      // feitas depois das 21h no dia seguinte.
      const dateStr = toProjectDateKey(item.createdAt);
      if (dateStr !== currentDate) {
        if (currentGroup) groupedItems.push(currentGroup);
        currentDate = dateStr;
        currentGroup = { date: dateStr, items: [] };
      }
      currentGroup.items.push(item);
    }
    if (currentGroup) groupedItems.push(currentGroup);

    // Cada consolidada ocupa uma linha no lugar de N ordens; sem descontar,
    // a paginacao prometia paginas que vinham vazias.
    const totalCount =
      Math.max((ordersCount as number) - ordensAbsorvidas, 0) +
      consolidadasEmitidas.size +
      (rascunhos as any[]).length +
      (nfeCount as number) +
      (nfseCount as number) +
      (nfceCount as number);

    return {
      data: groupedItems,
      page,
      limit,
      lastPage: Math.ceil(totalCount / limit) || 1,
      total: totalCount,
    };
  }
}
