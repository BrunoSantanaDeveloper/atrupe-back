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
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { MailService } from '../../mail/mail.service';

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
  ) {}

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
      throw new NotFoundException('NFS-e nÃ£o encontrada');
    }

    return nfse;
  }

  // Preparar dados para emissÃ£o de NFS-e avulsa (sem ordem de serviÃ§o)
  async prepareStandalone(companyId: string, clientId?: string) {
    // Buscar configuraÃ§Ã£o do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada. Configure a integraÃ§Ã£o primeiro.',
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

    // Dados do tomador (vazio por padrÃ£o)
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

      tomador = {
        cnpj: (client as any).cnpj || undefined,
        cpf: (client as any).cpf || undefined,
        razaoSocial: (client as any).corporateName || client.name || '',
        endereco: clientAddress?.street || '',
        numero: clientAddress?.number || 'S/N',
        complemento: clientAddress?.complement || '',
        bairro: clientAddress?.neighborhood || '',
        cep: clientAddress?.zipcode || '',
        codigoMunicipio: '', // SerÃ¡ preenchido pelo usuÃ¡rio ou na emissÃ£o
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

      // RPS
      rpsNumero: config.proximoRpsNfse || 1,
      rpsSerie: config.serieNfse || 'A1',

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

  // Emitir NFS-e a partir de uma ordem de serviÃ§o (busca dados automaticamente)
  async emitFromOrder(companyId: string, dto: EmitNfseFromOrderDto) {
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
      throw new NotFoundException('Ordem de serviÃ§o nÃ£o encontrada');
    }

    this.assertOrdersCanReceiveNfse([quotation.order as any]);

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

    // Garantir cÃ³digo IBGE do PRESTADOR (empresa emissora)
    let prestadorCmun = config.ibgeCode || '';
    const emitCep = config.company?.address?.zipcode;

    if (!prestadorCmun && emitCep) {
      this.logger.log(
        `Prestador sem cÃ³digo IBGE configurado. Buscando via CEP: ${emitCep}`,
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
          `NÃ£o foi possÃ­vel encontrar IBGE para CEP do prestador: ${emitCep}`,
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

    // Local de prestaÃ§Ã£o / entrega
    const selectedEntregaAddress = dto.addressId
      ? client.address?.find((a: any) => a.id === dto.addressId)
      : null;
    // Se o usuÃ¡rio especificou addressId ou manual, usamos. Caso contrÃ¡rio, usamos a entrega da OS se existente
    const entregaAddress =
      selectedEntregaAddress ||
      (dto.entregaEndereco
        ? null
        : (quotation as any).deliveryInfo?.clientAddress);

    // Campos do tomador: usa override do DTO quando fornecido, senÃ£o usa cadastro do cliente
    const tomadorCepFinal = dto.tomadorCep || clientAddress?.zipcode || '';
    const tomadorEnderecoFinal =
      dto.tomadorEndereco ?? clientAddress?.street ?? '';

    // Buscar cÃ³digo IBGE do municÃ­pio do tomador via CEP
    let tomadorCmun = '';
    let tomadorMunicipio = dto.tomadorMunicipio || clientAddress?.city || '';
    let tomadorUf = dto.tomadorUf || clientAddress?.state || '';

    if (tomadorCepFinal) {
      this.logger.log(
        `Buscando cÃ³digo IBGE para CEP do tomador: ${tomadorCepFinal}`,
      );
      const cepData = await fetchCepData(tomadorCepFinal);
      if (cepData) {
        tomadorCmun = cepData.codigoIbge;
        if (!dto.tomadorMunicipio) tomadorMunicipio = cepData.cidade;
        if (!dto.tomadorUf) tomadorUf = cepData.uf;
        this.logger.log(
          `CÃ³digo IBGE do tomador: ${tomadorCmun} (${tomadorMunicipio}/${tomadorUf})`,
        );
      } else {
        this.logger.warn(`CEP do tomador nÃ£o encontrado: ${tomadorCepFinal}`);
      }
    } else {
      this.logger.warn('Tomador sem CEP cadastrado');
    }

    // Buscar cÃ³digo IBGE do local de prestaÃ§Ã£o (entrega) se aplicÃ¡vel
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
          `Buscando cÃ³digo IBGE para CEP de prestaÃ§Ã£o: ${entregaCep}`,
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
      naturezaOperacao: 1, // TributaÃ§Ã£o no municÃ­pio
      codigoServico:
        dto.codigoServico ||
        (quotation.quotationProduct[0]?.product as any)?.fiscalData
          ?.codigoServico ||
        config.codigoServico ||
        '',
      discriminacao: dto.discriminacao,
      codigoMunicipio: prestadorCmun,
      valorServicos,
      aliquotaIss:
        dto.aliquotaIss ??
        (quotation.quotationProduct[0]?.product as any)?.fiscalData
          ?.aliquotaIss ??
        config.aliquotaIss ??
        0,
      issRetido: dto.issRetido || false,
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

    // Validar dados obrigatÃ³rios
    if (!fullDto.tomador.razaoSocial) {
      throw new BadRequestException('Cliente nÃ£o possui nome cadastrado');
    }
    if (!fullDto.codigoMunicipio) {
      throw new BadRequestException(
        'CÃ³digo do municÃ­pio do prestador nÃ£o configurado. Verifique a configuraÃ§Ã£o fiscal do emissor.',
      );
    }
    if (!fullDto.tomador.codigoMunicipio) {
      throw new BadRequestException(
        'CÃ³digo do municÃ­pio do tomador nÃ£o encontrado. Verifique o CEP cadastrado para o cliente.',
      );
    }

    return this.emit(companyId, fullDto);
  }

  // Emitir NFS-e consolidada a partir de mÃºltiplas ordens de serviÃ§o
  async emitFromOrders(companyId: string, dto: EmitNfseFromOrdersDto) {
    const uniqueOrderIds = [...new Set(dto.orderIds.filter(Boolean))];

    if (uniqueOrderIds.length < 2) {
      throw new BadRequestException(
        'Selecione ao menos duas ordens para consolidar a NFS-e',
      );
    }

    // Buscar todas as cotaÃ§Ãµes de uma vez
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
        'Uma ou mais ordens de serviÃ§o nÃ£o foram encontradas',
      );
    }

    this.assertOrdersCanReceiveNfse(
      quotations.map((quotation) => quotation.order as any),
    );

    // Validar que todas as OS sÃ£o do mesmo cliente
    const clientIds = [...new Set(quotations.map((q) => q.clientId))];
    if (clientIds.length > 1) {
      throw new BadRequestException(
        'Todas as ordens devem pertencer ao mesmo cliente para consolidar a NFS-e',
      );
    }

    // Buscar configuraÃ§Ã£o do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'ConfiguraÃ§Ã£o do Invoicy nÃ£o encontrada. Configure a integraÃ§Ã£o primeiro.',
      );
    }

    // CÃ³digo IBGE do prestador
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

    // Tomador: cliente da primeira ordem (ou overrides do DTO)
    const client = quotations[0].client;
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
          `CEP do tomador nÃ£o encontrado na NFS-e consolidada: ${tomadorCepFinal}`,
        );
      }
    }

    // Local de entrega/prestaÃ§Ã£o
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

    // CÃ³digos das OS para anotaÃ§Ã£o
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
      orderId: uniqueOrderIds[0],
      quotationId: quotations[0].id,
      dataCompetencia: new Date().toISOString().split('T')[0],
      naturezaOperacao: 1,
      codigoServico: dto.codigoServico || config.codigoServico || '',
      discriminacao: dto.discriminacao,
      codigoMunicipio: prestadorCmun,
      valorServicos,
      aliquotaIss: dto.aliquotaIss ?? config.aliquotaIss ?? 0,
      issRetido: dto.issRetido || false,
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
      throw new BadRequestException('Cliente nÃ£o possui nome cadastrado');
    }
    if (!fullDto.codigoMunicipio) {
      throw new BadRequestException(
        'CÃ³digo do municÃ­pio do prestador nÃ£o configurado. Verifique a configuraÃ§Ã£o fiscal do emissor.',
      );
    }
    if (!fullDto.tomador.codigoMunicipio) {
      throw new BadRequestException(
        'CÃ³digo do municÃ­pio do tomador nÃ£o encontrado. Verifique o CEP cadastrado para o cliente.',
      );
    }

    const nfse = await this.emit(companyId, fullDto);

    // Guardar todos os orderIds no draftData para referÃªncia
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

  async emit(companyId: string, dto: EmitNfseDto) {
    if (dto.orderId) {
      const linkedOrder = await this.prisma.order.findFirst({
        where: {
          id: dto.orderId,
          quotation: { companyId },
        },
        include: this.orderFiscalInclude(),
      });

      if (!linkedOrder) {
        throw new NotFoundException('Ordem de serviÃ§o nÃ£o encontrada');
      }

      this.assertOrdersCanReceiveNfse([linkedOrder as any]);

      if (dto.quotationId && linkedOrder.quotationId !== dto.quotationId) {
        throw new BadRequestException(
          'A ordem de serviÃ§o informada nÃ£o pertence ao orÃ§amento enviado.',
        );
      }
    }

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
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
        config,
        'NFSE',
      );
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFSE',
    );

    // Se houver endereÃ§o de entrega (local de prestaÃ§Ã£o) e nÃ£o houver cÃ³digo de municÃ­pio, resolver via CEP
    if (dto.entregaEndereco && !dto.entregaCodigoMunicipio) {
      if (!dto.entregaCep) {
        throw new BadRequestException(
          'CEP de entrega Ã© obrigatÃ³rio quando o endereÃ§o de entrega (local de prestaÃ§Ã£o) Ã© informado.',
        );
      }
      this.logger.log(
        `Buscando cÃ³digo IBGE do local de prestaÃ§Ã£o/entrega via CEP: ${dto.entregaCep}`,
      );
      const cepData = await fetchCepData(dto.entregaCep);
      if (!cepData || !cepData.codigoIbge) {
        throw new BadRequestException(
          `NÃ£o foi possÃ­vel localizar o cÃ³digo IBGE para o CEP de entrega/prestaÃ§Ã£o informado: ${dto.entregaCep}. Verifique o CEP ou digite o cÃ³digo do municÃ­pio manualmente.`,
        );
      }
      dto.entregaCodigoMunicipio = cepData.codigoIbge;
      if (!dto.entregaMunicipio) dto.entregaMunicipio = cepData.cidade;
      if (!dto.entregaUf) dto.entregaUf = cepData.uf;
      this.logger.log(
        `IBGE do local de prestaÃ§Ã£o resolvido: ${dto.entregaCodigoMunicipio}`,
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

    // Calcular valores
    const valorServicos = dto.valorServicos;
    const valorDeducoes = dto.valorDeducoes || 0;
    const baseCalculo = valorServicos - valorDeducoes;
    // `??` e não `||`: alíquota 0 é legítima (serviço isento/imune) e não pode
    // cair no fallback. Se nada estiver configurado, falha fechada em vez de
    // emitir ISS zerado silenciosamente.
    const aliquotaIss = dto.aliquotaIss ?? config.aliquotaIss;
    if (aliquotaIss === null || aliquotaIss === undefined) {
      throw new BadRequestException(
        'Alíquota de ISS não resolvida. Informe a alíquota na emissão ou ' +
          'configure a alíquota padrão em Configurações > Emissores.',
      );
    }
    const valorIss = (baseCalculo * aliquotaIss) / 100;

    this.assertNfsePayloadReady(dto, valorServicos, valorDeducoes, baseCalculo);

    const { nfse, rpsNumero, rpsSerie } = await this.prisma.$transaction(
      async (tx) => {
        const reserved = await this.reserveNfseRps(tx, config.id);

        const nfse = await tx.nfse.create({
          data: {
            companyId,
            invoicyConfigId: config.id,
            orderId: dto.orderId,
            quotationId: dto.quotationId,
            numero: 0, // SerÃ¡ preenchido apÃ³s retorno da prefeitura
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

      // FunÃ§Ã£o auxiliar para construir lista de itens
      const listaItens = dto.itens?.map((item, index) => ({
        ItemSeq: index + 1,
        ItemCod: item.codigo,
        ItemDesc: item.descricao,
        ItemQtde: item.quantidade,
        ItemvUnit: item.valorUnitario,
        ItemuMed: item.unidade || 'UN',
        ItemvlDed: 0,
        ItemTributavel: 'S',
        // Município de incidência do ISS — NÃO é o código de serviço.
        ItemTributMunicipio: parseInt(
          dto.codigoMunicipio || config.ibgeCode || '0',
          10,
        ),
        ItemvIss:
          (item.quantidade *
            item.valorUnitario *
            (item.aliquotaIss ?? aliquotaIss)) /
          100,
        // `??` e não `||`: alíquota 0 é legítima (serviço isento/imune).
        ItemAliquota: item.aliquotaIss ?? aliquotaIss,
        ItemVlrTotal: item.quantidade * item.valorUnitario,
        ItemBaseCalculo: item.quantidade * item.valorUnitario,
        ItemIssRetido: item.issRetido ? 1 : 2,
        // Código da lista de serviços LC 116 do item; cai para o do emissor.
        ItemIteListServico: parseInt(
          (item.codigoServico || config.codigoServico || '').replace(
            /\D/g,
            '',
          ) || '0',
          10,
        ),
        ItemExigibilidadeISS: 1, // ExigÃ­vel
        ItemcMunIncidencia: parseInt(
          dto.codigoMunicipio || config.ibgeCode || '0',
          10,
        ),
      })) || [
        {
          ItemSeq: 1,
          ItemCod: 'SERV',
          ItemDesc: dto.discriminacao.substring(0, 100), // Invoicy pode ter limite
          ItemQtde: 1,
          ItemvUnit: valorServicos,
          ItemuMed: 'SV',
          ItemvlDed: valorDeducoes,
          ItemTributavel: 'S',
          ItemTributMunicipio: parseInt(
            dto.codigoMunicipio || config.ibgeCode || '0',
            10,
          ),
          ItemvIss: valorIss,
          ItemAliquota: aliquotaIss,
          ItemVlrTotal: valorServicos,
          ItemBaseCalculo: baseCalculo,
          ItemIssRetido: dto.issRetido ? 1 : 2,
          ItemIteListServico: parseInt(
            dto.codigoServico.replace(/\D/g, ''),
            10,
          ),
          ItemExigibilidadeISS: 1,
          ItemcMunIncidencia: parseInt(
            dto.codigoMunicipio || config.ibgeCode || '0',
            10,
          ),
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
              dCompetencia: new Date(dto.dataCompetencia).toISOString(),
              LocalPrestServ:
                dto.entregaCodigoMunicipio &&
                dto.entregaCodigoMunicipio !==
                  (config.ibgeCode || config.emitCmun)
                  ? 2
                  : 1,
              natOp: dto.naturezaOperacao || 1, // 1 = TributaÃ§Ã£o no municÃ­pio
              Operacao: 1,
              RegEspTrib: 1, // 1 = Nenhum
              // OptSN Invoicy: 1=Não optante→opSimpNac:3, 2=ME→opSimpNac:1, 3=EPP→opSimpNac:2
              OptSN: config.emitCrt === 1 ? 2 : 1,
              // regApuracaoSN: obrigatório quando opSimpNac=1(ME) ou 2(EPP); 1=Competência
              ...(config.emitCrt === 1 ? { RegApuracaoSN: 1 } : {}),
              IncCult: 2, // 2 = NÃ£o
              Status: 1, // 1 = Normal
              tpAmb: environment === 'PRODUCAO' ? 1 : 2,
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
                  ValPIS: dto.valorPis || 0,
                  ValCOFINS: dto.valorCofins || 0,
                  ValINSS: dto.valorInss || 0,
                  ValIR: dto.valorIr || 0,
                  ValCSLL: dto.valorCsll || 0,
                  ISSRetido: dto.issRetido ? 1 : 2, // 1 = Sim, 2 = NÃ£o
                  ValISS: valorIss,
                  ValOutrasRetencoes: 0,
                  ValBaseCalculo: baseCalculo,
                  ValAliqISS: aliquotaIss,
                },
                IteListServico: parseInt(
                  dto.codigoServico.replace(/\D/g, ''),
                  10,
                ),
                Discriminacao: dto.discriminacao,
                cMun: parseInt(
                  dto.codigoMunicipio || config.ibgeCode || '0',
                  10,
                ),
                TributMunicipio: parseInt(
                  dto.codigoMunicipio || config.ibgeCode || '0',
                  10,
                ),
                ...(dto.entregaEndereco
                  ? {
                      LocalPrestacao: {
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
                          parseInt(
                            (dto.entregaCep || '').replace(/\D/g, ''),
                            10,
                          ) || 0,
                        SerEndSiglaUF: dto.entregaUf || '',
                      },
                    }
                  : {}),
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

      let response = await this.sendNfseToInvoicy(companyId, invoicyRequest);

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
        response = await this.sendNfseToInvoicy(companyId, invoicyRequest);
      }

      if (this.shouldRetryNfseWithRegApuracao(response)) {
        // Prefeitura exige RegApuracao quando a empresa é optante do Simples Nacional.
        // config.emitCrt pode estar nulo em alguns emissores (campo não configurado),
        // mas a prefeitura ainda identifica a empresa como SN pelos seus registros.
        this.addRegApuracaoToNfseRequest(invoicyRequest);
        this.logger.warn(
          `Prefeitura rejeitou a NFS-e ${nfse.id} com E0166 (RegApuracao ausente). Reenviando RPS ${rpsNumero}/${rpsSerie} com RegApuracao=1.`,
        );
        response = await this.sendNfseToInvoicy(companyId, invoicyRequest);
      }

      // Reescreve o snapshot com o payload final — os retries acima mutam o
      // objeto, e o que interessa rastrear é o que a prefeitura recebeu.
      await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: { invoicyPayloadEnvio: invoicyRequest as any },
      });

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: cÃ³digo ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      if (!doc) {
        throw new Error('Documento nÃ£o retornado pelo Invoicy');
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
      const isUnknownOutcome =
        !(error instanceof BadRequestException) &&
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
          'Falha de comunicaÃ§Ã£o com o Invoicy. A NFS-e ficou em processamento com resultado desconhecido; consulte o status antes de reemitir.',
        );
      }

      throw new BadRequestException(`Erro ao emitir NFS-e: ${motivoRejeicao}`);
    }
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
        where: { status: { in: this.activeNfseStatuses } },
        select: { id: true, status: true },
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
  ) {
    const invoicyResponses = await this.invoicyApiService.emitNfse(companyId, [
      invoicyRequest,
    ]);

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

  private addRegApuracaoToNfseRequest(
    invoicyRequest: InvoicyNfseRequest,
  ): void {
    const rps = invoicyRequest.Documento.RPS?.[0] as any;
    if (rps && rps.RegApuracaoSN === undefined) {
      rps.RegApuracaoSN = 1; // 1 = Compet\u00eancia (DPS NFS-e Nacional: regApuracaoSN)
      rps.OptSN = 2; // 2=ME no Invoicy \u2192 opSimpNac:1 no DPS; empresa \u00e9 SN optante
    }
  }

  private assertOrdersCanReceiveNfse(orders: any[]) {
    for (const order of orders) {
      if (!order) {
        throw new NotFoundException('Ordem de serviÃ§o nÃ£o encontrada');
      }

      if (order.status === OrderStatus.CANCELED) {
        throw new BadRequestException(
          'NÃ£o Ã© possÃ­vel emitir NFS-e para uma ordem de serviÃ§o cancelada.',
        );
      }

      if (
        order.nfes?.length > 0 ||
        order.nfeOrders?.length > 0 ||
        order.nfses?.length > 0 ||
        order.nfces?.length > 0
      ) {
        throw new ConflictException(
          'Esta ordem de serviÃ§o jÃ¡ possui documento fiscal ativo ou autorizado.',
        );
      }
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
        'Valor dos serviÃ§os deve ser maior que zero.',
      );
    }

    if (valorDeducoes < 0 || baseCalculo < 0) {
      throw new BadRequestException(
        'Valor das deduÃ§Ãµes nÃ£o pode exceder o valor dos serviÃ§os.',
      );
    }

    if (!codigoServicoDigits || Number(codigoServicoDigits) <= 0) {
      throw new BadRequestException(
        'CÃ³digo do serviÃ§o municipal Ã© obrigatÃ³rio para emitir NFS-e.',
      );
    }

    if (!prestadorMunicipio || Number(prestadorMunicipio) <= 0) {
      throw new BadRequestException(
        'CÃ³digo IBGE do municÃ­pio do prestador Ã© obrigatÃ³rio para emitir NFS-e.',
      );
    }

    if (!tomadorMunicipio || Number(tomadorMunicipio) <= 0) {
      throw new BadRequestException(
        'CÃ³digo IBGE do municÃ­pio do tomador Ã© obrigatÃ³rio para emitir NFS-e.',
      );
    }

    if (!dto.tomador?.razaoSocial?.trim()) {
      throw new BadRequestException(
        'RazÃ£o social do tomador Ã© obrigatÃ³ria.',
      );
    }

    if (
      !dto.tomador?.idEstrangeiro &&
      cnpj.length !== 14 &&
      cpf.length !== 11
    ) {
      throw new BadRequestException(
        'Informe CPF ou CNPJ vÃ¡lido para o tomador da NFS-e.',
      );
    }
  }

  private async reserveNfseRps(
    tx: any,
    invoicyConfigId: string,
  ): Promise<{ rpsNumero: number; rpsSerie: string }> {
    const configs = await tx.$queryRaw<any[]>`
      SELECT id, "proximoRpsNfse", "serieNfse"
      FROM invoicy_configs
      WHERE id = ${invoicyConfigId}
      FOR UPDATE
    `;
    const config = configs[0];

    if (!config) {
      throw new NotFoundException(
        `Emissor fiscal ${invoicyConfigId} nÃ£o encontrado`,
      );
    }

    const rpsNumero = config.proximoRpsNfse ?? 1;
    const rpsSerie = config.serieNfse || 'A1';

    await tx.$executeRaw`
      UPDATE invoicy_configs
      SET "proximoRpsNfse" = ${rpsNumero + 1}
      WHERE id = ${invoicyConfigId}
    `;

    return { rpsNumero, rpsSerie };
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
        'A justificativa deve ter no mÃ­nimo 15 caracteres',
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
          response.Descricao || `Erro Invoicy: cÃ³digo ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isCancelled = situacao?.SitCodigo === 101; // Cancelamento autorizado

      if (!isCancelled) {
        throw new Error(
          situacao?.SitDescricao ||
            'Cancelamento nÃ£o autorizado pela Prefeitura',
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

  async consultStatus(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    try {
      // TODO: Implementar consulta real ao status da NFS-e na prefeitura via Invoicy
      this.logger.log(`Consultando status da NFS-e ${nfse.numero}`);

      return {
        id: nfse.id,
        numero: nfse.numero,
        serie: nfse.serie,
        rpsNumero: nfse.rpsNumero,
        rpsSerie: nfse.rpsSerie,
        status: nfse.status,
        codigoVerificacao: nfse.codigoVerificacao,
        protocolo: nfse.protocolo,
        dataEmissao: nfse.dataEmissao,
        valorServicos: nfse.valorServicos,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status da NFS-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao consultar status da NFS-e: ${error.message}`,
      );
    }
  }

  async getPdfUrl(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    if (!nfse.pdfUrl) {
      // TODO: Buscar PDF da API do Invoicy se nÃ£o estiver armazenado
      throw new NotFoundException('PDF nÃ£o disponÃ­vel para esta NFS-e');
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
