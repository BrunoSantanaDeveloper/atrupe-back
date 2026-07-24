import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfeStatus, NfseStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { ProductFiscalService } from '../product-fiscal/product-fiscal.service';
import { NfeEmailService } from './nfe-email.service';
import {
  InvoicyDocumentResult,
  InvoicyNfeRequest,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import { fetchCepData } from '../utils/cep.util';
import { getTPag } from '../utils/payment-method-map';
import {
  EmitNfeDto,
  EmitNfeFromOrderDto,
  CancelNfeDto,
  CorrectionLetterDto,
  InutilizarNfeDto,
  NfeFilterDto,
  UpdateNfeDraftDto,
} from './dtos/nfe.dto';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';

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
  ) {}

  /**
   * Prepara os dados para emissÃ£o de NF-e a partir de uma ordem de serviÃ§o.
   * Retorna todos os dados prÃ©-preenchidos para o frontend editar antes de emitir.
   */
  async prepareFromOrder(companyId: string, orderId: string) {
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
            nfes: true, // Incluir NF-e jÃ¡ emitidas
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
      throw new NotFoundException('Ordem de serviÃ§o nÃ£o encontrada');
    }

    const client = quotation.client;
    if (!client) {
      throw new BadRequestException('Cliente nÃ£o encontrado no orÃ§amento');
    }

    // Buscar configuraÃ§Ã£o do Invoicy para defaults
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada. Configure a integraÃ§Ã£o primeiro.',
      );
    }

    const environment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFE',
    );

    // DestinatÃ¡rio usa sempre o endereÃ§o cadastral principal do cliente
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
          },
        },
      },
    })) as any;

    // Preparar itens da NF-e com dados fiscais completos
    const items = (updatedQuotation || quotation).quotationProduct.map(
      (qp, index) => {
        const totalValueCents = qp.finalValue || qp.totalValue || 0;
        const totalValueReais = totalValueCents / 100;
        const unitValue = qp.quantity > 0 ? totalValueReais / qp.quantity : 0;
        const discountReais = (qp.discount || 0) / 100;
        const fiscalData = qp.product?.fiscalData;

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
          description: qp.product?.name || 'Produto/ServiÃ§o',
          ncm: fiscalData?.ncm || '',
          cfop: selectedCfop,
          cstIcms: fiscalData?.icmsCst || '102',
          cstIpi: fiscalData?.ipiCst || '',
          cstPis: fiscalData?.pisCst || '',
          cstCofins: fiscalData?.cofinsCst || '',
          unit: qp.product?.unit || 'UN',
          quantity: qp.quantity,
          unitValue: Number(unitValue.toFixed(2)),
          discount: Number(discountReais.toFixed(2)),
          freight: 0,
          insurance: 0,
          totalValue: Number(totalValueReais.toFixed(2)),
          isService: qp.product?.isService || !!fiscalData?.isService,
          needsConfiguration:
            !fiscalData?.ncm || fiscalData.ncm.length !== 8 || !selectedCfop,
        };
      },
    );

    // Calcular totais
    const valorProdutos = items.reduce((acc, item) => acc + item.totalValue, 0);
    const valorDescontos = items.reduce((acc, item) => acc + item.discount, 0);
    const valorNota = valorProdutos - valorDescontos;

    // Verificar se jÃ¡ existe NF-e emitida para esta ordem
    const activeEnvironment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');
    const activeEnvironmentNumber = activeEnvironment === 'PRODUCAO' ? 1 : 2;
    const existingNfe = [
      ...(quotation.order.nfes || []),
      ...(quotation.order.nfeOrders || []).map((item) => item.nfe),
    ].find((nfe) => nfe && nfe.ambiente === activeEnvironmentNumber);

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

      // ConfiguraÃ§Ã£o de emissÃ£o
      emissao: {
        emissor: config.company.legalName || config.company.name || '',
        emissorCnpj: config.company.cnpj || '',
        proximoDocumento: `${config.proximoNumeroNfe || 1}/${config.serieNfe || 1}`,
        serie: config.serieNfe || 1,
        tipo: 1, // 1 = SaÃ­da
        finalidade: 1, // 1 = NF-e normal
        operationNature: config.defaultOperationNature || 'Venda de mercadoria',
        consumidorFinal: client.cnpj ? 0 : 1, // 0 = NÃ£o, 1 = Sim (pessoa fÃ­sica)
        presencaConsumidor: 1, // 1 = OperaÃ§Ã£o presencial
        nfeReferenciada: null,
        dataSaida: new Date().toISOString(),
        destinoOperacao:
          clientAddress?.state === config.company.address.state ? 1 : 2, // 1 = Interna, 2 = Interestadual
        // Se a OS tem entrega por transportadora, usar modalidade CIF (0); senÃ£o, Sem ocorrÃªncia (9)
        modalidadeFrete:
          quotation.deliveryInfo?.deliveryType === 'CARRIER' ? 0 : 9,
        ambiente: environment,
      },

      // DestinatÃ¡rio
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

      // Transportadora: prÃ©-preencher com dados do supplier da OS quando deliveryType = CARRIER
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

      // Volumes: prÃ©-preencher volume consolidado quando deliveryType = CARRIER
      volumes: (() => {
        const isCarrier = quotation.deliveryInfo?.deliveryType === 'CARRIER';
        if (!isCarrier) return [];

        const productItems = (
          updatedQuotation || quotation
        ).quotationProduct.filter((qp: any) => !qp.product?.isService);

        if (productItems.length === 0) return [];

        // Somar pesos dos QuotationProductItems (peso em kg, valor direto)
        const pesoTotal = productItems.reduce((acc: number, qp: any) => {
          const itemWeight = (qp.items || []).reduce(
            (s: number, i: any) => s + (i.weight || 0) * (i.quantity || 1),
            0,
          );
          return acc + itemWeight;
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

      // InformaÃ§Ãµes complementares
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

      // AutorizaÃ§Ã£o para download (XML)
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
          [NfeStatus.AUTHORIZED, NfeStatus.DRAFT].includes(nfe.status),
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

    const valorProdutos = items.reduce(
      (acc, item) => acc + item.unitValue * item.quantity,
      0,
    );
    const valorDesconto = items.reduce((acc, item) => acc + item.discount, 0);
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
   * Prepara os dados para emissÃ£o de NF-e avulsa (sem ordem de serviÃ§o).
   * Retorna dados padrÃ£o do emitente e, opcionalmente, dados do destinatÃ¡rio se clientId informado.
   */
  async prepareStandalone(companyId: string, clientId?: string) {
    // Buscar configuraÃ§Ã£o do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada. Configure a integraÃ§Ã£o primeiro.',
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
        throw new NotFoundException('Cliente nÃ£o encontrado');
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

      // ConfiguraÃ§Ã£o de emissÃ£o
      emissao: {
        emissor: config.company.legalName || config.company.name || '',
        emissorCnpj: config.company.cnpj || '',
        proximoDocumento: `${config.proximoNumeroNfe || 1}/${config.serieNfe || 1}`,
        serie: config.serieNfe || 1,
        tipo: 1,
        finalidade: 1,
        operationNature: config.defaultOperationNature || 'Venda de mercadoria',
        consumidorFinal: 1,
        presencaConsumidor: 1,
        nfeReferenciada: null,
        dataSaida: new Date().toISOString(),
        destinoOperacao: 1,
        modalidadeFrete: 9,
        ambiente: environment,
      },

      // DestinatÃ¡rio
      destinatario,

      // Itens (vazio para nota avulsa)
      items: [],

      // Transportadora (vazio por padrÃ£o)
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

      // Pagamento padrÃ£o
      pagamento: {
        forma: '01',
        formaDescricao: 'Dinheiro',
        valor: 0,
      },

      // Duplicatas
      duplicatas: [],

      // InformaÃ§Ãµes complementares
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

      // AutorizaÃ§Ã£o para download (XML)
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
        ie: extractTag(destXml, 'IE'),
        email: extractTag(destXml, 'email'),
        endereco: extractTag(enderDestXml, 'xLgr'),
        numero: extractTag(enderDestXml, 'nro'),
        bairro: extractTag(enderDestXml, 'xBairro'),
        cidade: extractTag(enderDestXml, 'xMun'),
        estado: extractTag(enderDestXml, 'UF'),
        cep: extractTag(enderDestXml, 'CEP'),
        pais: 'Brasil',
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

    // Extrair indFinal da tag <ide> â€” usado pelo prepareComplementary
    const ideXml = extractTag(xml, 'ide');
    const indFinal = ideXml
      ? parseInt(extractTag(ideXml, 'indFinal') || '0', 10)
      : 0;

    return { destinatario, items, indFinal };
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

    // 2. Tentar mesclar/sobrepor com dados reais do XML (xmlData), pois o XML Ã© a fonte da verdade da NF emitida
    if (xmlData?.destinatario) {
      destinatario = {
        ...destinatario,
        ...xmlData.destinatario,
      };
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
      throw new NotFoundException('NF-e nÃ£o encontrada');
    }

    if (originalNfe.status !== NfeStatus.AUTHORIZED) {
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

    const mappedItems = itemsOverride.map((item: any) => {
      const quantity = item.quantity ?? 0;
      const unitValue = item.unitValue ?? 0;
      const discount = item.discount ?? 0;
      const freight = item.freight ?? 0;
      const insurance = item.insurance ?? 0;
      const totalValue = Number(
        (quantity * unitValue - discount + freight + insurance).toFixed(2),
      );
      return {
        ...item,
        totalValue: item.totalValue ?? totalValue,
      };
    });

    const config = await this.invoicyService.getConfig(companyId);
    const emitUf = (config?.company?.address?.state || '').toUpperCase();

    const originalCfop = (draftData?.items?.[0]?.cfop ||
      xmlData?.items?.[0]?.cfop ||
      0) as number;

    // SugestÃ£o de CFOP para devoluÃ§Ã£o com base no CFOP original
    const getSuggestedDevolutionCfop = (destUf: string): number => {
      const isInterestadual =
        emitUf && destUf && emitUf !== destUf.toUpperCase();
      const lastThree = originalCfop % 1000;
      // ProduÃ§Ã£o prÃ³pria (5101/6101) -> 1201/2201
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
      throw new NotFoundException('NF-e nÃ£o encontrada');
    }

    if (originalNfe.status !== NfeStatus.AUTHORIZED) {
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
      throw new NotFoundException('NF-e nÃ£o encontrada');
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

    const emissaoOverride = draftData?.emissao || {};
    const itemsOverride = draftData?.items || xmlData?.items || [];

    const mappedItems = itemsOverride.map((item: any) => {
      const quantity = item.quantity ?? 0;
      const unitValue = item.unitValue ?? 0;
      const discount = item.discount ?? 0;
      const freight = item.freight ?? 0;
      const insurance = item.insurance ?? 0;
      const totalValue = Number(
        (quantity * unitValue - discount + freight + insurance).toFixed(2),
      );
      return {
        ...item,
        totalValue: item.totalValue ?? totalValue,
      };
    });

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
      originalNfeId: originalNfe.id,
      originalNfeNumero: originalNfe.numero,
      motivoRejeicao: originalNfe.motivoRejeicao,
    };
  }

  // Emitir NF-e a partir de uma ordem de serviÃ§o (busca dados automaticamente)

  async emitFromOrder(companyId: string, dto: EmitNfeFromOrderDto) {
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
          },
        },
      },
    });

    if (!quotation || !quotation.order) {
      throw new NotFoundException('Ordem de serviÃ§o nÃ£o encontrada');
    }

    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada. Configure a integraÃ§Ã£o primeiro.',
      );
    }
    const environment =
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config, 'NFE');

    // Verificar se jÃ¡ existe NF-e autorizada para esta ordem
    const existingNfe = await this.prisma.nfe.findFirst({
      where: {
        orderId: dto.orderId,
        status: NfeStatus.AUTHORIZED,
        ambiente: environment === 'PRODUCAO' ? 1 : 2,
      },
    });

    if (existingNfe) {
      throw new BadRequestException(
        `JÃ¡ existe uma NF-e autorizada para esta ordem de serviÃ§o (NÂº ${existingNfe.numero}/${existingNfe.serie})`,
      );
    }

    const client = quotation.client;
    if (!client) {
      throw new BadRequestException('Cliente nÃ£o encontrado no orÃ§amento');
    }

    // Preparar itens da NF-e (usar totalValue ou finalValue dividido pela quantidade)
    // IMPORTANTE: Valores no banco estÃ£o em centavos, dividir por 100 para reais
    const items = quotation.quotationProduct.map((qp) => {
      const totalValueCents = qp.finalValue || qp.totalValue || 0;
      const totalValueReais = totalValueCents / 100;
      const unitValue = qp.quantity > 0 ? totalValueReais / qp.quantity : 0;
      const discountReais = (qp.discount || 0) / 100;
      return {
        productId: qp.productId,
        quantity: qp.quantity,
        unitValue,
        discount: discountReais,
      };
    });

    if (items.length === 0) {
      throw new BadRequestException('OrÃ§amento nÃ£o possui itens');
    }

    // Obter endereÃ§o principal do cliente
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

    // Validar dados obrigatÃ³rios
    if (!fullDto.destCnpjCpf) {
      throw new BadRequestException('Cliente nÃ£o possui CPF/CNPJ cadastrado');
    }
    if (!fullDto.destNome) {
      throw new BadRequestException('Cliente nÃ£o possui nome cadastrado');
    }
    if (!fullDto.destEndereco) {
      throw new BadRequestException('Cliente nÃ£o possui endereÃ§o cadastrado');
    }

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

    // ObtÃ©m IDs de NF-es rejeitadas duplicadas para excluir da listagem
    const excludedRowsAll = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM nfes r
      WHERE r."companyId" = ${companyId}
        AND r.status = 'REJECTED'
        AND EXISTS (
          SELECT 1 FROM nfes a
          WHERE a."companyId" = r."companyId"
            AND a.numero = r.numero
            AND a.serie = r.serie
            AND a.status = 'AUTHORIZED'
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
      throw new NotFoundException('NF-e nÃ£o encontrada');
    }

    return nfe;
  }

  async findByChaveAcesso(chaveAcesso: string, companyId: string) {
    const nfe = await this.prisma.nfe.findFirst({
      where: { chaveAcesso, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e nÃ£o encontrada');
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

    return this.emit(companyId, {
      ...dto,
      orderId: uniqueOrderIds[0],
      orderIds: uniqueOrderIds,
      quotationId: dto.quotationId || preparedData.quotationId,
    });
  }

  async emit(companyId: string, dto: EmitNfeDto) {
    // Buscar configuraÃ§Ã£o do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada. Configure a integraÃ§Ã£o primeiro.',
      );
    }

    if (!config.isActive) {
      throw new BadRequestException(
        'IntegraÃ§Ã£o com Invoicy estÃ¡ desativada.',
      );
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

    // Validar destinatÃ¡rio
    const isForeign = dto.destPais && dto.destPais !== '1058';
    const cleanCnpjCpf = dto.destCnpjCpf?.replace(/\D/g, '') || '';
    if (!isForeign) {
      if (
        !cleanCnpjCpf ||
        (cleanCnpjCpf.length !== 11 && cleanCnpjCpf.length !== 14)
      ) {
        throw new BadRequestException(
          'CPF/CNPJ do destinatÃ¡rio Ã© obrigatÃ³rio e deve ser vÃ¡lido (11 dÃ­gitos para CPF ou 14 para CNPJ)',
        );
      }
    } else {
      if (
        !dto.destIdEstrangeiro ||
        dto.destIdEstrangeiro.length < 5 ||
        dto.destIdEstrangeiro.length > 20
      ) {
        throw new BadRequestException(
          'Para destinatÃ¡rios estrangeiros, a IdentificaÃ§Ã£o do Estrangeiro (idEstrangeiro) Ã© obrigatÃ³ria e deve ter entre 5 e 20 caracteres',
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
    const dataSaida = dto.dataSaida ? new Date(dto.dataSaida) : now;
    if (Number.isNaN(dataSaida.getTime())) {
      throw new BadRequestException('Data de saida/entrada invalida');
    }

    // Buscar cÃ³digo IBGE do municÃ­pio do destinatÃ¡rio via CEP
    let destCmun = isForeign ? 9999999 : 0;
    let destUfFromCep = isForeign ? 'EX' : dto.destUf || '';
    let destMunFromCep = isForeign
      ? dto.destMunicipio || 'EXTERIOR'
      : dto.destMunicipio || '';
    if (!isForeign && dto.destCep) {
      this.logger.log(
        `Buscando cÃ³digo IBGE para CEP do destinatÃ¡rio: ${dto.destCep}`,
      );
      const cepData = await fetchCepData(dto.destCep);
      if (cepData) {
        destCmun = parseInt(cepData.codigoIbge, 10) || 0;
        destUfFromCep = cepData.uf; // Usar UF do CEP para garantir consistÃªncia
        destMunFromCep = cepData.cidade; // Usar cidade do CEP
        this.logger.log(
          `CÃ³digo IBGE do destinatÃ¡rio: ${destCmun} (${destMunFromCep}/${destUfFromCep})`,
        );
      } else {
        this.logger.warn(
          `CEP do destinatÃ¡rio nÃ£o encontrado: ${dto.destCep}`,
        );
      }
    } else if (!isForeign) {
      this.logger.warn('DestinatÃ¡rio sem CEP cadastrado');
    }

    // Validar que temos o cÃ³digo IBGE do destinatÃ¡rio
    if (!destCmun) {
      throw new BadRequestException(
        'CEP do destinatÃ¡rio Ã© obrigatÃ³rio para emissÃ£o de NF-e. Cadastre um CEP vÃ¡lido para o cliente.',
      );
    }

    // Obter prÃ³ximo nÃºmero da NF-e (sem incrementar ainda - sÃ³ incrementa apÃ³s emissÃ£o bem-sucedida)
    const numero = config.proximoNumeroNfe || 1;

    // Calcular valor total
    const valorTotal = dto.items.reduce(
      (acc, item) =>
        acc + item.quantity * item.unitValue - (item.discount || 0),
      0,
    );

    // Criar ou atualizar registro da NF-e
    let nfe;
    const consolidatedOrderIds = [
      ...new Set((dto.orderIds || []).filter(Boolean)),
    ];

    // Se for vinculada a ordens consolidadas, buscar rascunho pela pivot
    if (consolidatedOrderIds.length > 1) {
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
            serie: config.serieNfe,
            status: NfeStatus.PROCESSING,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            valorTotal,
            motivoRejeicao: null,
          },
        });
      }
    } else if (dto.orderId) {
      const draftNfe = await this.prisma.nfe.findFirst({
        where: {
          companyId,
          orderId: dto.orderId,
          status: NfeStatus.DRAFT,
        },
      });

      if (draftNfe) {
        nfe = await this.prisma.nfe.update({
          where: { id: draftNfe.id },
          data: {
            numero,
            serie: config.serieNfe,
            status: NfeStatus.PROCESSING,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            valorTotal,
            // Limpar possÃ­vel mensagem de erro anterior ao tentar emitir novamente
            motivoRejeicao: null,
            draftData: dto as any,
          },
        });
      }
    }

    // Se nÃ£o encontrou rascunho (ou Ã© avulsa sem ordem), cria nova
    if (!nfe) {
      nfe = await this.prisma.nfe.create({
        data: {
          companyId,
          orderId: dto.orderId,
          quotationId: dto.quotationId,
          numero,
          serie: config.serieNfe,
          status: NfeStatus.PROCESSING,
          ambiente: environment === 'PRODUCAO' ? 1 : 2,
          valorTotal,
          draftData: dto as any,
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

      // Ensure we have emitter IBGE code
      let emitCmun = config.ibgeCode;
      const emitCep = config.company.address.zipcode;

      if (!emitCmun && emitCep) {
        this.logger.log(
          `Emitente (Empresa) sem cÃ³digo IBGE configurado. Buscando via CEP do emitente: ${emitCep}`,
        );
        const cepData = await fetchCepData(emitCep);
        if (cepData) {
          emitCmun = cepData.codigoIbge;
          this.logger.log(`IBGE do emitente encontrado: ${emitCmun}`);

          // Cache IBGE code to avoid external API calls on subsequent emissions
          await this.prisma.invoicyConfig.updateMany({
            where: { companyId },
            data: { emitCmun },
          });
          this.logger.log(`IBGE do emitente persistido no InvoicyConfig`);
        } else {
          this.logger.warn(
            `NÃ£o foi possÃ­vel encontrar IBGE para CEP do emitente: ${emitCep}`,
          );
        }
      }

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
            serie: config.serieNfe?.toString() || '1',
            nNF: numero,
            dhEmi: now.toISOString(),
            dhSaiEnt: dataSaida.toISOString(),
            fusoHorario: '-03:00',
            tpNf: dto.tipo ?? 1, // 0 = Entrada, 1 = Saida
            idDest: isForeign
              ? 3
              : destUfFromCep === config.company.address.state
                ? 1
                : 2, // 1 = Interna, 2 = Interestadual, 3 = Exterior
            cMunFg: parseInt(emitCmun || '0', 10),
            tpImp: 1, // DANFE retrato
            tpEmis: 1, // EmissÃ£o normal
            cDV: 0, // SerÃ¡ calculado pelo Invoicy
            tpAmb: environment === 'PRODUCAO' ? 1 : 2,
            finNFe: dto.finalidade ?? 1, // NF-e normal
            indFinal:
              dto.consumidorFinal ??
              (dto.destCnpjCpf?.replace(/\D/g, '').length === 11 ? 1 : 0),
            indPres: dto.presencaConsumidor ?? 1,
            procEmi: 0, // Aplicativo do contribuinte
            verProc: 'Atrupe 1.0',
            ...(cleanReferencedNfe
              ? { NFref: [{ refNFe: cleanReferencedNfe }] }
              : {}),
          },
          emit: {
            CNPJ_emit: (config.company.cnpj || '').replace(/\D/g, ''),
            xNome: config.company.legalName || '',
            IE: (config.company.stateRegistration || '').replace(/\D/g, ''),
            IM: config.company.municipalRegistration || undefined,
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
            // Em homologaÃ§Ã£o, SEFAZ exige este nome exato para o destinatÃ¡rio
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
              cMun_dest: destCmun, // CÃ³digo IBGE do municÃ­pio do destinatÃ¡rio
              xMun_dest: destMunFromCep, // Nome do municÃ­pio (do CEP)
              UF_dest: destUfFromCep, // UF do destinatÃ¡rio (do CEP para garantir consistÃªncia)
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
              cProd: item.productId || `ITEM${index + 1}`,
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
              CFOP: (() => {
                const baseCfop =
                  item.cfop || parseInt(config.defaultCfop || '5102', 10);

                if (isForeign) {
                  const prefix = Math.floor(baseCfop / 1000);
                  if (prefix === 5 || prefix === 6) {
                    return baseCfop - prefix * 1000 + 7000;
                  }
                  return baseCfop;
                }

                const isInterestadual =
                  destUfFromCep !== config.company.address.state;

                if (dto.finalidade === 4) {
                  const lastThree = baseCfop % 1000;
                  if (lastThree === 101 || lastThree === 201) {
                    return isInterestadual ? 2201 : 1201;
                  }
                  if (lastThree === 102 || lastThree === 202) {
                    return isInterestadual ? 2202 : 1202;
                  }
                  const prefix = Math.floor(baseCfop / 1000);
                  if (prefix === 1 && isInterestadual) {
                    return baseCfop + 1000;
                  }
                  if (prefix === 2 && !isInterestadual) {
                    return baseCfop - 1000;
                  }
                  return isInterestadual ? 2202 : 1202;
                }

                // Se Ã© operaÃ§Ã£o interestadual e CFOP comeÃ§a com 5, converter para 6
                if (isInterestadual && Math.floor(baseCfop / 1000) === 5) {
                  return baseCfop + 1000; // 5102 -> 6102
                }

                // Se Ã© operaÃ§Ã£o interna e CFOP comeÃ§a com 6, converter para 5
                if (!isInterestadual && Math.floor(baseCfop / 1000) === 6) {
                  return baseCfop - 1000; // 6102 -> 5102
                }

                return baseCfop;
              })(),
              uCOM: item.uCom || 'UN',
              qCOM: item.quantity.toFixed(4),
              vUnCom: item.unitValue.toFixed(10),
              vProd: (item.quantity * item.unitValue).toFixed(2),
              uTrib: item.uCom || 'UN', // Usually same as uCom
              qTrib: item.quantity.toFixed(4),
              vUnTrib: item.unitValue.toFixed(10),
              indTot: 1,
            },
            imposto: {
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
              IPI: {
                CST_ipi: item.cstIpi || '99',
              },
            },
          })),
          total: {
            ICMStot: {
              vBC_ttlnfe: '0.00',
              vICMS_ttlnfe: '0.00',
              vICMSDeson_ttlnfe: '0.00',
              vBCST_ttlnfe: '0.00',
              vProd_ttlnfe: valorTotal.toFixed(2),
              vFrete_ttlnfe: '0.00',
              vSeg_ttlnfe: '0.00',
              vDesc_ttlnfe: dto.items
                .reduce((acc, i) => acc + (i.discount || 0), 0)
                .toFixed(2),
              vII_ttlnfe: '0.00',
              vIPI_ttlnfe: '0.00',
              vPIS_ttlnfe: '0.00',
              vCOFINS_ttlnfe: '0.00',
              vOutro: '0.00',
              vNF: valorTotal.toFixed(2),
            },
          },
          pag: [
            {
              tPag: dto.pagamento?.forma || '99',
              vPag:
                dto.pagamento?.forma === '90' ? '0.00' : valorTotal.toFixed(2),
            },
          ],
          transp: {
            modFrete: String(dto.modalidadeFrete ?? 9),
          },
          // InformaÃ§Ãµes adicionais / complementares
          ...(dto.additionalInfo || (config as any).taxInfoText
            ? {
                infAdic: {
                  infCpl:
                    dto.additionalInfo || (config as any).taxInfoText || '',
                },
              }
            : {}),
          // Duplicatas/CobranÃ§a
          ...(dto.duplicatas && dto.duplicatas.length > 0
            ? {
                cobr: {
                  fat: {
                    nFat: numero.toString(),
                    vOrig: valorTotal.toFixed(2),
                    vDesc: '0.00',
                    vLiq: valorTotal.toFixed(2),
                  },
                  dup: dto.duplicatas.map((d) => ({
                    nDup: d.numero || '',
                    dVenc: d.dataVencimento || '',
                    vDup: (d.valor || 0).toFixed(2),
                  })),
                },
              }
            : {}),
          // AutorizaÃ§Ã£o de download
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

      // Chamar API do Invoicy
      const invoicyResponses = await this.invoicyApiService.emitNfe(companyId, [
        invoicyRequest,
      ]);

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: cÃ³digo ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      if (!doc) {
        throw new Error('Documento nÃ£o retornado pelo Invoicy');
      }

      // Verificar situaÃ§Ã£o do documento
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
          // OpÃ§Ã£o: Limpar a chave da antiga ou deletÃ¡-la se for lixo/rejeitada.
          // Como estamos em um novo processo, vamos limpar a chave da antiga para permitir a atualizaÃ§Ã£o.
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
        throw new BadRequestException(
          `NF-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}`,
        );
      }

      await this.persistDanfePdf(nfe.id, doc).catch((danfeError) => {
        this.logger.warn(
          `Nao foi possivel armazenar a DANFE da NF-e ${nfe.id}: ${danfeError.message}`,
        );
      });

      // Incrementar nÃºmero da NF-e somente apÃ³s emissÃ£o bem-sucedida
      await this.invoicyService.incrementNfeNumber(config.id);

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
    } catch (error) {
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
    return ufCodes[uf?.toUpperCase()] || 43; // Default RS
  }

  /**
   * ConstrÃ³i bloco de local de entrega para emissÃ£o inline
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
        `Buscando cÃ³digo IBGE de entrega para CEP: ${dto.entregaCep}`,
      );
      const cepData = await fetchCepData(dto.entregaCep);
      if (cepData) {
        cmun = parseInt(cepData.codigoIbge, 10) || 0;
        uf = cepData.uf;
        municipio = cepData.cidade;
        this.logger.log(
          `CÃ³digo IBGE da entrega: ${cmun} (${municipio}/${uf})`,
        );
      }
    }

    if (!cmun) {
      throw new BadRequestException(
        'CEP de entrega invÃ¡lido ou cÃ³digo IBGE nÃ£o encontrado para o endereÃ§o de entrega.',
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
        'A justificativa deve ter no mÃ­nimo 15 caracteres',
      );
    }

    // Verificar se estÃ¡ dentro do prazo (24h)
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

      // Chamar API do Invoicy para cancelamento
      const invoicyResponses = await this.invoicyApiService.cancelNfe(
        companyId,
        nfe.chaveAcesso,
        dto.justificativa,
        nfe.ambiente,
      );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: cÃ³digo ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isCancelled =
        situacao?.SitCodigo === 135 || situacao?.SitCodigo === 101;

      if (!isCancelled) {
        throw new Error(
          situacao?.SitDescricao || 'Cancelamento nÃ£o autorizado pela SEFAZ',
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

      return updatedNfe;
    } catch (error) {
      this.logger.error(`Erro ao cancelar NF-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao cancelar NF-e: ${error.message}`);
    }
  }

  async sendCorrectionLetter(
    id: string,
    companyId: string,
    dto: CorrectionLetterDto,
  ) {
    const nfe = await this.findById(id, companyId);

    if (
      nfe.status !== NfeStatus.AUTHORIZED &&
      nfe.status !== NfeStatus.CORRECTION_SENT
    ) {
      throw new BadRequestException(
        'Cartas de correÃ§Ã£o sÃ³ podem ser enviadas para NF-e autorizadas ou com correÃ§Ã£o anterior',
      );
    }

    const correcao = dto.correcao?.trim() || '';

    if (correcao.length < 15) {
      throw new BadRequestException(
        'O texto da correÃ§Ã£o deve ter no mÃ­nimo 15 caracteres',
      );
    }

    if (correcao.length > 1000) {
      throw new BadRequestException(
        'O texto da correÃ§Ã£o deve ter no mÃ¡ximo 1000 caracteres',
      );
    }

    try {
      this.logger.log(`Enviando carta de correÃ§Ã£o para NF-e ${nfe.numero}`);

      const lastEvent = await this.prisma.nfeCorrectionEvent.findFirst({
        where: { nfeId: id },
        orderBy: { sequenciaEvento: 'desc' },
      });
      const sequenciaEvento = lastEvent ? lastEvent.sequenciaEvento + 1 : 1;

      if (sequenciaEvento > 20) {
        throw new BadRequestException(
          'A sequÃªncia da carta de correÃ§Ã£o deve ser um nÃºmero entre 1 e 20',
        );
      }

      // Chamar API do Invoicy para carta de correÃ§Ã£o
      const invoicyResponses =
        await this.invoicyApiService.sendCorrectionLetter(
          companyId,
          nfe.chaveAcesso,
          correcao,
          sequenciaEvento,
          nfe.ambiente,
        );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: cÃ³digo ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isApproved = situacao?.SitCodigo === 135;

      if (!isApproved) {
        throw new Error(
          situacao?.SitDescricao ||
            'Carta de correÃ§Ã£o nÃ£o autorizada pela SEFAZ',
        );
      }

      const dataEvento = new Date();
      const xmlEvento = doc?.DocXMLBase64
        ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
        : null;

      const updatedNfe = await this.prisma.nfe.update({
        where: { id },
        data: {
          status: NfeStatus.CORRECTION_SENT,
          cartaCorrecao: correcao,
          dataCorrecao: dataEvento,
          protocoloCorrecao: doc?.DocProtocolo || null,
          sequenciaCorrecao: sequenciaEvento,
        },
      });

      await this.prisma.nfeCorrectionEvent.create({
        data: {
          nfeId: id,
          sequenciaEvento,
          correcao,
          protocolo: doc?.DocProtocolo || null,
          dataEvento,
          xmlEvento,
        },
      });

      return updatedNfe;
    } catch (error) {
      this.logger.error(
        `Erro ao enviar carta de correÃ§Ã£o: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao enviar carta de correÃ§Ã£o: ${error.message}`,
      );
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
        statusDescription: 'Chave de acesso nÃ£o disponÃ­vel para consulta',
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

      const newStatus = this.mapSefazCodToStatus(situacao?.SitCodigo);

      let currentStatus = nfe.status;
      if (newStatus && newStatus !== nfe.status) {
        this.logger.log(
          `Status NF-e ${nfe.numero} mudou: ${nfe.status} â†’ ${newStatus}`,
        );

        await this.prisma.nfe.update({
          where: { id: nfe.id },
          data: { status: newStatus as any },
        });
        currentStatus = newStatus as any;
      }

      return {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        status: currentStatus,
        statusChanged: newStatus !== nfe.status,
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

  private mapSefazCodToStatus(sitCodigo?: number): string | null {
    if (!sitCodigo) return null;

    const map: Record<number, string> = {
      100: 'AUTHORIZED',
      101: 'CANCELLED',
      102: 'CANCELLED',
      135: 'CORRECTION_SENT',
      204: 'AUTHORIZED',
      217: 'REJECTED',
    };

    return map[sitCodigo] || null;
  }

  private async persistDanfePdf(
    nfeId: string,
    doc: InvoicyDocumentResult,
  ): Promise<void> {
    const pdf = await this.resolveDanfePdf(doc);
    if (!pdf) {
      this.logger.warn(
        `DANFE da NF-e ${nfeId} nao foi retornada como PDF valido`,
      );
      return;
    }

    await this.prisma.nfeDanfeDocument.upsert({
      where: { nfeId },
      create: { nfeId, pdf },
      update: { pdf },
    });
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

  async getDanfeUrl(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);
    const danfeDocument = await this.prisma.nfeDanfeDocument.findUnique({
      where: { nfeId: nfe.id },
    });

    if (!danfeDocument && !nfe.danfeUrl) {
      // TODO: Buscar DANFE da API do Invoicy se nÃ£o estiver armazenado
      throw new NotFoundException('DANFE nÃ£o disponÃ­vel para esta NF-e');
    }

    return {
      pdfBase64: danfeDocument?.pdf.toString('base64') || null,
      url: nfe.danfeUrl,
    };
  }

  async getXml(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);

    if (!nfe.xmlAutorizado) {
      // TODO: Buscar XML da API do Invoicy se nÃ£o estiver armazenado
      throw new NotFoundException('XML nÃ£o disponÃ­vel para esta NF-e');
    }

    return { xml: nfe.xmlAutorizado };
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
   * Se jÃ¡ existe um rascunho para esta ordem, retorna os dados dele.
   * Se nÃ£o existe, cria um novo com os dados do prepareFromOrder.
   */
  async createOrGetDraft(companyId: string, orderId: string) {
    const existingLinkedNfe = await this.prisma.nfe.findFirst({
      where: {
        companyId,
        status: { in: [NfeStatus.AUTHORIZED, NfeStatus.DRAFT] },
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
        existingLinkedNfe.status === NfeStatus.AUTHORIZED)
    ) {
      throw new BadRequestException(
        'Esta ordem ja esta vinculada a uma NF-e consolidada',
      );
    }

    // Verificar se jÃ¡ existe rascunho para esta ordem
    const existingDraft = await this.prisma.nfe.findFirst({
      where: {
        companyId,
        orderId,
        status: NfeStatus.DRAFT,
      },
    });

    // Se jÃ¡ existe rascunho, retornar dados preparados com dados do rascunho
    if (existingDraft) {
      const preparedData = await this.prepareFromOrder(companyId, orderId);
      const draftData = (existingDraft.draftData as Record<string, any>) || {};

      return {
        ...preparedData,
        draftId: existingDraft.id,
        isDraft: true,
        // Sobrescrever com dados do rascunho
        emissao: draftData.emissao
          ? { ...preparedData.emissao, ...draftData.emissao }
          : preparedData.emissao,
        destinatario: draftData.destinatario || preparedData.destinatario,
        items: (draftData.items || preparedData.items).map((item: any) => {
          const preparedItem = preparedData.items.find(
            (pi) => pi.productId === item.productId,
          );
          const quantity = item.quantity ?? 0;
          const unitValue = item.unitValue ?? 0;
          const discount = item.discount ?? 0;
          const freight = item.freight ?? 0;
          const insurance = item.insurance ?? 0;
          const totalValue = Number(
            (quantity * unitValue - discount + freight + insurance).toFixed(2),
          );
          return {
            ...item,
            totalValue: item.totalValue ?? totalValue,
            isService: preparedItem?.isService || false,
          };
        }),
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

    // Obter config para sÃ©rie e nÃºmero
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada.',
      );
    }

    // Criar novo rascunho
    const draft = await this.prisma.nfe.create({
      data: {
        companyId,
        orderId,
        quotationId: preparedData.quotationId,
        numero: config.proximoNumeroNfe || 1,
        serie: config.serieNfe || 1,
        status: NfeStatus.DRAFT,
        ambiente: config.ambiente || 2,
        valorTotal: preparedData.totais.valorNota,
        draftData: JSON.parse(
          JSON.stringify({
            destinatario: preparedData.destinatario,
            emissao: preparedData.emissao,
            items: preparedData.items,
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

      return {
        ...preparedData,
        draftId: existingDraft.id,
        isDraft: true,
        emissao: draftData.emissao
          ? { ...preparedData.emissao, ...draftData.emissao }
          : preparedData.emissao,
        destinatario: draftData.destinatario || preparedData.destinatario,
        items: (draftData.items || preparedData.items).map((item: any) => {
          const quantity = item.quantity ?? 0;
          const unitValue = item.unitValue ?? 0;
          const discount = item.discount ?? 0;
          const freight = item.freight ?? 0;
          const insurance = item.insurance ?? 0;
          const totalValue = Number(
            (quantity * unitValue - discount + freight + insurance).toFixed(2),
          );
          return {
            ...item,
            totalValue: item.totalValue ?? totalValue,
          };
        }),
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

    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuracao do Invoicy nao encontrada.');
    }

    const draft = await this.prisma.nfe.create({
      data: {
        companyId,
        orderId: preparedData.orderId,
        quotationId: preparedData.quotationId,
        numero: config.proximoNumeroNfe || 1,
        serie: config.serieNfe || 1,
        status: NfeStatus.DRAFT,
        ambiente: config.ambiente || 2,
        valorTotal: preparedData.totais.valorNota,
        draftData: JSON.parse(
          JSON.stringify({
            orderIds: uniqueOrderIds,
            orderCodes: preparedData.orderCodes,
            emissao: preparedData.emissao,
            destinatario: preparedData.destinatario,
            items: preparedData.items,
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
      throw new NotFoundException('Rascunho nÃ£o encontrado');
    }

    const existingDraftData = (draft.draftData as Record<string, any>) || {};

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
   * Deleta um rascunho (cancelar digitaÃ§Ã£o).
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
      throw new NotFoundException('Rascunho nÃ£o encontrado');
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
   * Inutiliza uma faixa de numeraÃ§Ã£o de NF-e na SEFAZ.
   */
  async inutilizar(companyId: string, dto: InutilizarNfeDto) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada.',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mÃ­nimo 15 caracteres',
      );
    }

    if (dto.numeroInicial > dto.numeroFinal) {
      throw new BadRequestException(
        'NÃºmero inicial deve ser menor ou igual ao nÃºmero final',
      );
    }

    const serie = dto.serie ?? config.serieNfe ?? 1;

    try {
      this.logger.log(
        `Inutilizando NF-e ${dto.numeroInicial} a ${dto.numeroFinal} (sÃ©rie ${serie}) para empresa ${companyId}`,
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
          response.Descricao || `Erro Invoicy: cÃ³digo ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isInutilized = situacao?.SitCodigo === 102;

      if (!isInutilized) {
        throw new Error(
          situacao?.SitDescricao || 'InutilizaÃ§Ã£o nÃ£o autorizada pela SEFAZ',
        );
      }

      return {
        success: true,
        message: `NumeraÃ§Ã£o ${dto.numeroInicial} a ${dto.numeroFinal} inutilizada com sucesso`,
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
   * Lista o histÃ³rico de cartas de correÃ§Ã£o de uma NF-e
   */
  async listCorrectionEvents(nfeId: string, companyId: string) {
    const nfe = await this.prisma.nfe.findFirst({
      where: { id: nfeId, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e nÃ£o encontrada');
    }

    const events = await this.prisma.nfeCorrectionEvent.findMany({
      where: { nfeId },
      orderBy: { sequenciaEvento: 'asc' },
      select: {
        id: true,
        sequenciaEvento: true,
        correcao: true,
        protocolo: true,
        dataEvento: true,
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
    // ValidaÃ§Ã£o de posse: a NF-e deve pertencer Ã  empresa
    const nfe = await this.prisma.nfe.findFirst({
      where: { id: nfeId, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e nÃ£o encontrada');
    }

    const event = await this.prisma.nfeCorrectionEvent.findFirst({
      where: { id: eventId, nfeId },
    });

    if (!event) {
      throw new NotFoundException('Evento de correÃ§Ã£o nÃ£o encontrado');
    }

    if (!event.xmlEvento) {
      throw new NotFoundException(
        'XML nÃ£o disponÃ­vel para este evento. O XML pode nÃ£o ter sido retornado pela Invoicy no momento do envio.',
      );
    }

    return { xml: event.xmlEvento, sequencia: event.sequenciaEvento };
  }

  async exportXml(
    companyId: string,
    startDate: string,
    endDate: string,
  ): Promise<Buffer> {
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate e endDate sÃ£o obrigatÃ³rios');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const nfes = await this.prisma.nfe.findMany({
      where: {
        companyId,
        status: 'AUTHORIZED',
        dataEmissao: { gte: start, lte: end },
        xmlAutorizado: { not: null },
      },
      select: {
        id: true,
        numero: true,
        serie: true,
        chaveAcesso: true,
        xmlAutorizado: true,
        dataEmissao: true,
      },
      orderBy: { numero: 'asc' },
    });

    if (nfes.length === 0) {
      throw new NotFoundException(
        'Nenhuma NF-e autorizada com XML encontrada no perÃ­odo',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JSZip = require('jszip');
    const zip = new JSZip();

    for (const nfe of nfes) {
      const filename = `NFe_${nfe.numero}_${nfe.chaveAcesso || nfe.id}.xml`;
      zip.file(filename, nfe.xmlAutorizado);
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    this.logger.log(
      `Exportados ${nfes.length} XMLs de NF-e para ZIP â€” empresa ${companyId}`,
    );

    return buffer;
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

    let ordersPromise = Promise.resolve([]);
    let nfeAvulsasPromise = Promise.resolve([]);
    let nfseAvulsasPromise = Promise.resolve([]);
    let nfceAvulsasPromise = Promise.resolve([]);

    let ordersCountPromise = Promise.resolve(0);
    let nfeCountPromise = Promise.resolve(0);
    let nfseCountPromise = Promise.resolve(0);
    let nfceCountPromise = Promise.resolve(0);

    const orderWhere: any = { quotation: { companyId } };
    const nfeWhere: any = { companyId, orderId: null, quotationId: null };
    const nfseWhere: any = { companyId, orderId: null, quotationId: null };
    const nfceWhere: any = { companyId, quotationId: null };

    if (filters.startDate || filters.endDate) {
      const createdAtFilter: any = {};
      if (filters.startDate) {
        createdAtFilter.gte = new Date(`${filters.startDate}T00:00:00.000Z`);
      }
      if (filters.endDate) {
        createdAtFilter.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
      }
      orderWhere.createdAt = createdAtFilter;
      nfeWhere.createdAt = createdAtFilter;
      nfseWhere.createdAt = createdAtFilter;
      nfceWhere.createdAt = createdAtFilter;
    }

    // Item 1: ObtÃ©m IDs de NF-es rejeitadas que jÃ¡ tÃªm versÃ£o autorizada posterior
    // com mesmo numero+serie para nÃ£o exibi-las em duplicidade
    const excludedRows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM nfes r
      WHERE r."companyId" = ${companyId}
        AND r.status = 'REJECTED'
        AND EXISTS (
          SELECT 1 FROM nfes a
          WHERE a."companyId" = r."companyId"
            AND a.numero = r.numero
            AND a.serie = r.serie
            AND a.status = 'AUTHORIZED'
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
                status: 'AUTHORIZED',
                ambiente: fiscalEnvironments.nfe,
              },
            },
          },
          {
            nfeOrders: {
              some: {
                nfe: {
                  status: 'AUTHORIZED',
                  ambiente: fiscalEnvironments.nfe,
                },
              },
            },
          },
          {
            nfses: {
              some: {
                status: NfseStatus.AUTHORIZED,
                ambiente: fiscalEnvironments.nfse,
              },
            },
          },
        ];
      } else if (status === 'EM_DIGITACAO') {
        orderWhere.OR = [
          {
            nfes: {
              some: { status: 'DRAFT', ambiente: fiscalEnvironments.nfe },
            },
          },
          {
            nfeOrders: {
              some: {
                nfe: { status: 'DRAFT', ambiente: fiscalEnvironments.nfe },
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
                ambiente: fiscalEnvironments.nfse,
              },
            },
          },
        ];
        orderWhere.AND = [
          {
            nfes: {
              none: {
                status: 'AUTHORIZED',
                ambiente: fiscalEnvironments.nfe,
              },
            },
          },
          {
            nfeOrders: {
              none: {
                nfe: {
                  status: 'AUTHORIZED',
                  ambiente: fiscalEnvironments.nfe,
                },
              },
            },
          },
          {
            nfses: {
              none: {
                status: NfseStatus.AUTHORIZED,
                ambiente: fiscalEnvironments.nfse,
              },
            },
          },
        ];
      } else if (status === 'NAO_EMITIDA') {
        orderWhere.AND = [
          {
            nfes: {
              none: {
                status: { in: ['AUTHORIZED', 'DRAFT'] },
                ambiente: fiscalEnvironments.nfe,
              },
            },
          },
          {
            nfeOrders: {
              none: {
                nfe: {
                  status: { in: ['AUTHORIZED', 'DRAFT'] },
                  ambiente: fiscalEnvironments.nfe,
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
                ambiente: fiscalEnvironments.nfse,
              },
            },
          },
        ];
        orderWhere.status = { not: 'CANCELED' };
      } else if (status === 'CANCELADA') {
        orderWhere.status = 'CANCELED';
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
        },
      });
      ordersCountPromise = this.prisma.order.count({ where: orderWhere });
    }

    if (recordType === 'TODOS' || recordType === 'NOTAS_AVULSAS') {
      if (includeNfe) {
        if (status === 'EMITIDA') nfeWhere.status = 'AUTHORIZED';
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

    const [
      orders,
      nfeAvulsas,
      nfseAvulsas,
      nfceAvulsas,
      ordersCount,
      nfeCount,
      nfseCount,
      nfceCount,
    ] = await Promise.all([
      ordersPromise,
      nfeAvulsasPromise,
      nfseAvulsasPromise,
      nfceAvulsasPromise,
      ordersCountPromise,
      nfeCountPromise,
      nfseCountPromise,
      nfceCountPromise,
    ]);

    const unifiedItems = [];

    for (const o of orders as any[]) {
      unifiedItems.push({
        type: 'ORDER',
        id: o.id,
        createdAt: o.createdAt,
        status: o.status,
        clientName: o.quotation?.client?.name || 'Cliente nÃ£o identificado',
        reference: o.quotation?.series?.code
          ? `${o.quotation.series.code}-${o.quotation.quotationNumber}`
          : `OS ${o.quotation?.quotationNumber || ''}`,
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
          'Avulsa s/ DestinatÃ¡rio',
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

    unifiedItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const startIndex = (page - 1) * limit;
    const paginatedItems = unifiedItems.slice(startIndex, startIndex + limit);

    const groupedItems = [];
    let currentDate = null;
    let currentGroup = null;

    for (const item of paginatedItems) {
      const dateStr = item.createdAt.toISOString().split('T')[0];
      if (dateStr !== currentDate) {
        if (currentGroup) groupedItems.push(currentGroup);
        currentDate = dateStr;
        currentGroup = { date: dateStr, items: [] };
      }
      currentGroup.items.push(item);
    }
    if (currentGroup) groupedItems.push(currentGroup);

    const totalCount =
      (ordersCount as number) +
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
