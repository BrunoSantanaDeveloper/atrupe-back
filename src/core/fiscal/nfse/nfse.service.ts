import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfseStatus } from '@prisma/client';
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

@Injectable()
export class NfseService {
  private readonly logger = new Logger(NfseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyApiService: InvoicyApiService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
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
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config);
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
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

  // Emitir NFS-e a partir de uma ordem de serviço (busca dados automaticamente)
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
        order: true,
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

    // Calcular valor total dos serviços — soma apenas itens com isService=true
    // IMPORTANTE: Valores no banco estão em centavos, dividir por 100 para reais
    const serviceProducts = quotation.quotationProduct.filter(
      (qp) => (qp.product as any)?.isService,
    );
    const valorServicos =
      serviceProducts.reduce(
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
        (quotation.quotationProduct[0]?.product as any)?.fiscalData
          ?.codigoServico ||
        config.codigoServico ||
        '',
      discriminacao: dto.discriminacao,
      codigoMunicipio: prestadorCmun,
      valorServicos,
      aliquotaIss:
        dto.aliquotaIss ||
        (quotation.quotationProduct[0]?.product as any)?.fiscalData
          ?.aliquotaIss ||
        config.aliquotaIss ||
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

    return this.emit(companyId, fullDto);
  }

  // Emitir NFS-e consolidada a partir de múltiplas ordens de serviço
  async emitFromOrders(companyId: string, dto: EmitNfseFromOrdersDto) {
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
        order: true,
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

    // Somar valorServicos apenas de itens com isService=true de todas as ordens
    const valorServicos =
      quotations.reduce((total, q) => {
        const serviceProducts = q.quotationProduct.filter(
          (qp) => (qp.product as any)?.isService,
        );
        return (
          total +
          serviceProducts.reduce(
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
      orderId: uniqueOrderIds[0],
      quotationId: quotations[0].id,
      dataCompetencia: new Date().toISOString().split('T')[0],
      naturezaOperacao: 1,
      codigoServico: dto.codigoServico || config.codigoServico || '',
      discriminacao: dto.discriminacao,
      codigoMunicipio: prestadorCmun,
      valorServicos,
      aliquotaIss: dto.aliquotaIss || config.aliquotaIss || 0,
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

  async emit(companyId: string, dto: EmitNfseDto) {
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
      this.fiscalCredentialResolver.resolveEnvironmentFromConfig(config);
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
    );

    if (!config.company.municipalRegistration) {
      throw new BadRequestException(
        'Inscrição Municipal não configurada. Necessária para emissão de NFS-e.',
      );
    }

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

    // Read current RPS number (will only increment after successful emission)
    const rpsNumero = config.proximoRpsNfse || 1;
    const rpsSerie = config.serieNfse || 'A1';

    // Calcular valores
    const valorServicos = dto.valorServicos;
    const valorDeducoes = dto.valorDeducoes || 0;
    const baseCalculo = valorServicos - valorDeducoes;
    const aliquotaIss = dto.aliquotaIss || config.aliquotaIss || 0;
    const valorIss = (baseCalculo * aliquotaIss) / 100;

    // Criar registro da NFS-e
    const nfse = await this.prisma.nfse.create({
      data: {
        companyId,
        orderId: dto.orderId,
        quotationId: dto.quotationId,
        numero: 0, // Será preenchido após retorno da prefeitura
        serie: rpsSerie,
        rpsNumero,
        rpsSerie,
        rpsTipo: 1,
        status: NfseStatus.PROCESSING,
        ambiente: environment === 'PRODUCAO' ? 1 : 2,
        dataCompetencia: new Date(dto.dataCompetencia),
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

    try {
      this.logger.log(
        `Emitindo NFS-e (RPS ${rpsNumero}) para empresa ${companyId}`,
      );

      // Função auxiliar para construir lista de itens
      const listaItens = dto.itens?.map((item, index) => ({
        ItemSeq: index + 1,
        ItemCod: item.codigo,
        ItemDesc: item.descricao,
        ItemQtde: item.quantidade,
        ItemvUnit: item.valorUnitario,
        ItemuMed: item.unidade || 'UN',
        ItemvlDed: 0,
        ItemTributavel: 'S',
        ItemTributMunicipio: parseInt(
          item.codigoServico || dto.codigoMunicipio || '0',
          10,
        ),
        ItemvIss:
          (item.quantidade *
            item.valorUnitario *
            (item.aliquotaIss || aliquotaIss)) /
          100,
        ItemAliquota: item.aliquotaIss || aliquotaIss,
        ItemVlrTotal: item.quantidade * item.valorUnitario,
        ItemBaseCalculo: item.quantidade * item.valorUnitario,
        ItemIssRetido: item.issRetido ? 1 : 2,
        ItemIteListServico: parseInt(
          config.codigoServico?.replace(/\D/g, '') || '0',
          10,
        ), // Usar código do serviço principal se não informado no item
        ItemExigibilidadeISS: 1, // Exigível
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
              natOp: dto.naturezaOperacao || 1, // 1 = Tributação no município
              Operacao: 1,
              RegEspTrib: 1, // 1 = Nenhum
              OptSN: config.emitCrt === 1 ? 1 : 2, // 1 = Sim, 2 = Não
              IncCult: 2, // 2 = Não
              Status: 1, // 1 = Normal
              tpAmb: environment === 'PRODUCAO' ? 1 : 2,
              Prestador: {
                CNPJ_prest: (config.company.cnpj || '').replace(/\D/g, ''),
                xNome: config.company.legalName || '',
                xFant: config.company.name || '',
                IM: (config.company.municipalRegistration || '').replace(
                  /\D/g,
                  '',
                ),
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
                  ISSRetido: dto.issRetido ? 1 : 2, // 1 = Sim, 2 = Não
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
                        SerEndcMun:
                          parseInt(dto.entregaCodigoMunicipio || '0', 10) || 0,
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

      // Chamar API do Invoicy
      const invoicyResponses = await this.invoicyApiService.emitNfse(
        companyId,
        [invoicyRequest],
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
        },
      });

      if (!isAuthorized) {
        throw new BadRequestException(
          `NFS-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}`,
        );
      }

      // Increment RPS number only after successful emission
      await this.invoicyService.incrementNfseRpsNumber(config.id);

      return updatedNfse;
    } catch (error) {
      // Atualizar status para rejeitado em caso de erro
      await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          status: NfseStatus.REJECTED,
          motivoRejeicao: error.message,
        },
      });

      this.logger.error(`Erro ao emitir NFS-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao emitir NFS-e: ${error.message}`);
    }
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
      // TODO: Buscar PDF da API do Invoicy se não estiver armazenado
      throw new NotFoundException('PDF não disponível para esta NFS-e');
    }

    return { url: nfse.pdfUrl };
  }

  async getXml(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    if (!nfse.xmlRetorno) {
      // TODO: Buscar XML da API do Invoicy se não estiver armazenado
      throw new NotFoundException('XML não disponível para esta NFS-e');
    }

    return { xml: nfse.xmlRetorno };
  }
}
