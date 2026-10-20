import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfceStatus, NfeStatus, NfseStatus, OrderStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import {
  InvoicyNfseRequest,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import {
  EmitNfseDto,
  EmitNfseFromOrderDto,
  EmitNfseFromOrdersDto,
  CancelNfseDto,
  NfseFilterDto,
} from './dtos/nfse.dto';
import { fetchCepData } from '../utils/cep.util';
import {
  isHistoricalDocument,
  loadFiscalHistoryLock,
} from '../shared/fiscal-history-lock';

/**
 * Pre-visualizacao da NFS-e: o mesmo RPS que seria transmitido, sem reservar
 * numero nem criar registro.
 */
export interface NfsePreview {
  podeEmitir: boolean;
  bloqueios: string[];
  avisos: string[];
  documento?: {
    modelo: string;
    ambiente: 'HOMOLOGACAO' | 'PRODUCAO';
    /** RPS previsto; o definitivo e reservado na emissao. */
    rpsPrevisto: number;
    rpsSerie: string;
    /** A prefeitura numera a NFS-e no retorno da recepcao. */
    numeroNfse: number | null;
    dataEmissaoPrevista?: string;
    dataCompetencia?: string;
    naturezaOperacao?: number;
    localPrestacao?: number;
    optanteSimples?: number;
    regimeEspecial?: number | null;
    cIndOp?: string | null;
    indFinal?: number | null;
    indDest?: number | null;
    tpEnteGov?: number | null;
    tpOper?: number | null;
    regApIbsCbsSn?: number | null;
  };
  prestador?: Record<string, any>;
  tomador?: Record<string, any>;
  servico?: Record<string, any>;
  itens?: Array<Record<string, any>>;
  valores?: Record<string, any>;
  /** Payload cru, para o painel tecnico e para os testes de equivalencia. */
  payloadInvoicy?: InvoicyNfseRequest;
}

import { aliquotasVigentes, calcularIbsCbs } from '../utils/ibs-cbs.util';
import {
  isMei,
  isOptanteSimples,
  regimeEspecialPadraoNfse,
} from '../utils/regime-tributario.util';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { MailService } from '../../mail/mail.service';
import { ProductFiscalService } from '../product-fiscal/product-fiscal.service';

/**
 * O item que dá o código de serviço, o ISS e a classificação da nota: o
 * primeiro produto de serviço; sem ele, o primeiro com produto. O item sem
 * produto (material de venda direta, montado na hora) é mercadoria e não
 * entra (PO, 14/10/2026).
 */
const serviceItemOf = <T extends { product?: { isService?: boolean } | null }>(
  items: T[] | undefined,
) =>
  items?.find((item) => item.product?.isService) ??
  items?.find((item) => item.product);

@Injectable()
export class NfseService {
  private readonly logger = new Logger(NfseService.name);
  private readonly activeNfeStatuses = [
    NfeStatus.AUTHORIZED,
    NfeStatus.CORRECTION_SENT,
    NfeStatus.DRAFT,
    NfeStatus.PROCESSING,
    NfeStatus.PENDING,
  ];
  private readonly activeNfseStatuses = [
    NfseStatus.AUTHORIZED,
    NfseStatus.DRAFT,
    NfseStatus.PROCESSING,
    NfseStatus.PENDING,
  ];
  private readonly activeNfceStatuses = [
    NfceStatus.AUTHORIZED,
    NfceStatus.PROCESSING,
    NfceStatus.UNKNOWN,
    NfceStatus.CONTINGENCY,
    NfceStatus.PENDING,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyApiService: InvoicyApiService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
    private readonly mailService: MailService,
    private readonly productFiscalService: ProductFiscalService,
  ) {}

  /**
   * Valor monetário com 2 casas. Sem isso, `(0.01 * 2.53) / 100` chega ao
   * Invoicy como 0.00025299999999999997 e a API responde HTTP 500.
   * NF-e e NFC-e já arredondam todo o payload; a NFS-e era a exceção.
   */
  private money(value: number): number {
    return Number((value || 0).toFixed(2));
  }

  /** Alíquota com 4 casas — municípios usam alíquotas como 2,5341%. */
  private rate(value: number): number {
    return Number((value || 0).toFixed(4));
  }

  /**
   * Envelope da resposta do provedor para persistência, sem os blobs (XML e PDF
   * em base64) que dominariam a coluna. É o que permite diagnosticar uma
   * rejeição depois: o motivo textual sozinho costuma ser genérico.
   */
  private retornoBrutoParaPersistir(response: any) {
    try {
      return JSON.parse(
        JSON.stringify(response, (_k, v) =>
          typeof v === 'string' && v.length > 500
            ? `<${v.length} bytes omitidos>`
            : v,
        ),
      );
    } catch {
      return { erro: 'resposta não serializável' };
    }
  }

  /**
   * Classificação fiscal cadastrada no serviço (ProductFiscalData). Só devolve
   * as chaves preenchidas: cada campo ausente é omitido do payload, para não
   * mudar o comportamento de quem emite hoje sem tê-los cadastrados.
   */
  private classificacaoFiscalDoServico(fiscalData: any) {
    if (!fiscalData) return {};

    const preenchido = (valor?: string | null) =>
      valor && String(valor).trim() ? String(valor).trim() : undefined;

    return {
      ...(preenchido(fiscalData.nbs)
        ? { nbs: preenchido(fiscalData.nbs) }
        : {}),
      ...(preenchido(fiscalData.codTribNacional)
        ? { codTribNacional: preenchido(fiscalData.codTribNacional) }
        : {}),
      ...(preenchido(fiscalData.codTribMunicipio)
        ? { codTribMunicipio: preenchido(fiscalData.codTribMunicipio) }
        : {}),
      ...(preenchido(fiscalData.cnae)
        ? { cnae: preenchido(fiscalData.cnae) }
        : {}),
      ...(preenchido(fiscalData.cstIbsCbs)
        ? { cstIbsCbs: preenchido(fiscalData.cstIbsCbs) }
        : {}),
      ...(preenchido(fiscalData.codClassificacao)
        ? { codClassificacao: preenchido(fiscalData.codClassificacao) }
        : {}),
    };
  }

  async findAll(companyId: string, filters: NfseFilterDto) {
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
      this.prisma.nfse.findMany({
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
      this.prisma.nfse.count({ where }),
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
    const nfse = await this.prisma.nfse.findFirst({
      where: { id, companyId },
      include: {
        order: {
          include: {
            quotation: {
              include: {
                client: {
                  include: {
                    address: true,
                  },
                },
                quotationProduct: {
                  include: {
                    product: {
                      include: {
                        fiscalData: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        quotation: {
          include: {
            client: {
              include: {
                address: true,
              },
            },
            quotationProduct: {
              include: {
                product: {
                  include: {
                    fiscalData: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!nfse) {
      throw new NotFoundException('NFS-e não encontrada');
    }

    return nfse;
  }

  // Preparar dados para emissão de NFS-e avulsa (sem ordem de serviço)
  async prepareStandalone(companyId: string, clientId?: string) {
    // Buscar configuração do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    const environment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
        config,
        'NFSE',
      );
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFSE',
    );

    // Dados do tomador (vazio por padrão)
    let tomador: Record<string, any> = {
      cnpj: undefined,
      cpf: undefined,
      razaoSocial: '',
      endereco: '',
      numero: 'S/N',
      complemento: '',
      bairro: '',
      cep: '',
      codigoMunicipio: '',
      municipio: '',
      uf: '',
      email: '',
      telefone: '',
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

      tomador = {
        cnpj: (client as any).cnpj || undefined,
        cpf: (client as any).cpf || undefined,
        razaoSocial: (client as any).corporateName || client.name || '',
        endereco: clientAddress?.street || '',
        numero: clientAddress?.number || 'S/N',
        complemento: clientAddress?.complement || '',
        bairro: clientAddress?.neighborhood || '',
        cep: clientAddress?.zipcode || '',
        codigoMunicipio: '', // Será preenchido pelo usuário ou na emissão
        municipio: clientAddress?.city || '',
        uf: clientAddress?.state || '',
        email: client.email || '',
        telefone: (client as any).phone || (client as any).mobile || '',
      };
    }

    return {
      // Metadados
      orderId: null,
      quotationId: null,
      clientId: clientId || null,
      selectedAddressId,
      clientAddresses,
      entrega: null,

      // Prestador
      prestador: {
        cnpj: config.company.cnpj || '',
        razaoSocial: config.company.legalName || config.company.name || '',
        inscricaoMunicipal: config.company.municipalRegistration || '',
        ambiente: environment,
        endereco: {
          logradouro: config.company.address?.street || '',
          numero: config.company.address?.number || 'S/N',
          complemento: '',
          bairro: config.company.address?.neighborhood || '',
          cidade: config.company.address?.city || '',
          uf: config.company.address?.state || '',
          cep: config.company.address?.zipcode || '',
        },
      },

      // RPS — numeração da linha do ambiente ativo, a mesma que
      // reserveNfseRpsNumber vai consumir na emissão. A coluna legada
      // `proximoRpsNfse` é global e não acompanha mais o contador.
      rpsNumero: config.activeNumbering.nfse.nextNumber,
      rpsSerie: config.activeNumbering.nfse.series,

      // Tomador
      tomador,

      // Dados fiscais
      dataCompetencia: new Date().toISOString().split('T')[0],
      naturezaOperacao: 1,
      codigoServico: config.codigoServico || '',
      codigoMunicipio: config.ibgeCode || config.emitCmun || '',
      discriminacao: '',
      valorServicos: 0,
      valorDeducoes: 0,
      aliquotaIss: config.aliquotaIss || 0,
      issRetido: false,
    };
  }

  // Emitir NFS-e a partir de uma ordem de serviço (busca dados automaticamente)
  /**
   * Constrói o DTO completo da NFS-e a partir da ordem de serviço.
   *
   * Separado de `emitFromOrder` para a pré-visualização partir exatamente do
   * mesmo documento que a emissão montaria.
   */
  private async buildNfseDtoFromOrder(
    companyId: string,
    dto: EmitNfseFromOrderDto,
  ): Promise<EmitNfseDto> {
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
        order: { include: this.orderFiscalInclude() },
        deliveryInfo: {
          include: {
            clientAddress: true,
          },
        },
        quotationProduct: {
          include: {
            product: {
              include: {
                fiscalData: true,
              },
            },
          },
        },
      },
    });

    if (!quotation || !quotation.order) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    await this.assertOrdersCanReceiveNfse([quotation.order as any], companyId);

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

    // Garantir código IBGE do PRESTADOR (empresa emissora)
    let prestadorCmun = config.ibgeCode || '';
    const emitCep = config.company?.address?.zipcode;

    if (!prestadorCmun && emitCep) {
      this.logger.log(
        `Prestador sem código IBGE configurado. Buscando via CEP: ${emitCep}`,
      );
      const cepData = await fetchCepData(emitCep);
      if (cepData) {
        prestadorCmun = cepData.codigoIbge;
        this.logger.log(`IBGE do prestador encontrado: ${prestadorCmun}`);

        // Cache IBGE code to avoid external API calls on subsequent emissions
        await this.prisma.invoicyConfig.updateMany({
          where: { companyId },
          data: { emitCmun: prestadorCmun },
        });
        this.logger.log(`IBGE do prestador persistido no InvoicyConfig`);
      } else {
        this.logger.warn(
          `Não foi possível encontrar IBGE para CEP do prestador: ${emitCep}`,
        );
      }
    }

    // Calcular valor total dos serviços — prefere itens com isService=true;
    // se nenhum estiver marcado como serviço, usa todos os itens (fallback)
    // IMPORTANTE: Valores no banco estão em centavos, dividir por 100 para reais
    const allProducts = quotation.quotationProduct;
    const serviceProducts = allProducts.filter(
      (qp) => (qp.product as any)?.isService,
    );
    const productsToSum =
      serviceProducts.length > 0 ? serviceProducts : allProducts;
    const valorServicos =
      productsToSum.reduce(
        (acc: number, qp) => acc + (qp.finalValue || qp.totalValue || 0),
        0,
      ) / 100;

    // Tomador: sempre o principal cadastral do cliente
    const clientAddress = client.address?.[0];

    // Local de prestação / entrega
    const selectedEntregaAddress = dto.addressId
      ? client.address?.find((a: any) => a.id === dto.addressId)
      : null;
    // Se o usuário especificou addressId ou manual, usamos. Caso contrário, usamos a entrega da OS se existente
    const entregaAddress =
      selectedEntregaAddress ||
      (dto.entregaEndereco
        ? null
        : (quotation as any).deliveryInfo?.clientAddress);

    // Campos do tomador: usa override do DTO quando fornecido, senão usa cadastro do cliente
    const tomadorCepFinal = dto.tomadorCep || clientAddress?.zipcode || '';
    const tomadorEnderecoFinal =
      dto.tomadorEndereco ?? clientAddress?.street ?? '';

    // Buscar código IBGE do município do tomador via CEP
    let tomadorCmun = '';
    let tomadorMunicipio = dto.tomadorMunicipio || clientAddress?.city || '';
    let tomadorUf = dto.tomadorUf || clientAddress?.state || '';

    if (tomadorCepFinal) {
      this.logger.log(
        `Buscando código IBGE para CEP do tomador: ${tomadorCepFinal}`,
      );
      const cepData = await fetchCepData(tomadorCepFinal);
      if (cepData) {
        tomadorCmun = cepData.codigoIbge;
        if (!dto.tomadorMunicipio) tomadorMunicipio = cepData.cidade;
        if (!dto.tomadorUf) tomadorUf = cepData.uf;
        this.logger.log(
          `Código IBGE do tomador: ${tomadorCmun} (${tomadorMunicipio}/${tomadorUf})`,
        );
      } else {
        this.logger.warn(`CEP do tomador não encontrado: ${tomadorCepFinal}`);
      }
    } else {
      this.logger.warn('Tomador sem CEP cadastrado');
    }

    // Buscar código IBGE do local de prestação (entrega) se aplicável
    let entregaCmun = '';
    let entregaMunicipio = dto.entregaMunicipio || entregaAddress?.city || '';
    let entregaUf = dto.entregaUf || entregaAddress?.state || '';
    const entregaCep = dto.entregaCep || entregaAddress?.zipcode || '';
    const entregaEndereco = dto.entregaEndereco || entregaAddress?.street || '';
    const entregaNumero = dto.entregaNumero || entregaAddress?.number || '';
    const entregaComplemento =
      dto.entregaComplemento || entregaAddress?.complement || '';
    const entregaBairro =
      dto.entregaBairro || entregaAddress?.neighborhood || '';

    if (entregaEndereco) {
      if (entregaCep) {
        this.logger.log(
          `Buscando código IBGE para CEP de prestação: ${entregaCep}`,
        );
        const cepData = await fetchCepData(entregaCep);
        if (cepData) {
          entregaCmun = cepData.codigoIbge;
          entregaMunicipio = cepData.cidade;
          entregaUf = cepData.uf;
        }
      }

      if (
        !entregaCmun &&
        (dto.entregaCodigoMunicipio || (entregaAddress as any)?.ibgeCode)
      ) {
        entregaCmun =
          dto.entregaCodigoMunicipio || (entregaAddress as any)?.ibgeCode || '';
      }
    }

    // Construir DTO completo
    const fullDto: EmitNfseDto = {
      orderId: dto.orderId,
      quotationId: quotation.id,
      dataCompetencia: new Date().toISOString().split('T')[0],
      naturezaOperacao: 1, // Tributação no município
      codigoServico:
        dto.codigoServico ||
        (serviceItemOf(quotation.quotationProduct)?.product as any)?.fiscalData
          ?.codigoServico ||
        config.codigoServico ||
        '',
      discriminacao: dto.discriminacao,
      codigoMunicipio: prestadorCmun,
      valorServicos,
      aliquotaIss:
        dto.aliquotaIss ??
        (serviceItemOf(quotation.quotationProduct)?.product as any)?.fiscalData
          ?.aliquotaIss ??
        config.aliquotaIss ??
        0,
      issRetido: dto.issRetido || false,
      ...this.classificacaoFiscalDoServico(
        (serviceItemOf(quotation.quotationProduct)?.product as any)?.fiscalData,
      ),
      // Classificação escolhida na lista de serviços vence a do produto.
      ...(dto.nbs ? { nbs: dto.nbs } : {}),
      ...(dto.codTribNacional ? { codTribNacional: dto.codTribNacional } : {}),
      ...(dto.codTribMunicipio
        ? { codTribMunicipio: dto.codTribMunicipio }
        : {}),
      ...(dto.cstIbsCbs ? { cstIbsCbs: dto.cstIbsCbs } : {}),
      ...(dto.codClassificacao
        ? { codClassificacao: dto.codClassificacao }
        : {}),
      ...(dto.cnae ? { cnae: dto.cnae } : {}),
      // Campos adicionais da emissão (Reforma Tributária / retenções).
      ...(dto.cIndOp ? { cIndOp: dto.cIndOp } : {}),
      ...(dto.indFinal !== undefined ? { indFinal: dto.indFinal } : {}),
      ...(dto.indDest !== undefined ? { indDest: dto.indDest } : {}),
      ...(dto.tpEnteGov !== undefined ? { tpEnteGov: dto.tpEnteGov } : {}),
      ...(dto.xTpEnteGov ? { xTpEnteGov: dto.xTpEnteGov } : {}),
      // tpOper vale sozinho: e' 0-1 na raiz do RPS e cobre tambem "outros
      // servicos sobre bens imoveis" (layout v8, C42), sem ente governamental.
      ...(dto.tpOper !== undefined ? { tpOper: dto.tpOper } : {}),
      ...(dto.tribAproxFederal !== undefined
        ? { tribAproxFederal: dto.tribAproxFederal }
        : {}),
      ...(dto.tribAproxEstadual !== undefined
        ? { tribAproxEstadual: dto.tribAproxEstadual }
        : {}),
      ...(dto.tribAproxMunicipal !== undefined
        ? { tribAproxMunicipal: dto.tribAproxMunicipal }
        : {}),
      ...(dto.aliquotaInss !== undefined
        ? { aliquotaInss: dto.aliquotaInss }
        : {}),
      ...(dto.valorInss !== undefined ? { valorInss: dto.valorInss } : {}),
      tomador: {
        cnpj: dto.tomadorCnpjCpf
          ? dto.tomadorCnpjCpf.replace(/\D/g, '').length === 14
            ? dto.tomadorCnpjCpf.replace(/\D/g, '')
            : undefined
          : client.cnpj || undefined,
        cpf: dto.tomadorCnpjCpf
          ? dto.tomadorCnpjCpf.replace(/\D/g, '').length === 11
            ? dto.tomadorCnpjCpf.replace(/\D/g, '')
            : undefined
          : client.cpf || undefined,
        razaoSocial:
          dto.tomadorRazaoSocial || client.corporateName || client.name || '',
        endereco: tomadorEnderecoFinal,
        numero: dto.tomadorNumero ?? clientAddress?.number ?? 'S/N',
        complemento: dto.tomadorComplemento ?? clientAddress?.complement ?? '',
        bairro: dto.tomadorBairro ?? clientAddress?.neighborhood ?? '',
        cep: tomadorCepFinal,
        codigoMunicipio: tomadorCmun,
        municipio: tomadorMunicipio,
        uf: tomadorUf,
        email: dto.tomadorEmail ?? client.email ?? '',
        telefone: dto.tomadorTelefone ?? client.phone ?? client.mobile ?? '',
      },
      ...(entregaEndereco
        ? {
            entregaEndereco,
            entregaNumero: entregaNumero || 'S/N',
            entregaComplemento,
            entregaBairro,
            entregaCep,
            entregaMunicipio,
            entregaUf,
            entregaCodigoMunicipio: entregaCmun,
          }
        : {}),
    };

    // Validar dados obrigatórios
    if (!fullDto.tomador.razaoSocial) {
      throw new BadRequestException('Cliente não possui nome cadastrado');
    }
    if (!fullDto.codigoMunicipio) {
      throw new BadRequestException(
        'Código do município do prestador não configurado. Verifique a configuração fiscal do emissor.',
      );
    }
    if (!fullDto.tomador.codigoMunicipio) {
      throw new BadRequestException(
        'Código do município do tomador não encontrado. Verifique o CEP cadastrado para o cliente.',
      );
    }

    return fullDto;
  }

  async emitFromOrder(companyId: string, dto: EmitNfseFromOrderDto) {
    return this.emit(
      companyId,
      await this.buildNfseDtoFromOrder(companyId, dto),
    );
  }

  // Emitir NFS-e consolidada a partir de múltiplas ordens de serviço
  /** Como buildNfseDtoFromOrder, para a consolidada. */
  private async buildNfseDtoFromOrders(
    companyId: string,
    dto: EmitNfseFromOrdersDto,
  ): Promise<{
    fullDto: EmitNfseDto;
    uniqueOrderIds: string[];
    orderCodes: any;
  }> {
    const uniqueOrderIds = [...new Set(dto.orderIds.filter(Boolean))];

    if (uniqueOrderIds.length < 2) {
      throw new BadRequestException(
        'Selecione ao menos duas ordens para consolidar a NFS-e',
      );
    }

    // Buscar todas as cotações de uma vez
    const quotations = await this.prisma.quotation.findMany({
      where: {
        companyId,
        order: { id: { in: uniqueOrderIds } },
      },
      include: {
        client: { include: { address: true } },
        order: { include: this.orderFiscalInclude() },
        quotationProduct: {
          include: { product: { include: { fiscalData: true } } },
        },
      },
    });

    if (quotations.length !== uniqueOrderIds.length) {
      throw new NotFoundException(
        'Uma ou mais ordens de serviço não foram encontradas',
      );
    }

    await this.assertOrdersCanReceiveNfse(
      quotations.map((quotation) => quotation.order as any),
      companyId,
    );

    // Validar que todas as OS são do mesmo cliente
    const clientIds = [...new Set(quotations.map((q) => q.clientId))];
    if (clientIds.length > 1) {
      throw new BadRequestException(
        'Todas as ordens devem pertencer ao mesmo cliente para consolidar a NFS-e',
      );
    }

    // Buscar configuração do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    // Código IBGE do prestador
    let prestadorCmun = config.ibgeCode || '';
    const emitCep = config.company?.address?.zipcode;
    if (!prestadorCmun && emitCep) {
      const cepData = await fetchCepData(emitCep);
      if (cepData) {
        prestadorCmun = cepData.codigoIbge;
        await this.prisma.invoicyConfig.updateMany({
          where: { companyId },
          data: { emitCmun: prestadorCmun },
        });
      }
    }

    // Somar valorServicos — prefere itens com isService=true por quotation;
    // se nenhum estiver marcado como serviço em uma quotation, usa todos os itens dela (fallback)
    const valorServicos =
      quotations.reduce((total, q) => {
        const all = q.quotationProduct;
        const services = all.filter((qp) => (qp.product as any)?.isService);
        const toSum = services.length > 0 ? services : all;
        return (
          total +
          toSum.reduce(
            (acc, qp) => acc + (qp.finalValue || qp.totalValue || 0),
            0,
          )
        );
      }, 0) / 100;

    // A ordem do findMany e' a do banco, nao a da selecao: sem casar a
    // cotacao com uniqueOrderIds[0], o fullDto saia com o orderId de uma O.S.
    // e o quotationId de outra, e a propria emissao recusava o par ("A ordem
    // de servico informada nao pertence ao orcamento enviado"). Acontecia so'
    // com duas ou mais O.S., que e' justamente quando este caminho roda.
    const quotationPrincipal =
      quotations.find((q) => q.order?.id === uniqueOrderIds[0]) ??
      quotations[0];

    // Tomador: cliente da primeira ordem (ou overrides do DTO)
    const client = quotationPrincipal.client;
    const clientAddress = client?.address?.[0];

    const tomadorCepFinal = dto.tomadorCep || clientAddress?.zipcode || '';
    const tomadorEnderecoFinal =
      dto.tomadorEndereco ?? clientAddress?.street ?? '';

    let tomadorCmun = '';
    let tomadorMunicipio = dto.tomadorMunicipio || clientAddress?.city || '';
    let tomadorUf = dto.tomadorUf || clientAddress?.state || '';

    if (tomadorCepFinal) {
      const cepData = await fetchCepData(tomadorCepFinal);
      if (cepData) {
        tomadorCmun = cepData.codigoIbge;
        if (!dto.tomadorMunicipio) tomadorMunicipio = cepData.cidade;
        if (!dto.tomadorUf) tomadorUf = cepData.uf;
      } else {
        this.logger.warn(
          `CEP do tomador não encontrado na NFS-e consolidada: ${tomadorCepFinal}`,
        );
      }
    }

    // Local de entrega/prestação
    let entregaCmun = '';
    let entregaMunicipio = dto.entregaMunicipio || '';
    let entregaUf = dto.entregaUf || '';
    const entregaCep = dto.entregaCep || '';
    const entregaEndereco = dto.entregaEndereco || '';
    const entregaNumero = dto.entregaNumero || '';
    const entregaComplemento = dto.entregaComplemento || '';
    const entregaBairro = dto.entregaBairro || '';

    if (entregaEndereco && entregaCep) {
      const cepData = await fetchCepData(entregaCep);
      if (cepData) {
        entregaCmun = cepData.codigoIbge;
        if (!entregaMunicipio) entregaMunicipio = cepData.cidade;
        if (!entregaUf) entregaUf = cepData.uf;
      }
    }

    // Códigos das OS para anotação
    const orderCodes = quotations
      .map(
        (q) =>
          (q.order as any)?.orderCode ||
          (q.order as any)?.code ||
          q.order?.id?.slice(0, 8) ||
          '',
      )
      .filter(Boolean)
      .join(', ');

    const fullDto: EmitNfseDto = {
      orderId: quotationPrincipal.order?.id ?? uniqueOrderIds[0],
      quotationId: quotationPrincipal.id,
      dataCompetencia: new Date().toISOString().split('T')[0],
      naturezaOperacao: 1,
      codigoServico: dto.codigoServico || config.codigoServico || '',
      discriminacao: dto.discriminacao,
      codigoMunicipio: prestadorCmun,
      valorServicos,
      aliquotaIss: dto.aliquotaIss ?? config.aliquotaIss ?? 0,
      issRetido: dto.issRetido || false,
      // Mesma cotacao de referencia: pela ordem do banco, a classificacao
      // fiscal da nota mudava conforme a O.S. que viesse primeiro.
      ...this.classificacaoFiscalDoServico(
        (serviceItemOf(quotationPrincipal?.quotationProduct)?.product as any)
          ?.fiscalData,
      ),
      // Classificação escolhida na lista de serviços vence a do produto.
      ...(dto.nbs ? { nbs: dto.nbs } : {}),
      ...(dto.codTribNacional ? { codTribNacional: dto.codTribNacional } : {}),
      ...(dto.codTribMunicipio
        ? { codTribMunicipio: dto.codTribMunicipio }
        : {}),
      ...(dto.cstIbsCbs ? { cstIbsCbs: dto.cstIbsCbs } : {}),
      ...(dto.codClassificacao
        ? { codClassificacao: dto.codClassificacao }
        : {}),
      ...(dto.cnae ? { cnae: dto.cnae } : {}),
      // Campos adicionais da emissão (Reforma Tributária / retenções).
      ...(dto.cIndOp ? { cIndOp: dto.cIndOp } : {}),
      ...(dto.indFinal !== undefined ? { indFinal: dto.indFinal } : {}),
      ...(dto.indDest !== undefined ? { indDest: dto.indDest } : {}),
      ...(dto.tpEnteGov !== undefined ? { tpEnteGov: dto.tpEnteGov } : {}),
      ...(dto.xTpEnteGov ? { xTpEnteGov: dto.xTpEnteGov } : {}),
      // tpOper vale sozinho: e' 0-1 na raiz do RPS e cobre tambem "outros
      // servicos sobre bens imoveis" (layout v8, C42), sem ente governamental.
      ...(dto.tpOper !== undefined ? { tpOper: dto.tpOper } : {}),
      ...(dto.tribAproxFederal !== undefined
        ? { tribAproxFederal: dto.tribAproxFederal }
        : {}),
      ...(dto.tribAproxEstadual !== undefined
        ? { tribAproxEstadual: dto.tribAproxEstadual }
        : {}),
      ...(dto.tribAproxMunicipal !== undefined
        ? { tribAproxMunicipal: dto.tribAproxMunicipal }
        : {}),
      ...(dto.aliquotaInss !== undefined
        ? { aliquotaInss: dto.aliquotaInss }
        : {}),
      ...(dto.valorInss !== undefined ? { valorInss: dto.valorInss } : {}),
      tomador: {
        cnpj: dto.tomadorCnpjCpf
          ? dto.tomadorCnpjCpf.replace(/\D/g, '').length === 14
            ? dto.tomadorCnpjCpf.replace(/\D/g, '')
            : undefined
          : client?.cnpj || undefined,
        cpf: dto.tomadorCnpjCpf
          ? dto.tomadorCnpjCpf.replace(/\D/g, '').length === 11
            ? dto.tomadorCnpjCpf.replace(/\D/g, '')
            : undefined
          : client?.cpf || undefined,
        razaoSocial:
          dto.tomadorRazaoSocial ||
          (client as any)?.corporateName ||
          client?.name ||
          '',
        endereco: tomadorEnderecoFinal,
        numero: dto.tomadorNumero ?? clientAddress?.number ?? 'S/N',
        complemento: dto.tomadorComplemento ?? clientAddress?.complement ?? '',
        bairro: dto.tomadorBairro ?? clientAddress?.neighborhood ?? '',
        cep: tomadorCepFinal,
        codigoMunicipio: tomadorCmun,
        municipio: tomadorMunicipio,
        uf: tomadorUf,
        email: dto.tomadorEmail ?? client?.email ?? '',
        telefone:
          dto.tomadorTelefone ??
          (client as any)?.phone ??
          (client as any)?.mobile ??
          '',
      },
      ...(entregaEndereco
        ? {
            entregaEndereco,
            entregaNumero: entregaNumero || 'S/N',
            entregaComplemento,
            entregaBairro,
            entregaCep,
            entregaMunicipio,
            entregaUf,
            entregaCodigoMunicipio: entregaCmun,
          }
        : {}),
    };

    if (!fullDto.tomador.razaoSocial) {
      throw new BadRequestException('Cliente não possui nome cadastrado');
    }
    if (!fullDto.codigoMunicipio) {
      throw new BadRequestException(
        'Código do município do prestador não configurado. Verifique a configuração fiscal do emissor.',
      );
    }
    if (!fullDto.tomador.codigoMunicipio) {
      throw new BadRequestException(
        'Código do município do tomador não encontrado. Verifique o CEP cadastrado para o cliente.',
      );
    }

    return { fullDto, uniqueOrderIds, orderCodes };
  }

  async emitFromOrders(companyId: string, dto: EmitNfseFromOrdersDto) {
    const { fullDto, uniqueOrderIds, orderCodes } =
      await this.buildNfseDtoFromOrders(companyId, dto);

    const nfse = await this.emit(companyId, fullDto);

    // Guardar todos os orderIds no draftData para referência
    if (nfse?.id) {
      await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          draftData: {
            consolidatedOrderIds: uniqueOrderIds,
            orderCodes,
          } as any,
        },
      });
    }

    return nfse;
  }

  /**
   * Leituras e validações que precedem qualquer efeito da emissão.
   *
   * Extraído de `emit` para a pré-visualização rodar as mesmas checagens sem
   * reservar RPS nem criar registro. Resolve pelo CEP o município do local
   * de prestação e o do tomador, preenchendo o próprio DTO como antes.
   */
  private async resolveNfseEmissionContext(
    companyId: string,
    dto: EmitNfseDto,
  ) {
    // O orçamento do corpo precisa ser da empresa também quando vem sem a
    // ordem (com a ordem, a conferência está logo abaixo)
    await assertBelongsToCompany(
      this.prisma.quotation,
      dto.quotationId,
      { companyId },
      'Orçamento não encontrado.',
    );

    if (dto.orderId) {
      const linkedOrder = await this.prisma.order.findFirst({
        where: {
          id: dto.orderId,
          quotation: { companyId },
        },
        include: this.orderFiscalInclude(),
      });

      if (!linkedOrder) {
        throw new NotFoundException('Ordem de serviço não encontrada');
      }

      await this.assertOrdersCanReceiveNfse([linkedOrder as any], companyId);

      if (dto.quotationId && linkedOrder.quotationId !== dto.quotationId) {
        throw new BadRequestException(
          'A ordem de serviço informada não pertence ao orçamento enviado.',
        );
      }
    }

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
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
        config,
        'NFSE',
      );
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFSE',
    );

    // Se houver endereço de entrega (local de prestação) e não houver código de município, resolver via CEP
    if (dto.entregaEndereco && !dto.entregaCodigoMunicipio) {
      if (!dto.entregaCep) {
        throw new BadRequestException(
          'CEP de entrega é obrigatório quando o endereço de entrega (local de prestação) é informado.',
        );
      }
      this.logger.log(
        `Buscando código IBGE do local de prestação/entrega via CEP: ${dto.entregaCep}`,
      );
      const cepData = await fetchCepData(dto.entregaCep);
      if (!cepData || !cepData.codigoIbge) {
        throw new BadRequestException(
          `Não foi possível localizar o código IBGE para o CEP de entrega/prestação informado: ${dto.entregaCep}. Verifique o CEP ou digite o código do município manualmente.`,
        );
      }
      dto.entregaCodigoMunicipio = cepData.codigoIbge;
      if (!dto.entregaMunicipio) dto.entregaMunicipio = cepData.cidade;
      if (!dto.entregaUf) dto.entregaUf = cepData.uf;
      this.logger.log(
        `IBGE do local de prestação resolvido: ${dto.entregaCodigoMunicipio}`,
      );
    }

    // Resolver município do tomador via CEP quando codigoMunicipio não informado
    if (!dto.tomador.codigoMunicipio && dto.tomador.cep) {
      const cepClean = dto.tomador.cep.replace(/\D/g, '');
      if (cepClean.length === 8) {
        const cepData = await fetchCepData(cepClean);
        if (cepData) {
          dto.tomador.codigoMunicipio = cepData.codigoIbge;
          if (!dto.tomador.municipio) dto.tomador.municipio = cepData.cidade;
          if (!dto.tomador.uf) dto.tomador.uf = cepData.uf;
        }
      }
    }

    return { config, environment };
  }

  /**
   * Valores da NFS-e e os indicadores que dependem do regime do emissor.
   *
   * Puro: nada aqui toca o banco. É o que permite à pré-visualização mostrar
   * base, alíquota, ISS e IBS/CBS exatamente como sairão na nota.
   */
  private computeNfseValores(dto: EmitNfseDto, config: any) {
    // Calcular valores. Tudo arredondado na origem para que banco e payload
    // compartilhem exatamente o mesmo número.
    const valorServicos = this.money(dto.valorServicos);
    const valorDeducoes = this.money(dto.valorDeducoes || 0);
    const baseCalculo = this.money(valorServicos - valorDeducoes);

    // `??` e não `||`: alíquota 0 é legítima (serviço isento/imune) e não pode
    // cair no fallback. Se nada estiver configurado, falha fechada em vez de
    // emitir ISS zerado silenciosamente.
    const aliquotaIssRaw = dto.aliquotaIss ?? config.aliquotaIss;
    if (aliquotaIssRaw === null || aliquotaIssRaw === undefined) {
      throw new BadRequestException(
        'Alíquota de ISS não resolvida. Informe a alíquota na emissão ou ' +
          'configure a alíquota padrão em Configurações > Emissores.',
      );
    }
    const aliquotaIss = this.rate(aliquotaIssRaw);
    const valorIss = this.money((baseCalculo * aliquotaIss) / 100);

    /**
     * Regime Especial de Tributação (enumeração ABRASF). Fora do Simples não há
     * regime especial a declarar: o padrão anterior mandava 1 = "Microempresa
     * Municipal" para qualquer não-optante, o que é uma declaração falsa para
     * uma empresa de Lucro Presumido ou Real. Sem configuração explícita a tag
     * passa a ser omitida — que é a semântica documentada do campo, já usada
     * pelos municípios que recusam a tag.
     */
    const regimeEspecial =
      config.regimeEspecialTributacao ??
      regimeEspecialPadraoNfse(config.emitCrt);

    /**
     * Grupo de VALORES do IBS/CBS. Desligado por padrão: no layout do provedor
     * ele é opcional (ocorrência 0-1) e o retorno da recepção de RPS não
     * devolve esses valores, então enviá-los é decisão de quem emite. Como a
     * exigência varia por município, liga-se emissor a emissor.
     *
     * Quando enviado, os subgrupos IBS e CBS são obrigatórios e, dentro deles,
     * os percentuais de diferimento — zero quando não há diferimento.
     *
     * A base sai de ValBaseCalculo menos o ISS, que é o comportamento
     * observado nas DANFSe emitidas sob o novo layout. Continua sobrescrevível
     * na emissão para o município que adotar composição diferente.
     */
    /**
     * Regime de apuração do IBS/CBS do optante do Simples (`regApIBSCBSSN`).
     * Fora do Simples é sempre o regular. Sem configuração, o optante fica no
     * 1 (ambos pelo SN), que é o comportamento anterior.
     */
    /**
     * cIndOp: o da emissao vence o padrao do emissor. O campo e obrigatorio no
     * layout da Reforma e nao muda de nota para nota na maioria dos emissores,
     * por isso o padrao existe — mas quem emite pode sobrepor numa operacao
     * especifica sem mexer na configuracao.
     */
    const indicadorOperacao =
      dto.cIndOp || (config as any).indicadorOperacaoNfse || undefined;

    /**
     * Quem a nota declara como optante do Simples, e que decide se o grupo
     * regApIBSCBSSN acompanha o RPS. Precisa acompanhar o OptSN mais abaixo:
     * declarar "nao optante" e mandar o grupo do Simples junto e' payload
     * contraditorio. Por isso o CRT nulo continua fora, como antes — para ele
     * quem resolve e' o reenvio do E0166.
     */
    const optanteSimples =
      config.emitCrt === 1 || config.emitCrt === 2 || isMei(config.emitCrt);
    const regimeApuracaoIbsCbs = optanteSimples
      ? ((config as any).regApIbsCbsSn ?? 1)
      : 3;
    const ibsPeloSimples = regimeApuracaoIbsCbs === 1;
    const cbsPeloSimples =
      regimeApuracaoIbsCbs === 1 || regimeApuracaoIbsCbs === 2;

    const valoresIbsCbs = (() => {
      if (!(config as any).ibsCbsEnviarValores) return {};

      const padrao = aliquotasVigentes();
      // Seguir com as alíquotas de teste de 2026 numa fase de alíquotas
      // cheias subdeclararia a nota em duas ordens de grandeza.
      if (!padrao.faseCoberta) {
        throw new BadRequestException(
          'As alíquotas de IBS/CBS da fase vigente ainda não estão ' +
            'confirmadas no sistema. Atualize as alíquotas do emissor antes ' +
            'de enviar os valores de IBS/CBS.',
        );
      }

      const aliquotas = {
        ibsUf: (config as any).aliquotaIbsUf ?? padrao.aliquotas.ibsUf,
        ibsMun: (config as any).aliquotaIbsMun ?? padrao.aliquotas.ibsMun,
        cbs: (config as any).aliquotaCbs ?? padrao.aliquotas.cbs,
      };

      const base = this.money(
        dto.baseIbsCbs ?? Math.max(0, baseCalculo - valorIss),
      );
      const calc = calcularIbsCbs(base, aliquotas);

      // Os campos próprios do Simples (ValIBSSN/ValCBSSN) não podem se
      // misturar com os do regime regular. Quem decide, POR TRIBUTO, é o
      // regime de apuração: no regime 2 a CBS sai pelo Simples e o IBS pelo
      // regular, então um booleano único produziria a combinação errada.
      return {
        IBSCBS: {
          IBS: {
            ValpDifUF: 0,
            ValpDifMun: 0,
            ...(ibsPeloSimples
              ? {
                  ValpIBSSN: aliquotas.ibsUf + aliquotas.ibsMun,
                  ValIBSSN: calc.ibsTotal,
                }
              : {
                  ValIBSTot: calc.ibsTotal,
                  ValIBSUF: calc.ibsUf,
                  ValpIBSUF: aliquotas.ibsUf,
                  ValIBSMun: calc.ibsMun,
                  ValpIBSMun: aliquotas.ibsMun,
                }),
          },
          CBS: {
            ValpDifCBS: 0,
            ...(cbsPeloSimples
              ? { ValpCBSSN: aliquotas.cbs, ValCBSSN: calc.cbs }
              : { ValCBS: calc.cbs, ValpCBS: aliquotas.cbs }),
          },
          ValBCIBSCBS: calc.base,
        },
      };
    })();

    // E0625: prestador ME/EPP optante do Simples (opSimpNac=3) não pode
    // informar alíquota quando não há retenção (tpRetISSQN=1) — o ISS é
    // recolhido pelo DAS, não pela alíquota municipal. Só volta a ser
    // declarável quando o tomador retém.
    //
    // O MEI segue a mesma omissão: o ISS dele é valor fixo no DAS, então
    // informar alíquota municipal é igualmente indevido. A rejeição E0625 é
    // escrita para opSimpNac=3 (ME/EPP), então aqui a regra vale por coerência
    // fiscal, não por recusa conhecida do provedor.
    const omitirAliquotaIss =
      (config.emitCrt === 1 || isMei(config.emitCrt)) && !dto.issRetido;

    this.assertNfsePayloadReady(dto, valorServicos, valorDeducoes, baseCalculo);

    return {
      valorServicos,
      valorDeducoes,
      baseCalculo,
      aliquotaIss,
      valorIss,
      regimeEspecial,
      indicadorOperacao,
      optanteSimples,
      regimeApuracaoIbsCbs,
      valoresIbsCbs,
      omitirAliquotaIss,
    };
  }

  async emit(companyId: string, dto: EmitNfseDto) {
    const { config, environment } = await this.resolveNfseEmissionContext(
      companyId,
      dto,
    );
    const valores = this.computeNfseValores(dto, config);
    const { valorServicos, valorDeducoes, baseCalculo, aliquotaIss, valorIss } =
      valores;

    const { nfse, rpsNumero, rpsSerie } = await this.prisma.$transaction(
      async (tx) => {
        // Reserva por (emissor, ambiente): antes era global, então emitir em
        // homologação consumia número da sequência de produção.
        const { reservedNumber, series } =
          await this.fiscalCredentialResolver.reserveNfseRpsNumber(
            tx,
            config.id,
            environment,
          );
        const reserved = { rpsNumero: reservedNumber, rpsSerie: series };

        const nfse = await tx.nfse.create({
          data: {
            companyId,
            invoicyConfigId: config.id,
            orderId: dto.orderId,
            quotationId: dto.quotationId,
            numero: 0, // Será preenchido após retorno da prefeitura
            serie: reserved.rpsSerie,
            rpsNumero: reserved.rpsNumero,
            rpsSerie: reserved.rpsSerie,
            rpsTipo: 1,
            status: NfseStatus.PROCESSING,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            dataCompetencia: new Date(dto.dataCompetencia || new Date()),
            valorServicos,
            valorDeducoes,
            valorPis: dto.valorPis || 0,
            valorCofins: dto.valorCofins || 0,
            valorInss: dto.valorInss || 0,
            valorIr: dto.valorIr || 0,
            valorCsll: dto.valorCsll || 0,
            valorIss,
            aliquotaIss,
            baseCalculo,
            issRetido: dto.issRetido || false,
            codigoServico: dto.codigoServico,
            discriminacao: dto.discriminacao,
            codigoMunicipio: dto.codigoMunicipio,
            draftData: dto as any,
          },
        });

        return { nfse, ...reserved };
      },
    );

    try {
      this.logger.log(
        `Emitindo NFS-e (RPS ${rpsNumero}) para empresa ${companyId}`,
      );

      const invoicyRequest = this.buildNfseRps(
        dto,
        config,
        environment,
        valores,
        { numero: rpsNumero, serie: rpsSerie },
      );

      this.logger.debug(
        `[NFS-e] Payload enviado ao Invoicy: ${JSON.stringify(
          invoicyRequest.Documento.RPS?.[0],
          (key, val) =>
            key === 'CNPJ_prest' || key === 'TomaCNPJ' || key === 'TomaCPF'
              ? '***'
              : val,
        )}`,
      );

      // Persistir o payload ANTES de transmitir, para que o snapshot exista
      // mesmo se a chamada falhar. Os retries abaixo mutam `invoicyRequest`,
      // então o snapshot é reescrito ao final com o que de fato foi aceito.
      await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: { invoicyPayloadEnvio: invoicyRequest as any },
      });

      let response = await this.sendNfseToInvoicy(
        companyId,
        invoicyRequest,
        config.id,
        environment,
      );

      this.logger.debug(
        `[NFS-e] Resposta Invoicy: ${JSON.stringify(response)}`,
      );

      if (this.shouldRetryNfseWithoutPrestadorIm(response)) {
        // Remove IM do request (no-op se não estava presente) e retenta sempre,
        // pois o Invoicy pode incluir IM a partir dos dados cadastrados na plataforma
        // mesmo que não enviemos no payload — causando E0120 em municípios que não aceitam IM.
        this.removePrestadorMunicipalRegistration(invoicyRequest);
        this.logger.warn(
          `Prefeitura rejeitou a NFS-e ${nfse.id} com E0120 (IM inválida). Reenviando RPS ${rpsNumero}/${rpsSerie} sem Prestador.IM.`,
        );
        response = await this.sendNfseToInvoicy(
          companyId,
          invoicyRequest,
          config.id,
          environment,
        );
      }

      // O reenvio declara apuracao pelo Simples: so' faz sentido para quem e'
      // optante. Fora disso a rejeicao sobe para o usuario.
      if (
        this.shouldRetryNfseWithRegApuracao(response) &&
        this.addRegApuracaoToNfseRequest(invoicyRequest, config)
      ) {
        this.logger.warn(
          `Prefeitura rejeitou a NFS-e ${nfse.id} com E0166 (RegApuracao ausente). Reenviando RPS ${rpsNumero}/${rpsSerie} com RegApuracao=1.`,
        );
        response = await this.sendNfseToInvoicy(
          companyId,
          invoicyRequest,
          config.id,
          environment,
        );
      }

      // Reescreve o snapshot com o payload final — os retries acima mutam o
      // objeto, e o que interessa rastrear é o que a prefeitura recebeu.
      await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: { invoicyPayloadEnvio: invoicyRequest as any },
      });

      // Código de lote diferente de 100 é o provedor respondendo que recusou
      // o documento antes de enviá-lo à prefeitura — resultado conhecido, não
      // falha de comunicação. Como Error puro, o catch não achava
      // `error.response` e classificava como transporte: a NFS-e ia para
      // PROCESSING e a tela dizia "Falha de comunicação com o Invoicy",
      // escondendo mensagens acionáveis como "[#inv0357] a série deve conter
      // apenas números". BadRequestException marca REJECTED com o motivo real.
      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new BadRequestException(
          response.Descricao ||
            `Recusada pelo provedor (código ${response.Codigo})`,
        );
      }

      const doc = response.Documentos?.[0];
      if (!doc) {
        throw new Error('Documento não retornado pelo Invoicy');
      }

      const situacao = doc.Situacao;
      const isAuthorized = situacao?.SitCodigo === 100; // 100 = Autorizada

      // Atualizar NFS-e com resposta
      const updatedNfse = await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          status: isAuthorized ? NfseStatus.AUTHORIZED : NfseStatus.REJECTED,
          numero: doc.NFSe?.NFSeNumero || 0,
          codigoVerificacao: doc.NFSe?.NFSeCodVerificacao || null,
          protocolo: doc.DocProtocolo || null,
          invoicyId: doc.DocIDUnico || null,
          invoicyProtocol: doc.DocProtocolo || null,
          dataEmissao: new Date(),
          pdfUrl: doc.DocPDFDownload || null,
          xmlRetorno: doc.DocXMLBase64,
          motivoRejeicao: !isAuthorized ? situacao?.SitDescricao : null,
          invoicyRetornoBruto: this.retornoBrutoParaPersistir(response),
        },
      });

      if (!isAuthorized) {
        throw new BadRequestException(
          `NFS-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}`,
        );
      }

      // Envio automático de email (fire-and-forget)
      this.sendNfseEmailAutomatic(
        updatedNfse,
        config,
        dto.tomador?.email,
        dto.tomador?.razaoSocial,
      ).catch((err) =>
        this.logger.warn(
          `Envio automático de e-mail NFS-e ${updatedNfse.id} falhou: ${err.message}`,
        ),
      );

      return updatedNfse;
    } catch (error) {
      // Erros de programação (RangeError, TypeError...) nunca são falha de
      // transporte. Sem essa exclusão eles viravam "resultado desconhecido" e
      // deixavam a NFS-e em PROCESSING, escondendo a causa real.
      const isProgrammingError =
        error instanceof TypeError ||
        error instanceof RangeError ||
        error instanceof ReferenceError ||
        error instanceof SyntaxError;

      const isUnknownOutcome =
        !(error instanceof BadRequestException) &&
        !isProgrammingError &&
        (error?.code === 'ECONNABORTED' ||
          error?.code === 'ECONNRESET' ||
          error?.code === 'ETIMEDOUT' ||
          error?.response === undefined ||
          error?.response?.status >= 500);
      const motivoRejeicao = isUnknownOutcome
        ? 'Erro de transporte - resultado desconhecido'
        : this.extractSafeErrorMessage(error);

      await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          status: isUnknownOutcome
            ? NfseStatus.PROCESSING
            : NfseStatus.REJECTED,
          motivoRejeicao,
        },
      });

      this.logger.error(`Erro ao emitir NFS-e: ${motivoRejeicao}`, error.stack);

      if (isUnknownOutcome) {
        throw new BadRequestException(
          'Falha de comunicação com o Invoicy. A NFS-e ficou em processamento com resultado desconhecido; consulte o status antes de reemitir.',
        );
      }

      throw new BadRequestException(`Erro ao emitir NFS-e: ${motivoRejeicao}`);
    }
  }

  /**
   * Monta o RPS que será enviado ao provedor.
   *
   * Não toca o banco: é esta função que a pré-visualização executa, e por
   * isso a prévia mostra o mesmo documento que será transmitido. Os retries
   * de E0120 e E0166 acontecem DEPOIS da resposta da prefeitura e mutam o
   * payload; a prévia mostra a primeira tentativa e avisa sobre eles.
   */
  private buildNfseRps(
    dto: EmitNfseDto,
    config: any,
    environment: string,
    valores: ReturnType<NfseService['computeNfseValores']>,
    rps: { numero: number; serie: string },
  ): InvoicyNfseRequest {
    const {
      baseCalculo,
      aliquotaIss,
      valorIss,
      valorServicos,
      valorDeducoes,
      regimeEspecial,
      indicadorOperacao,
      optanteSimples,
      regimeApuracaoIbsCbs,
      valoresIbsCbs,
      omitirAliquotaIss,
    } = valores;
    const rpsNumero = rps.numero;
    const rpsSerie = rps.serie;

    // Código de tributação no município (cTribMun, "001"...) — campo texto
    // no layout do InvoiCy, tanto no serviço quanto no item. Ia como número:
    // parseInt("001") virava 1 e o item levava o IBGE da cidade (a incidência
    // é ItemcMunIncidencia). O DPS nacional exige exatamente 3 dígitos, então
    // o InvoiCy descartava os dois e o Rio recusava 130501 sem o 001 (E0312).
    // Sem código cadastrado mantém o valor histórico — trocá-lo às cegas
    // mudaria notas que hoje são autorizadas.
    // O grupo IBSCBS da DPS precisa sair inteiro ou não sair: CST e
    // cClassTrib formam os <valores>, e sem eles o provedor monta o grupo só
    // com o cabeçalho (cIndOp e afins) e a prefeitura rejeita com E1235.
    const grupoIbsCbsCompleto = Boolean(dto.cstIbsCbs && dto.codClassificacao);

    const codTribNacionalDigitos = dto.codTribNacional?.replace(/\D/g, '');

    const tributMunicipio: string | number =
      dto.codTribMunicipio?.trim() ||
      parseInt(dto.codigoMunicipio || config.ibgeCode || '0', 10);

    // Função auxiliar para construir lista de itens
    const listaItens = dto.itens?.map((item, index) => {
      // Base arredondada uma vez e reaproveitada, para que ItemvIss fique
      // aritmeticamente consistente com ItemBaseCalculo.
      const itemBase = this.money(item.quantidade * item.valorUnitario);
      // `??` e não `||`: alíquota 0 é legítima (serviço isento/imune).
      const itemAliquota = this.rate(item.aliquotaIss ?? aliquotaIss);

      return {
        ItemSeq: index + 1,
        ItemCod: item.codigo,
        ItemDesc: item.descricao,
        ItemQtde: item.quantidade,
        ItemvUnit: this.money(item.valorUnitario),
        ItemuMed: item.unidade || 'UN',
        ItemvlDed: 0,
        ItemTributavel: 'S',
        ItemTributMunicipio: tributMunicipio,
        ItemvIss: this.money((itemBase * itemAliquota) / 100),
        ...(omitirAliquotaIss ? {} : { ItemAliquota: itemAliquota }),
        ItemVlrTotal: itemBase,
        ItemBaseCalculo: itemBase,
        ItemIssRetido: item.issRetido ? 1 : 2,
        // Código da lista de serviços LC 116 do item; cai para o do emissor.
        ItemIteListServico: parseInt(
          (item.codigoServico || config.codigoServico || '').replace(
            /\D/g,
            '',
          ) || '0',
          10,
        ),
        ItemExigibilidadeISS: 1, // Exigível
        ItemcMunIncidencia: parseInt(
          dto.codigoMunicipio || config.ibgeCode || '0',
          10,
        ),
        // NBS do item; sem cadastro próprio herda o do serviço.
        ...(item.nbs || dto.nbs ? { ItemNBS: item.nbs || dto.nbs } : {}),
      };
    }) || [
      {
        ItemSeq: 1,
        ItemCod: 'SERV',
        ItemDesc: dto.discriminacao.substring(0, 100), // Invoicy pode ter limite
        ItemQtde: 1,
        ItemvUnit: valorServicos,
        ItemuMed: 'SV',
        ItemvlDed: valorDeducoes,
        ItemTributavel: 'S',
        ItemTributMunicipio: tributMunicipio,
        ItemvIss: valorIss,
        ...(omitirAliquotaIss ? {} : { ItemAliquota: aliquotaIss }),
        ItemVlrTotal: valorServicos,
        ItemBaseCalculo: baseCalculo,
        ItemIssRetido: dto.issRetido ? 1 : 2,
        ItemIteListServico: parseInt(dto.codigoServico.replace(/\D/g, ''), 10),
        ItemExigibilidadeISS: 1,
        ItemcMunIncidencia: parseInt(
          dto.codigoMunicipio || config.ibgeCode || '0',
          10,
        ),
        ...(dto.nbs ? { ItemNBS: dto.nbs } : {}),
      },
    ];

    const prestadorMunicipalRegistration =
      this.getPrestadorMunicipalRegistration(config);

    // Construir payload para o Invoicy
    const invoicyRequest: InvoicyNfseRequest = {
      Documento: {
        ModeloDocumento: 'NFSE',
        Versao: 1,
        RPS: [
          {
            RPSNumero: rpsNumero.toString(),
            RPSSerie: rpsSerie,
            RPSTipo: 1, // 1 = RPS
            dEmis: new Date().toISOString(),
            // dataCompetencia é opcional no DTO (a emissão avulsa não envia);
            // usa a data atual como padrão, igual ao registro no banco.
            dCompetencia: new Date(
              dto.dataCompetencia || new Date(),
            ).toISOString(),
            LocalPrestServ:
              dto.entregaCodigoMunicipio &&
              dto.entregaCodigoMunicipio !==
                (config.ibgeCode || config.emitCmun)
                ? 2
                : 1,
            natOp: dto.naturezaOperacao || 1, // 1 = Tributação no município
            Operacao: 1,
            // RegEspTrib segue a enumeração ABRASF do Invoicy (5 = MEI,
            // 6 = ME/EPP), que ele converte para o regEspTrib do layout
            // nacional. Alguns municípios exigem um regime específico e outros
            // recusam a tag, então o emissor pode configurar; o padrão cobre o
            // caso comum.
            // Mandar 0 ("nenhum") em vez de omitir foi testado em 13/10/2026
            // para ver se tirava o <finNFSe> que o provedor escreve fora de
            // lugar no DPS do emissor fora do Simples (E1235): nao tirou
            // (Fenix, RPS 103). Omitir volta a ser o certo — e' a semantica
            // documentada do campo e ha' municipio que recusa a tag.
            ...(regimeEspecial !== undefined
              ? { RegEspTrib: regimeEspecial }
              : {}),
            // OptSN: 1 = optante do Simples Nacional, 2 = não optante. O MEI
            // é optante — o Ambiente Nacional ainda confere a condição na base
            // do Simples Nacional na data de competência, mas mandar 2 numa
            // nota de MEI contradiz esse cadastro. O CRT 2 (excesso de
            // sublimite) continua saindo como 2, como antes.
            OptSN: config.emitCrt === 1 || isMei(config.emitCrt) ? 1 : 2,
            // regApTribSN: campo de ME/EPP optante que ultrapassa o sublimite.
            // 1 = tributos federais e municipais apurados pelo SN. Não vale
            // para o MEI, que não tem sublimite a ultrapassar.
            ...(config.emitCrt === 1 ? { regApTribSN: 1 } : {}),
            // regApIBSCBSSN: 1 = IBS e CBS apurados pelo SN, 2 = CBS pelo SN e
            // IBS regular, 3 = ambos pelo regime regular. So' para optante.
            //
            // Mandar tambem fora do Simples (valor 3) foi testado em
            // 20/10/2026 na Fenix (RPS 106 e 107) e piorou: o provedor escreveu
            // <regApIBSCBSSN> dentro de <regTrib> e o Ambiente Nacional recusou
            // com E1235 — "invalid child element regApIBSCBSSN; expected
            // regApTribSN, regEspTrib". O campo e' da Reforma (NT 009) e nao
            // existe no schema 1.01 que o ADN valida hoje. A frase ambigua do
            // layout v8 ("Informar quando opSimpNac (OptSN) = 2, 3 ou 4") vale
            // pelo dominio nacional: 2, 3 e 4 sao os optantes.
            ...(optanteSimples ? { regApIBSCBSSN: regimeApuracaoIbsCbs } : {}),
            // Campos da Reforma Tributária (Layout NFS-e RT v8). Omitidos
            // quando não informados — a nota continua saindo como antes.
            // Todos moram no grupo <IBSCBS> da DPS, que só é válido com
            // <valores> dentro. Sem CST e cClassTrib no serviço, mandar só
            // estes gera <IBSCBS> sem valores e a prefeitura rejeita o
            // esquema (E1235) — por isso o grupo é tudo ou nada.
            ...(grupoIbsCbsCompleto
              ? {
                  ...(indicadorOperacao ? { cIndOp: indicadorOperacao } : {}),
                  ...(dto.indFinal !== undefined
                    ? { indFinal: dto.indFinal }
                    : {}),
                  ...(dto.indDest !== undefined
                    ? { indDest: dto.indDest }
                    : {}),
                  ...(dto.tpEnteGov !== undefined
                    ? { tpEnteGov: dto.tpEnteGov }
                    : {}),
                  ...(dto.tpEnteGov === 9 && dto.xTpEnteGov
                    ? { xTpEnteGov: dto.xTpEnteGov }
                    : {}),
                  // tpOper ("Operação com Entes Governamentais" no InvoiCy
                  // Web) e' 0-1 e cobre tambem "outros servicos sobre bens
                  // imoveis" (layout v8, C42). O gate antigo (so' com
                  // tpEnteGov) tornava impossivel o caso sem ente
                  // governamental.
                  ...(dto.tpOper !== undefined ? { tpOper: dto.tpOper } : {}),
                }
              : {}),
            IncCult: 2, // 2 = Não
            Status: 1, // 1 = Normal
            tpAmb: environment === 'PRODUCAO' ? 1 : 2,
            // finNFSe e' 1-1 no layout da Reforma (v8, C36) e vem logo depois
            // de tpAmb na sequencia do XSD. Nunca mandavamos: o provedor
            // preenchia 0 sozinho e, no emissor fora do Simples, escrevia a
            // tag entre tpEmit e cLocEmi do DPS, posicao que o Ambiente
            // Nacional recusa (E1235). 0 = NFS-e regular; credito (1) e
            // debito (2) sao outros fluxos, que o sistema nao emite.
            finNFSe: 0,
            Prestador: {
              CNPJ_prest: (config.company.cnpj || '').replace(/\D/g, ''),
              xNome: config.company.legalName || '',
              xFant: config.company.name || '',
              ...(prestadorMunicipalRegistration
                ? { IM: prestadorMunicipalRegistration }
                : {}),
              enderPrest: {
                TPEnd: 'Rua', // Default
                xLgr: config.company.address.street || '',
                nro: config.company.address.number || 'S/N',
                xBairro: config.company.address.neighborhood || '',
                cMun: parseInt(config.ibgeCode || '0', 10),
                UF: config.company.address.state || '',
                CEP:
                  parseInt(
                    (config.company.address.zipcode || '').replace(/\D/g, ''),
                    10,
                  ) || 0,
              },
            },
            ListaItens: listaItens,
            Servico: {
              Valores: {
                ValServicos: valorServicos,
                ValDeducoes: valorDeducoes,
                ValPIS: this.money(dto.valorPis || 0),
                ValCOFINS: this.money(dto.valorCofins || 0),
                ValINSS: this.money(dto.valorInss || 0),
                ValIR: this.money(dto.valorIr || 0),
                ValCSLL: this.money(dto.valorCsll || 0),
                ISSRetido: dto.issRetido ? 1 : 2, // 1 = Sim, 2 = Não
                ValISS: valorIss,
                ValOutrasRetencoes: 0,
                ValBaseCalculo: baseCalculo,
                ...valoresIbsCbs,
                ...(omitirAliquotaIss ? {} : { ValAliqISS: aliquotaIss }),
                // Tributos aproximados por esfera (NFS-e Modelo Nacional) e
                // INSS. ValAliqINSS vai em decimal: 0,05 = 5% (layout RT v8).
                ...(dto.tribAproxFederal !== undefined
                  ? { ValRetFederais: this.money(dto.tribAproxFederal) }
                  : {}),
                ...(dto.tribAproxEstadual !== undefined
                  ? { ValRetEstaduais: this.money(dto.tribAproxEstadual) }
                  : {}),
                ...(dto.tribAproxMunicipal !== undefined
                  ? { ValRetMunicipais: this.money(dto.tribAproxMunicipal) }
                  : {}),
                ...(dto.aliquotaInss !== undefined
                  ? { ValAliqINSS: this.rate(dto.aliquotaInss / 100) }
                  : {}),
              },
              IteListServico: parseInt(
                dto.codigoServico.replace(/\D/g, ''),
                10,
              ),
              Discriminacao: dto.discriminacao,
              cMun: parseInt(dto.codigoMunicipio || config.ibgeCode || '0', 10),
              // Texto, com os zeros à esquerda — ver tributMunicipio.
              TributMunicipio: tributMunicipio,
              // Classificação fiscal do serviço, omitida quando não cadastrada.
              ...(dto.nbs ? { CodigoNBS: dto.nbs } : {}),
              // Só dígitos: o cadastro aceita "24.01.02" (como a lista de
              // serviços exibe), mas o campo é C(6) no provedor, que corta em
              // "24.01." — e a prefeitura recebe um cTribNac sem sentido.
              ...(codTribNacionalDigitos
                ? { codTributNacional: codTribNacionalDigitos }
                : {}),
              ...(dto.cnae
                ? { Cnae: parseInt(dto.cnae.replace(/\D/g, ''), 10) || 0 }
                : {}),
              // Grupo IBSCBS: CSTIBSCBS e cClassTrib são ambos obrigatórios
              // no schema do provedor (InvoiCy_NFSe_Reforma_tributaria.xsd).
              // Enviar só a classificação produzia grupo incompleto — mesmo
              // tipo de defeito que gerava a rejeição de schema em locPrest.
              // Por isso o grupo só é montado quando os dois existem, e o
              // cadastro fornece os dois por padrão ("000" / "000001").
              ...(grupoIbsCbsCompleto
                ? {
                    IBSCBS: {
                      CSTIBSCBS: dto.cstIbsCbs,
                      cClassTrib: dto.codClassificacao,
                    },
                  }
                : {}),
              // LocalPrestacao é sempre enviado: sem ele o Invoicy gera
              // <locPrest> vazio na DPS e a prefeitura rejeita com E1235
              // (schema exige cLocPrestacao). Sem entrega informada, o local
              // de prestação é o endereço do próprio prestador
              // (LocalPrestServ: 1).
              LocalPrestacao: dto.entregaEndereco
                ? {
                    SerEndTpLgr: 'Rua',
                    SerEndLgr: dto.entregaEndereco,
                    SerEndNumero: dto.entregaNumero || 'S/N',
                    SerEndBairro: dto.entregaBairro || '',
                    SerEndxMun: dto.entregaMunicipio || '',
                    // Fallback para o código IBGE do emissor quando o frontend
                    // não informar (ex.: endereço do prestador pré-preenchido)
                    SerEndcMun:
                      parseInt(
                        dto.entregaCodigoMunicipio ||
                          config.ibgeCode ||
                          config.emitCmun ||
                          '0',
                        10,
                      ) || 0,
                    SerEndCep:
                      parseInt((dto.entregaCep || '').replace(/\D/g, ''), 10) ||
                      0,
                    SerEndSiglaUF: dto.entregaUf || '',
                  }
                : {
                    SerEndTpLgr: 'Rua',
                    SerEndLgr: config.company.address.street || '',
                    SerEndNumero: config.company.address.number || 'S/N',
                    SerEndBairro: config.company.address.neighborhood || '',
                    SerEndxMun: config.company.address.city || '',
                    SerEndcMun:
                      parseInt(config.ibgeCode || config.emitCmun || '0', 10) ||
                      0,
                    SerEndCep:
                      parseInt(
                        (config.company.address.zipcode || '').replace(
                          /\D/g,
                          '',
                        ),
                        10,
                      ) || 0,
                    SerEndSiglaUF: config.company.address.state || '',
                  },
            },
            Tomador: {
              TomaCNPJ: dto.tomador.cnpj
                ? dto.tomador.cnpj.replace(/\D/g, '')
                : undefined,
              TomaCPF: dto.tomador.cpf
                ? dto.tomador.cpf.replace(/\D/g, '')
                : undefined,
              TomaRazaoSocial: dto.tomador.razaoSocial,
              TomaEndereco: dto.tomador.endereco,
              TomaNumero: dto.tomador.numero,
              TomaBairro: dto.tomador.bairro,
              TomacMun: parseInt(dto.tomador.codigoMunicipio || '0', 10),
              TomaxMun: dto.tomador.municipio,
              TomaUF: dto.tomador.uf,
              TomaCEP:
                parseInt((dto.tomador.cep || '').replace(/\D/g, ''), 10) || 0,
            },
          },
        ],
      },
    };

    return invoicyRequest;
  }

  /**
   * Pré-visualização da NFS-e antes de emitir.
   *
   * Roda o mesmo contexto, os mesmos cálculos e o mesmo montador do RPS que a
   * emissão — é o que garante que a prévia mostre o documento que será
   * transmitido. Não reserva RPS, não cria registro, não chama a prefeitura.
   *
   * Devolve 200 mesmo quando a nota não pode sair: a prévia existe para
   * mostrar o que corrigir. Quem lança é o `emit`.
   */
  async preview(companyId: string, dto: EmitNfseDto): Promise<NfsePreview> {
    const { config, environment } = await this.resolveNfseEmissionContext(
      companyId,
      dto,
    );

    let valores: ReturnType<NfseService['computeNfseValores']>;
    let invoicyRequest: InvoicyNfseRequest;
    const numeracao = (config as any).activeNumbering?.nfse;
    const rps = {
      numero: numeracao?.nextNumber ?? config.proximoRpsNfse ?? 1,
      serie: String(numeracao?.series ?? config.serieNfse ?? '1'),
    };

    try {
      valores = this.computeNfseValores(dto, config);
      invoicyRequest = this.buildNfseRps(
        dto,
        config,
        environment,
        valores,
        rps,
      );
    } catch (error) {
      return {
        podeEmitir: false,
        bloqueios: String(error?.message ?? 'Não foi possível montar a nota.')
          .split(String.fromCharCode(10))
          .map((linha) => linha.trim())
          .filter(Boolean),
        avisos: [],
      };
    }

    const rpsEnviado: any = invoicyRequest.Documento.RPS?.[0] ?? {};
    const servico: any = rpsEnviado.Servico ?? {};

    const avisos = [
      'Número de RPS previsto: o definitivo é reservado no momento da emissão. O número da NFS-e quem define é a prefeitura.',
      'Se a prefeitura recusar a inscrição municipal (E0120) ou exigir o regime de apuração (E0166), o sistema reenvia automaticamente com o ajuste — o payload transmitido pode diferir deste nesses dois campos.',
    ];
    if (environment !== 'PRODUCAO') {
      avisos.push('Ambiente de homologação: a nota não tem valor fiscal.');
    }
    if (valores.omitirAliquotaIss) {
      avisos.push(
        'Alíquota de ISS omitida: prestador ME/EPP do Simples sem retenção recolhe pelo DAS (regra E0625 do provedor).',
      );
    }
    // O grupo IBSCBS e' tudo ou nada: sem CST e cClassTrib no servico, os
    // indicadores da Reforma sao descartados para nao gerar <IBSCBS> sem
    // <valores> (E1235). O descarte e' silencioso no payload — a conferencia
    // e' onde ele precisa aparecer, inclusive quando o valor vinha do padrao
    // do emissor e o usuario nao digitou nada.
    const indicadoresReforma = [
      dto.cIndOp || (config as any).indicadorOperacaoNfse,
      dto.indFinal,
      dto.indDest,
      dto.tpEnteGov,
      dto.tpOper,
    ].some((valor) => valor !== undefined && valor !== null && valor !== '');
    if (indicadoresReforma && !(dto.cstIbsCbs && dto.codClassificacao)) {
      avisos.push(
        'Indicadores da Reforma (Indicador de Operação, uso e consumo pessoal, destinatário, entes governamentais) não serão enviados: o serviço escolhido não tem CST e Classificação Tributária IBS/CBS. Cadastre os dois na Lista de Serviços para que eles saiam na nota.',
      );
    }
    if (!(config as any).ibsCbsEnviarValores) {
      avisos.push(
        'Valores de IBS/CBS não enviados: o emissor não habilitou o envio. Os códigos de CST e classificação continuam indo.',
      );
    }

    return {
      podeEmitir: true,
      bloqueios: [],
      avisos,
      documento: {
        modelo: 'NFSE',
        ambiente: environment as 'HOMOLOGACAO' | 'PRODUCAO',
        rpsPrevisto: rps.numero,
        rpsSerie: rps.serie,
        // A prefeitura é quem numera a NFS-e, no retorno da recepção.
        numeroNfse: null,
        dataEmissaoPrevista: rpsEnviado.dEmis,
        dataCompetencia: rpsEnviado.dCompetencia,
        naturezaOperacao: rpsEnviado.natOp,
        localPrestacao: rpsEnviado.LocalPrestServ,
        optanteSimples: rpsEnviado.OptSN,
        regimeEspecial: rpsEnviado.RegEspTrib ?? null,
        cIndOp: rpsEnviado.cIndOp ?? null,
        indFinal: rpsEnviado.indFinal ?? null,
        indDest: rpsEnviado.indDest ?? null,
        tpEnteGov: rpsEnviado.tpEnteGov ?? null,
        tpOper: rpsEnviado.tpOper ?? null,
        regApIbsCbsSn: rpsEnviado.regApIBSCBSSN ?? null,
      },
      prestador: rpsEnviado.Prestador,
      tomador: rpsEnviado.Tomador,
      servico: {
        codigoServico: servico.CodigoServico ?? dto.codigoServico,
        discriminacao: servico.Discriminacao ?? dto.discriminacao,
        codigoMunicipio: servico.cMunPrestacao ?? dto.codigoMunicipio,
        nbs: dto.nbs ?? null,
        codTribNacional: dto.codTribNacional ?? null,
        codTribMunicipio: dto.codTribMunicipio ?? null,
        cnae: dto.cnae ?? null,
        cstIbsCbs: dto.cstIbsCbs ?? null,
        codClassificacao: dto.codClassificacao ?? null,
      },
      itens: rpsEnviado.ListaItens ?? [],
      valores: {
        valorServicos: valores.valorServicos,
        valorDeducoes: valores.valorDeducoes,
        baseCalculo: valores.baseCalculo,
        aliquotaIss: valores.omitirAliquotaIss ? null : valores.aliquotaIss,
        valorIss: valores.valorIss,
        issRetido: !!dto.issRetido,
        ibsCbs: (valores.valoresIbsCbs as any)?.IBSCBS ?? null,
      },
      payloadInvoicy: invoicyRequest,
    };
  }

  /** Pré-visualização a partir de uma ordem de serviço. */
  async previewFromOrder(
    companyId: string,
    dto: EmitNfseFromOrderDto,
  ): Promise<NfsePreview> {
    return this.preview(
      companyId,
      await this.buildNfseDtoFromOrder(companyId, dto),
    );
  }

  /** Pré-visualização da NFS-e consolidada. */
  async previewFromOrders(
    companyId: string,
    dto: EmitNfseFromOrdersDto,
  ): Promise<NfsePreview> {
    const { fullDto } = await this.buildNfseDtoFromOrders(companyId, dto);
    return this.preview(companyId, fullDto);
  }

  private orderFiscalInclude() {
    return {
      nfes: {
        where: { status: { in: this.activeNfeStatuses } },
        select: { id: true, status: true },
        take: 1,
      },
      nfeOrders: {
        where: {
          nfe: { status: { in: this.activeNfeStatuses } },
        },
        select: { id: true },
        take: 1,
      },
      nfses: {
        // `numero > 0` entra junto com os status ativos: a prefeitura so'
        // numera o que autorizou, entao uma nota numerada e' documento fiscal
        // existente mesmo que o status local diga outra coisa. Sem isso, um
        // status errado desarmava a trava e a O.S. recebia uma segunda nota.
        where: {
          OR: [
            { status: { in: this.activeNfseStatuses } },
            { numero: { gt: 0 } },
          ],
        },
        select: { id: true, status: true, numero: true },
        take: 1,
      },
      nfces: {
        where: { status: { in: this.activeNfceStatuses } },
        select: { id: true, status: true },
        take: 1,
      },
    };
  }

  private getPrestadorMunicipalRegistration(config: any): string | undefined {
    const municipalRegistration = (
      config.company?.municipalRegistration || ''
    ).replace(/\D/g, '');

    return municipalRegistration || undefined;
  }

  private async sendNfseToInvoicy(
    companyId: string,
    invoicyRequest: InvoicyNfseRequest,
    invoicyConfigId?: string,
    environment?: 'HOMOLOGACAO' | 'PRODUCAO',
  ) {
    // Repassa emissor e ambiente já resolvidos com docType 'NFSE'. Sem isso o
    // transporte recai no activeEnvironment global e pode falar com um host de
    // ambiente diferente do tpAmb que vai no payload.
    const invoicyResponses = await this.invoicyApiService.emitNfse(
      companyId,
      [invoicyRequest],
      invoicyConfigId,
      environment,
    );

    const response = invoicyResponses[0];
    if (!response) {
      throw new Error('Nenhuma resposta recebida do Invoicy');
    }

    return response;
  }

  private removePrestadorMunicipalRegistration(
    invoicyRequest: InvoicyNfseRequest,
  ): boolean {
    const prestador = invoicyRequest.Documento.RPS?.[0]
      ?.Prestador as unknown as Record<string, unknown> | undefined;

    if (!prestador?.IM) {
      return false;
    }

    delete prestador.IM;
    return true;
  }

  private shouldRetryNfseWithoutPrestadorIm(response: any): boolean {
    const doc = response?.Documentos?.[0];
    const message = [
      response?.Descricao,
      response?.Mensagem,
      response?.ErrorInvoicy,
      doc?.MensagemSefaz?.DscMsg,
      doc?.Situacao?.SitDescricao,
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return (
      message.includes('e0120') ||
      (message.includes('im do prestador') &&
        message.includes('nao deve ser informado'))
    );
  }

  private shouldRetryNfseWithRegApuracao(response: any): boolean {
    const doc = response?.Documentos?.[0];
    const message = [
      response?.Descricao,
      response?.Mensagem,
      response?.ErrorInvoicy,
      doc?.MensagemSefaz?.DscMsg,
      doc?.Situacao?.SitDescricao,
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return (
      message.includes('e0166') ||
      message.includes('regime de apuracao') ||
      (message.includes('regapuracao') && message.includes('obrigatorio'))
    );
  }

  /**
   * Reenvio do E0166: declara a apuracao pelo Simples Nacional.
   *
   * So' vale para ME/EPP optante. Para um emissor do Regime Normal — ou para
   * um MEI — isto declararia, numa nota fiscal, que a empresa e' ME/EPP
   * optante do Simples: declaracao falsa. Nesse caso nao reenvia: a rejeicao
   * da prefeitura sobe para o usuario, que e' quem sabe o que o municipio
   * exige.
   *
   * `emitCrt` nulo segue tratado como Simples: era o comportamento antes de o
   * CRT 3 existir, e a prefeitura identifica a empresa pelos registros dela.
   *
   * Devolve `true` quando aplicou, para o chamador saber se ha' o que reenviar.
   */
  private addRegApuracaoToNfseRequest(
    invoicyRequest: InvoicyNfseRequest,
    config: any,
  ): boolean {
    // O reenvio declara ME/EPP optante: regApTribSN e RegEspTrib 6 sao os
    // campos dessa faixa. O MEI fica de fora — ele ja' sai com OptSN 1 e
    // RegEspTrib 5, e declara-lo ME/EPP para vencer a rejeicao seria falso.
    const meEpp = isOptanteSimples(config?.emitCrt) && !isMei(config?.emitCrt);
    if (!meEpp) return false;

    const rps = invoicyRequest.Documento.RPS?.[0] as any;
    if (!rps || rps.regApTribSN !== undefined) return false;

    rps.regApTribSN = 1; // tributos federais e municipais apurados pelo SN
    rps.OptSN = 1; // 1 = optante do Simples Nacional
    rps.RegEspTrib = 6; // ABRASF: 6 = ME/EPP
    return true;
  }

  /**
   * Impede emitir NFS-e sobre uma ordem que já tem documento fiscal.
   *
   * Uma emissão que falha no transporte fica em PROCESSING — "resultado
   * desconhecido", porque o provedor pode ter registrado a nota. Como
   * PROCESSING conta como documento ativo, a ordem ficava travada para
   * sempre, sem saída pela interface: a tela só dizia "já possui documento
   * fiscal ativo ou autorizado", o que nem era verdade.
   *
   * Agora, antes de bloquear por um registro nesse estado, consulta o
   * provedor pelo número do RPS. Se ele não conhece o RPS, a emissão nunca
   * chegou lá e a ordem é liberada; se conhece, o bloqueio é legítimo e a
   * mensagem diz qual é a situação real.
   */
  private async assertOrdersCanReceiveNfse(orders: any[], companyId: string) {
    for (const order of orders) {
      if (!order) {
        throw new NotFoundException('Ordem de serviço não encontrada');
      }

      if (order.status === OrderStatus.CANCELED) {
        throw new BadRequestException(
          'Não é possível emitir NFS-e para uma ordem de serviço cancelada.',
        );
      }

      if (order.nfes?.length > 0 || order.nfeOrders?.length > 0) {
        throw new ConflictException(
          'Esta ordem de serviço já possui NF-e emitida.',
        );
      }

      if (order.nfces?.length > 0) {
        throw new ConflictException(
          'Esta ordem de serviço já possui NFC-e emitida.',
        );
      }

      const nfseExistente = order.nfses?.[0];
      if (!nfseExistente) continue;

      // Antes dos demais ramos: numero atribuido quer dizer nota registrada
      // na prefeitura, e reemitir cria documento fiscal duplicado.
      if ((nfseExistente.numero ?? 0) > 0) {
        throw new ConflictException(
          `Esta ordem já tem a NFS-e nº ${nfseExistente.numero} registrada na ` +
            'prefeitura. Se ela está incorreta, cancele-a antes de emitir outra.',
        );
      }

      if (nfseExistente.status === NfseStatus.PROCESSING) {
        const liberada = await this.tentarLiberarNfseEmProcessamento(
          nfseExistente.id,
          companyId,
        );
        if (liberada) continue;

        throw new ConflictException(
          'Esta ordem tem uma NFS-e em processamento no provedor. Consulte o ' +
            'status dela antes de emitir outra, para não duplicar a nota.',
        );
      }

      if (nfseExistente.status === NfseStatus.AUTHORIZED) {
        throw new ConflictException(
          'Esta ordem de serviço já possui NFS-e autorizada.',
        );
      }

      throw new ConflictException(
        'Esta ordem de serviço já possui uma NFS-e em digitação ou pendente.',
      );
    }
  }

  /**
   * Reconcilia uma NFS-e presa em PROCESSING. Devolve true quando o provedor
   * não conhece o RPS — aí não há nota em voo e a ordem pode receber outra.
   *
   * Falha de consulta não libera: sem saber o que aconteceu, bloquear é o
   * lado seguro do erro, porque nota duplicada na prefeitura é dano
   * permanente.
   */
  private async tentarLiberarNfseEmProcessamento(
    nfseId: string,
    companyId: string,
  ): Promise<boolean> {
    try {
      const resultado = await this.consultStatus(nfseId, companyId);
      return resultado.encontradoNoProvedor === false;
    } catch (error) {
      this.logger.warn(
        `Não foi possível reconciliar a NFS-e ${nfseId} antes de emitir: ${error.message}`,
      );
      return false;
    }
  }

  private assertNfsePayloadReady(
    dto: EmitNfseDto,
    valorServicos: number,
    valorDeducoes: number,
    baseCalculo: number,
  ) {
    const codigoServicoDigits = (dto.codigoServico || '').replace(/\D/g, '');
    const prestadorMunicipio = (dto.codigoMunicipio || '').replace(/\D/g, '');
    const tomadorMunicipio = (dto.tomador?.codigoMunicipio || '').replace(
      /\D/g,
      '',
    );
    const cnpj = (dto.tomador?.cnpj || '').replace(/\D/g, '');
    const cpf = (dto.tomador?.cpf || '').replace(/\D/g, '');

    if (valorServicos <= 0) {
      throw new BadRequestException(
        'Valor dos serviços deve ser maior que zero.',
      );
    }

    if (valorDeducoes < 0 || baseCalculo < 0) {
      throw new BadRequestException(
        'Valor das deduções não pode exceder o valor dos serviços.',
      );
    }

    if (!codigoServicoDigits || Number(codigoServicoDigits) <= 0) {
      throw new BadRequestException(
        'Código do serviço municipal é obrigatório para emitir NFS-e.',
      );
    }

    if (!prestadorMunicipio || Number(prestadorMunicipio) <= 0) {
      throw new BadRequestException(
        'Código IBGE do município do prestador é obrigatório para emitir NFS-e.',
      );
    }

    if (!tomadorMunicipio || Number(tomadorMunicipio) <= 0) {
      throw new BadRequestException(
        'Código IBGE do município do tomador é obrigatório para emitir NFS-e.',
      );
    }

    if (!dto.tomador?.razaoSocial?.trim()) {
      throw new BadRequestException('Razão social do tomador é obrigatória.');
    }

    if (
      !dto.tomador?.idEstrangeiro &&
      cnpj.length !== 14 &&
      cpf.length !== 11
    ) {
      throw new BadRequestException(
        'Informe CPF ou CNPJ válido para o tomador da NFS-e.',
      );
    }
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

  async cancel(id: string, companyId: string, dto: CancelNfseDto) {
    const nfse = await this.findById(id, companyId);

    if (nfse.status !== NfseStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Apenas NFS-e autorizadas podem ser canceladas',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    try {
      this.logger.log(
        `Cancelando NFS-e ${nfse.numero} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy para cancelamento de NFS-e
      const invoicyResponses = await this.invoicyApiService.cancelNfse(
        companyId,
        nfse.numero,
        nfse.codigoVerificacao,
        dto.justificativa,
        nfse.ambiente,
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
      const isCancelled = situacao?.SitCodigo === 101; // Cancelamento autorizado

      if (!isCancelled) {
        throw new Error(
          situacao?.SitDescricao ||
            'Cancelamento não autorizado pela Prefeitura',
        );
      }

      const updatedNfse = await this.prisma.nfse.update({
        where: { id },
        data: {
          status: NfseStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
          protocoloCancelamento: doc?.DocProtocolo || null,
        },
      });

      return updatedNfse;
    } catch (error) {
      this.logger.error(
        `Erro ao cancelar NFS-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Erro ao cancelar NFS-e: ${error.message}`);
    }
  }

  /**
   * Consulta a NFS-e no provedor e reconcilia o registro local.
   *
   * Existe porque a emissão trata a resposta síncrona como verdade final: se
   * ela se perde (timeout, HTTP 5xx) ou a prefeitura autoriza depois, o
   * registro fica em PROCESSING/REJECTED enquanto a nota existe de fato. Sem
   * isto a única saída é conferir manualmente no portal do InvoiCy.
   */
  async consultStatus(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);
    const config = await this.invoicyService.getConfig(companyId);

    this.logger.log(
      `Consultando NFS-e ${nfse.id} (RPS ${nfse.rpsNumero}/${nfse.rpsSerie}) no provedor`,
    );

    let doc: any;
    try {
      const responses = await this.invoicyApiService.consultNfse(
        companyId,
        nfse.rpsNumero,
        nfse.rpsNumero,
        nfse.rpsSerie,
        nfse.ambiente,
        config.id,
      );

      doc = responses?.[0]?.Documentos?.[0];
    } catch (error) {
      this.logger.error(
        `Erro ao consultar NFS-e ${nfse.id}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao consultar NFS-e no provedor: ${error.message}`,
      );
    }

    // Sem documento: o provedor nunca registrou este RPS. É o caso de uma
    // emissão que falhou no transporte — o número está livre para reemitir.
    if (!doc) {
      if (nfse.status === NfseStatus.PROCESSING) {
        await this.prisma.nfse.update({
          where: { id: nfse.id },
          data: {
            status: NfseStatus.REJECTED,
            motivoRejeicao:
              'Consulta ao provedor não localizou o RPS: a emissão não chegou a ser registrada.',
          },
        });
      }

      return {
        id: nfse.id,
        rpsNumero: nfse.rpsNumero,
        rpsSerie: nfse.rpsSerie,
        encontradoNoProvedor: false,
        statusAnterior: nfse.status,
        status:
          nfse.status === NfseStatus.PROCESSING
            ? NfseStatus.REJECTED
            : nfse.status,
        statusAlterado: nfse.status === NfseStatus.PROCESSING,
        mensagem:
          'RPS não localizado no provedor. Nenhuma nota foi gerada para esta numeração.',
      };
    }

    const situacao = doc.Situacao;
    // Number(): a consulta ja' devolveu o codigo como string em alguns
    // retornos, e `=== 100` reprovava uma nota autorizada.
    const sitCodigo = Number(situacao?.SitCodigo);
    const isAuthorized = sitCodigo === 100;
    const isCancelled = sitCodigo === 101;
    const motivo = situacao?.SitDescricao?.trim();

    /**
     * Situacao ilegivel NAO e' rejeicao.
     *
     * O ternario anterior caia em REJECTED para qualquer coisa que nao fosse
     * 100 nem 101 — inclusive para um retorno sem o bloco `Situacao`. Como o
     * update era incondicional, uma nota ja' autorizada era rebaixada, e o
     * motivo ia a NULL (`SitDescricao || null`). Foi o que aconteceu com
     * quatro notas da Armazem 76 e uma da Plottec: numero municipal e chave
     * de acesso gravados, retorno da emissao dizendo "Efetivado", status
     * REJECTED e motivo vazio. O usuario leu "Rejeitada" e reemitiu — duas
     * NFS-e autorizadas de R$ 8.920 para a mesma O.S.
     *
     * Regras agora:
     * - so' 100 e 101 movem o status; o resto e' inconclusivo;
     * - rejeicao sem motivo e' inconclusiva (a prefeitura sempre diz por que);
     * - nota ja' numerada nunca vira rejeitada (a prefeitura nao numera o que
     *   recusou — `reconcilePending` ja' trata "REJECTED com numero" como
     *   estado impossivel).
     */
    const rejeicaoLegivel = !isAuthorized && !isCancelled && Boolean(motivo);
    const jaNumerada = (nfse.numero ?? 0) > 0;
    const novoStatus = isAuthorized
      ? NfseStatus.AUTHORIZED
      : isCancelled
        ? NfseStatus.CANCELLED
        : rejeicaoLegivel && !jaNumerada
          ? NfseStatus.REJECTED
          : null;

    if (novoStatus === null) {
      this.logger.warn(
        `Consulta da NFS-e ${nfse.id} (RPS ${nfse.rpsNumero}/${nfse.rpsSerie}) ` +
          `veio inconclusiva; status ${nfse.status} mantido. Situacao recebida: ` +
          JSON.stringify(situacao ?? null),
      );
    }

    const statusAlterado = novoStatus !== null && novoStatus !== nfse.status;

    const atualizada = await this.prisma.nfse.update({
      where: { id: nfse.id },
      data: {
        // Sem status no update quando a consulta nao conclui: os demais
        // campos tem fallback para o valor atual, entao nada se perde.
        ...(novoStatus !== null
          ? {
              status: novoStatus,
              motivoRejeicao: isAuthorized ? null : motivo || null,
            }
          : {}),
        numero: doc.NFSe?.NFSeNumero || nfse.numero,
        codigoVerificacao:
          doc.NFSe?.NFSeCodVerificacao || nfse.codigoVerificacao,
        protocolo: doc.DocProtocolo || nfse.protocolo,
        invoicyId: doc.DocIDUnico || nfse.invoicyId,
        pdfUrl: doc.DocPDFDownload || nfse.pdfUrl,
        xmlRetorno: doc.DocXMLBase64 || nfse.xmlRetorno,
      },
    });

    if (statusAlterado) {
      this.logger.warn(
        `NFS-e ${nfse.id} reconciliada: ${nfse.status} -> ${novoStatus} ` +
          `(RPS ${nfse.rpsNumero}, nota ${atualizada.numero})`,
      );
    }

    return {
      id: atualizada.id,
      numero: atualizada.numero,
      serie: atualizada.serie,
      rpsNumero: atualizada.rpsNumero,
      rpsSerie: atualizada.rpsSerie,
      encontradoNoProvedor: true,
      statusAnterior: nfse.status,
      status: atualizada.status,
      statusAlterado,
      // A tela precisa distinguir "confirmei no provedor" de "nao consegui
      // ler a situacao": antes as duas viravam um toast de sucesso.
      inconclusivo: novoStatus === null,
      codigoVerificacao: atualizada.codigoVerificacao,
      protocolo: atualizada.protocolo,
      pdfUrl: atualizada.pdfUrl,
      dataEmissao: atualizada.dataEmissao,
      valorServicos: atualizada.valorServicos,
      situacaoProvedor: motivo || null,
    };
  }

  /**
   * Varre as NFS-e cujo desfecho local pode não refletir o provedor e
   * reconcilia cada uma.
   *
   * Alvos:
   * - PROCESSING: emissão que perdeu a resposta (timeout/5xx).
   * - REJECTED sem número: a prefeitura pode ter autorizado depois, ou a
   *   rejeição foi de uma tentativa anterior do mesmo RPS. Foi assim que uma
   *   nota autorizada ficou invisível para o sistema.
   */
  async reconcilePending(companyId: string, limite = 25) {
    // Nota do CNPJ anterior a uma transferência de titularidade não é
    // consultada: as credenciais de hoje são do CNPJ novo.
    const historico = await loadFiscalHistoryLock(this.prisma, companyId);
    const candidatas = (
      await this.prisma.nfse.findMany({
        where: {
          companyId,
          OR: [
            { status: NfseStatus.PROCESSING },
            { status: NfseStatus.REJECTED, numero: 0 },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limite,
        select: {
          id: true,
          rpsNumero: true,
          rpsSerie: true,
          status: true,
          createdAt: true,
          invoicyConfigId: true,
        },
      })
    ).filter((nota) => !isHistoricalDocument(nota, historico));

    const resultados: any[] = [];

    for (const candidata of candidatas) {
      try {
        const resultado = await this.consultStatus(candidata.id, companyId);
        resultados.push({
          id: candidata.id,
          rpsNumero: candidata.rpsNumero,
          statusAnterior: candidata.status,
          status: resultado.status,
          alterada: resultado.statusAlterado,
          encontradoNoProvedor: resultado.encontradoNoProvedor,
        });
      } catch (error) {
        // Uma consulta que falha não pode abortar a varredura inteira.
        resultados.push({
          id: candidata.id,
          rpsNumero: candidata.rpsNumero,
          statusAnterior: candidata.status,
          erro: error.message,
        });
      }

      // Espaçamento entre consultas: o provedor recomenda intervalo entre
      // consultas consecutivas.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const alteradas = resultados.filter((r) => r.alterada).length;

    this.logger.log(
      `Reconciliação NFS-e da empresa ${companyId}: ${candidatas.length} consultadas, ${alteradas} atualizadas`,
    );

    return {
      consultadas: candidatas.length,
      alteradas,
      // Sinaliza que a varredura pode não ter coberto tudo.
      limiteAtingido: candidatas.length === limite,
      resultados,
    };
  }

  /**
   * Confere o cadastro fiscal dos serviços de uma ou mais ordens antes de
   * emitir, e informa qual código de serviço a nota vai realmente carregar.
   *
   * Existe porque a emissão não falha quando o serviço não tem código próprio:
   * ela cai silenciosamente no padrão do emissor
   * (`dto.codigoServico || fiscalData.codigoServico || config.codigoServico`),
   * e a nota é autorizada com uma classificação que pode não ser a do serviço.
   * Isso é pior que uma rejeição — o erro só aparece numa fiscalização.
   *
   * A montagem também lê apenas `quotationProduct[0]`, então numa ordem com
   * vários serviços o código do primeiro vale para a nota inteira. Por isso a
   * conferência devolve `codigosDivergentes`.
   */
  async conferirEmissao(companyId: string, orderIds: string[]) {
    const config = await this.invoicyService.getConfig(companyId);
    const codigoPadraoEmissor = config?.codigoServico?.trim() || null;

    const quotations = await this.prisma.quotation.findMany({
      where: { companyId, order: { id: { in: orderIds } } },
      include: {
        quotationProduct: {
          include: { product: { include: { fiscalData: true } } },
        },
      },
    });

    const servicos = quotations
      .flatMap((q) => q.quotationProduct)
      .filter((qp) => (qp.product as any)?.isService)
      .map((qp) => {
        const produto = qp.product as any;
        const fiscalData = produto?.fiscalData;
        const codigoProprio = fiscalData?.codigoServico?.trim() || null;

        return {
          produtoId: produto.id,
          nome: produto.name,
          codigoProprio,
          // O que a nota vai carregar de fato, seguindo a mesma precedência
          // da emissão.
          codigoEfetivo: codigoProprio || codigoPadraoEmissor,
          origemCodigo: codigoProprio
            ? ('proprio' as const)
            : codigoPadraoEmissor
              ? ('padrao_emissor' as const)
              : ('ausente' as const),
          pendencias:
            this.productFiscalService.avaliarCadastroFiscal(fiscalData),
        };
      });

    // Uma nota carrega um único código de serviço. Serviços com códigos
    // próprios diferentes na mesma ordem perdem a classificação dos demais.
    const codigosDistintos = [
      ...new Set(servicos.map((s) => s.codigoProprio).filter(Boolean)),
    ];

    const semCodigoAlgum = servicos.filter((s) => s.origemCodigo === 'ausente');
    const usandoPadrao = servicos.filter(
      (s) => s.origemCodigo === 'padrao_emissor',
    );

    return {
      servicos,
      codigoPadraoEmissor,
      // Impede a emissão: sem código próprio nem padrão, a prefeitura recusa.
      bloqueiam: semCodigoAlgum.map((s) => s.nome),
      // Não impede, mas a nota sai com classificação possivelmente errada.
      usandoCodigoPadrao: usandoPadrao.map((s) => s.nome),
      codigosDivergentes: codigosDistintos.length > 1 ? codigosDistintos : [],
      podeEmitir: semCodigoAlgum.length === 0,
      exigeConfirmacao: usandoPadrao.length > 0 || codigosDistintos.length > 1,
    };
  }

  async getPdfUrl(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    if (!nfse.pdfUrl) {
      // TODO: Buscar PDF da API do Invoicy se não estiver armazenado
      throw new NotFoundException('PDF não disponível para esta NFS-e');
    }

    return { url: nfse.pdfUrl };
  }

  async getXml(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    if (!nfse.xmlRetorno) {
      throw new NotFoundException('XML não disponível para esta NFS-e');
    }

    return { xml: nfse.xmlRetorno };
  }

  async sendAuthorizedEmail(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);
    const config = await this.invoicyService.getConfig(companyId);

    if (nfse.status !== NfseStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Apenas NFS-e autorizadas podem ser enviadas por e-mail',
      );
    }

    if (!nfse.pdfUrl && !nfse.xmlRetorno) {
      throw new BadRequestException(
        'NFS-e sem PDF ou XML disponível para envio',
      );
    }

    const draftData = nfse.draftData as any;
    const recipientEmail =
      draftData?.tomador?.email || draftData?.tomadorEmail || '';
    const recipientName =
      draftData?.tomador?.razaoSocial || draftData?.tomadorRazaoSocial || '';

    if (!recipientEmail) {
      throw new BadRequestException('Tomador sem e-mail cadastrado');
    }

    return this.sendNfseEmailCore(nfse, config, recipientEmail, recipientName);
  }

  private async sendNfseEmailAutomatic(
    nfse: any,
    config: any,
    recipientEmail: string | undefined,
    recipientName: string | undefined,
  ) {
    if (!config?.sendDanfeXmlAutomatically) return;
    if (!recipientEmail) {
      this.logger.warn(
        `NFS-e ${nfse.id} autorizada sem e-mail do tomador para envio automático`,
      );
      return;
    }
    return this.sendNfseEmailCore(nfse, config, recipientEmail, recipientName);
  }

  private async sendNfseEmailCore(
    nfse: any,
    config: any,
    recipientEmail: string,
    recipientName: string | undefined,
  ) {
    const to = (recipientEmail || '').trim();
    if (!to) throw new BadRequestException('E-mail do destinatário inválido');

    const copyTo = (config?.sendFiscalEmailCopyTo || '').trim();
    const recipients = [to, copyTo].filter(Boolean).join(',');

    const emitterName =
      config?.company?.legalName || config?.company?.name || 'Atrupe';
    const valorTotal = (nfse.valorServicos || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

    await this.mailService.sendEmail(
      recipients,
      `NFS-e ${nfse.numero}/${nfse.serie} autorizada`,
      'nfe-authorized',
      {
        recipientName: recipientName || 'Cliente',
        emitterName,
        numero: nfse.numero,
        serie: nfse.serie,
        chaveAcesso: nfse.codigoVerificacao || '',
        valorTotal,
        danfeUrl: nfse.pdfUrl || '',
        hasDanfe: !!nfse.pdfUrl,
        hasXml: false,
      },
      [],
    );

    await this.prisma.nfse.update({
      where: { id: nfse.id },
      data: { emailSentAt: new Date(), emailSentTo: to },
    });

    return { success: true, sentTo: to };
  }
}
