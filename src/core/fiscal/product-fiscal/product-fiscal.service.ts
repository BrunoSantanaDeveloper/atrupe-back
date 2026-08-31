import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateProductFiscalDataDto,
  UpdateProductFiscalDataDto,
  ProductStRuleDto,
} from './dtos/product-fiscal.dto';
import {
  validateCnae,
  validateCodigoServico,
  validateNcm,
  formatNcm,
} from '../utils/fiscal-validators';

/** Pendência de cadastro que impede ou compromete a emissão de NFS-e. */
export interface PendenciaFiscal {
  campo: string;
  gravidade: 'bloqueia' | 'atencao';
  mensagem: string;
  valorAtual?: string | null;
}

@Injectable()
export class ProductFiscalService {
  private readonly logger = new Logger(ProductFiscalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Avalia o cadastro fiscal de um serviço e devolve suas pendências.
   * Extraído para ser reutilizado pela conferência da emissão, que precisa
   * avaliar só os serviços da ordem em vez da empresa inteira.
   */
  avaliarCadastroFiscal(fiscalData: any): PendenciaFiscal[] {
    const pendencias: PendenciaFiscal[] = [];

    const codigoServico = fiscalData?.codigoServico?.trim();
    if (!codigoServico) {
      pendencias.push({
        campo: 'codigoServico',
        gravidade: 'bloqueia',
        mensagem:
          'Sem código da LC 116. A emissão usa o código padrão do emissor, ' +
          'que pode não corresponder a este serviço.',
        valorAtual: null,
      });
    } else {
      const check = validateCodigoServico(codigoServico);
      if (!check.valid) {
        pendencias.push({
          campo: 'codigoServico',
          gravidade: 'bloqueia',
          mensagem: check.message,
          valorAtual: codigoServico,
        });
      }
    }

    const cnae = fiscalData?.cnae?.trim();
    if (cnae) {
      const check = validateCnae(cnae);
      if (!check.valid) {
        pendencias.push({
          campo: 'cnae',
          gravidade: 'bloqueia',
          mensagem: check.message,
          valorAtual: cnae,
        });
      }
    }

    if (
      fiscalData?.aliquotaIss === null ||
      fiscalData?.aliquotaIss === undefined
    ) {
      pendencias.push({
        campo: 'aliquotaIss',
        gravidade: 'atencao',
        mensagem:
          'Sem alíquota de ISS. A emissão cai na alíquota padrão do emissor.',
        valorAtual: null,
      });
    }

    // Reforma Tributária: exigidos do Simples Nacional a partir de 2027.
    // Ver docs/fiscal/nfse-reforma-tributaria.md.
    for (const [campo, rotulo] of [
      ['nbs', 'NBS'],
      ['codTribNacional', 'código de tributação nacional'],
    ] as const) {
      if (!fiscalData?.[campo]?.trim()) {
        pendencias.push({
          campo,
          gravidade: 'atencao',
          mensagem: `Sem ${rotulo}. Exigido do Simples Nacional a partir de 01/01/2027.`,
          valorAtual: null,
        });
      }
    }

    return pendencias;
  }

  /**
   * Lista serviços com cadastro fiscal incompleto ou inválido.
   *
   * Motivação: a base tem serviços sem código LC 116 (a emissão cai no código
   * padrão do emissor, que pode não corresponder ao serviço) e campos CNAE com
   * conteúdo que não é CNAE. O problema só aparecia na hora de emitir, com a
   * nota já rejeitada pela prefeitura.
   *
   * `bloqueia` = a emissão sai errada ou é recusada; `atencao` = a nota sai,
   * mas sem informação que a Reforma Tributária vai exigir do Simples Nacional
   * a partir de 01/01/2027.
   */
  async listarPendenciasFiscais(companyId: string) {
    const servicos = await this.prisma.product.findMany({
      where: { companyId, isService: true },
      select: { id: true, name: true, code: true, fiscalData: true },
      orderBy: { name: 'asc' },
    });

    const itens = servicos
      .map((servico) => ({
        produtoId: servico.id,
        nome: servico.name,
        codigo: servico.code,
        temCadastroFiscal: !!servico.fiscalData,
        pendencias: this.avaliarCadastroFiscal(servico.fiscalData),
      }))
      .filter((item) => item.pendencias.length > 0);

    return {
      totalServicos: servicos.length,
      comPendencia: itens.length,
      bloqueiamEmissao: itens.filter((i) =>
        i.pendencias.some((p) => p.gravidade === 'bloqueia'),
      ).length,
      itens,
    };
  }

  async findByProductId(productId: string) {
    const fiscalData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
      include: {
        product: true,
      },
    });

    return fiscalData;
  }

  async create(dto: CreateProductFiscalDataDto) {
    // Verificar se o produto existe
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    // Verificar se já existe dados fiscais para o produto
    const existing = await this.prisma.productFiscalData.findUnique({
      where: { productId: dto.productId },
    });

    const data = this.mapDtoToData(dto);

    if (existing) {
      // Se já existe, atualiza
      return this.prisma.productFiscalData.update({
        where: { productId: dto.productId },
        data,
      });
    }

    return this.prisma.productFiscalData.create({
      data: {
        product: { connect: { id: dto.productId } },
        ...data,
      },
    });
  }

  async update(productId: string, dto: UpdateProductFiscalDataDto) {
    const fiscalData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    if (!fiscalData) {
      throw new NotFoundException(
        'Dados fiscais não encontrados para este produto',
      );
    }

    const data = this.mapDtoToData(dto);

    return this.prisma.productFiscalData.update({
      where: { productId },
      data,
    });
  }

  async upsert(dto: CreateProductFiscalDataDto) {
    // Verificar se o produto existe
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    const data = this.mapDtoToData(dto);

    return this.prisma.productFiscalData.upsert({
      where: { productId: dto.productId },
      create: {
        product: { connect: { id: dto.productId } },
        ...data,
      },
      update: data,
    });
  }

  /**
   * Aplica um NCM a vários produtos de uma vez.
   *
   * Existe porque corrigir NCM produto a produto não escala: uma base recém
   * migrada tem dezenas de produtos com o NCM padrão herdado que precisam do
   * código correto, e a emissão só falha quando a nota já foi montada.
   *
   * Escopo por empresa: IDs de outra empresa (ou inexistentes) são ignorados em
   * silêncio e devolvidos apenas como contagem em `ignored` — o controller não
   * tem TenantGuard e o filtro por companyId aqui é a única barreira.
   *
   * Produto sem cadastro fiscal recebe um registro novo com os mesmos defaults
   * de getOrCreateWithDefaults, trocando só o NCM pelo informado. Produto que já
   * tem cadastro tem SOMENTE o ncm alterado — CFOP, CSTs e alíquotas ajustados
   * pelo usuário são preservados.
   */
  async bulkUpdateNcm(companyId: string, productIds: string[], ncm: string) {
    const check = validateNcm(ncm);
    if (!check.valid) {
      throw new BadRequestException(check.message);
    }

    const cleanNcm = formatNcm(ncm);

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, fiscalData: { select: { id: true } } },
    });

    if (products.length === 0) {
      throw new NotFoundException(
        'Nenhum produto encontrado para aplicar o NCM.',
      );
    }

    const idsWithFiscalData = products
      .filter((product) => product.fiscalData)
      .map((product) => product.id);
    const idsWithoutFiscalData = products
      .filter((product) => !product.fiscalData)
      .map((product) => product.id);

    const defaults = await this.getCompanyFiscalDefaults(companyId);

    // Duas queries em lote em vez de uma operação por produto: a transação
    // fecha rápido mesmo no teto de BULK_NCM_MAX_PRODUCTS itens.
    const [updateResult, createResult] = await this.prisma.$transaction([
      this.prisma.productFiscalData.updateMany({
        where: { productId: { in: idsWithFiscalData } },
        data: { ncm: cleanNcm },
      }),
      this.prisma.productFiscalData.createMany({
        data: idsWithoutFiscalData.map((productId) => ({
          productId,
          ncm: cleanNcm,
          cfopInState: defaults.defaultCfop || '5101',
          cfopOutState: '6101',
          commercialUnit: 'UN',
          icmsOrigin: '0',
          icmsCst: '102',
          pisCst: '99',
          cofinsCst: '99',
        })),
        skipDuplicates: true,
      }),
    ]);

    const ignored = productIds.length - products.length;

    this.logger.log(
      `Bulk NCM ${cleanNcm} na empresa ${companyId}: ` +
        `${updateResult.count} atualizados, ${createResult.count} criados, ` +
        `${ignored} ignorados.`,
    );

    return {
      ncm: cleanNcm,
      updated: updateResult.count,
      created: createResult.count,
      ignored,
    };
  }

  async delete(productId: string) {
    const fiscalData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    if (!fiscalData) {
      throw new NotFoundException(
        'Dados fiscais não encontrados para este produto',
      );
    }

    return this.prisma.productFiscalData.delete({
      where: { productId },
    });
  }

  async findManyByProductIds(productIds: string[]) {
    return this.prisma.productFiscalData.findMany({
      where: {
        productId: { in: productIds },
      },
    });
  }

  /**
   * Get existing ProductFiscalData or create with company defaults.
   * Ensures every product always has fiscal data available for NF-e emission.
   *
   * @param productId - The product ID
   * @param companyId - The company ID (used to look up InvoicyConfig defaults)
   */
  async getOrCreateWithDefaults(productId: string, companyId: string) {
    // Check if ProductFiscalData already exists
    const existing = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    if (existing) return existing;

    // Get company's fiscal defaults from InvoicyConfig
    const config = await this.getCompanyFiscalDefaults(companyId);

    // Create with defaults
    const created = await this.prisma.productFiscalData.create({
      data: {
        product: { connect: { id: productId } },
        ncm: config.defaultNcm || '49119900',
        cfopInState: config.defaultCfop || '5101',
        cfopOutState: '6101',
        commercialUnit: 'UN',
        icmsOrigin: '0',
        icmsCst: '102',
        pisCst: '99',
        cofinsCst: '99',
      },
    });

    this.logger.log(
      `Created fiscal data with defaults for product ${productId} (NCM: ${created.ncm})`,
    );

    return created;
  }

  /**
   * Get company fiscal defaults from InvoicyConfig.
   * Returns whatever defaults are configured, falling back to nulls.
   */
  private async getCompanyFiscalDefaults(companyId: string): Promise<{
    defaultNcm: string | null;
    defaultCfop: string | null;
  }> {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
      select: { defaultNcm: true, defaultCfop: true },
    });

    if (!config) {
      // Fallback: try first config if no default is set
      const firstConfig = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        select: { defaultNcm: true, defaultCfop: true },
      });

      return {
        defaultNcm: firstConfig?.defaultNcm || null,
        defaultCfop: firstConfig?.defaultCfop || null,
      };
    }

    return {
      defaultNcm: config.defaultNcm || null,
      defaultCfop: config.defaultCfop || null,
    };
  }

  /**
   * Regras de ST do produto, uma por UF de destino.
   */
  async listStRules(productId: string) {
    return this.prisma.productStRule.findMany({
      where: { productId },
      orderBy: { ufDestino: 'asc' },
    });
  }

  /**
   * Cria ou atualiza a regra de ST de uma UF. A chave é (produto, UF), então
   * reenviar a mesma UF corrige a linha em vez de duplicá-la.
   */
  async upsertStRule(productId: string, dto: ProductStRuleDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');

    const ufDestino = dto.ufDestino.trim().toUpperCase();
    const data = {
      mva: dto.mva ?? null,
      aliquotaInterna: dto.aliquotaInterna ?? null,
      reducaoBase: dto.reducaoBase ?? null,
      fcpStRate: dto.fcpStRate ?? null,
    };

    return this.prisma.productStRule.upsert({
      where: { productId_ufDestino: { productId, ufDestino } },
      create: { productId, ufDestino, ...data },
      update: data,
    });
  }

  async removeStRule(productId: string, ufDestino: string) {
    const uf = (ufDestino || '').trim().toUpperCase();
    const { count } = await this.prisma.productStRule.deleteMany({
      where: { productId, ufDestino: uf },
    });
    if (!count) throw new NotFoundException('Regra de ST não encontrada');
    return { deleted: true };
  }

  private mapDtoToData(
    dto: CreateProductFiscalDataDto | UpdateProductFiscalDataDto,
  ) {
    return {
      ncm: dto.ncm || null,
      cest: dto.cest || null,
      cean: dto.cean || null,
      productCode: dto.productCode || null,
      commercialUnit: dto.commercialUnit || null,
      icmsOrigin: dto.icmsOrigin || null,
      icmsCst: dto.icmsCst || null,
      icmsRate: dto.icmsRate ?? null,
      icmsCreditRate: dto.icmsCreditRate ?? null,
      icmsBaseModality: dto.icmsBaseModality || null,
      icmsStMva: dto.icmsStMva ?? null,
      icmsStReducao: dto.icmsStReducao ?? null,
      icmsStRate: dto.icmsStRate ?? null,
      fcpRate: dto.fcpRate ?? null,
      fcpStRate: dto.fcpStRate ?? null,
      icmsReducao: dto.icmsReducao ?? null,
      pisCst: dto.pisCst || null,
      pisRate: dto.pisRate ?? null,
      cofinsCst: dto.cofinsCst || null,
      cofinsRate: dto.cofinsRate ?? null,
      ipiCst: dto.ipiCst || null,
      ipiRate: dto.ipiRate ?? null,
      ipiFramework: dto.ipiFramework || null,
      cfopInState: dto.cfopInState || null,
      cfopOutState: dto.cfopOutState || null,
      cfopExport: dto.cfopExport || null,
      codigoServico: dto.codigoServico || null,
      aliquotaIss: dto.aliquotaIss ?? null,
      discriminacao: dto.discriminacao || null,
      codTribMunicipio: dto.codTribMunicipio || null,
      cnae: dto.cnae || null,
      nbs: dto.nbs || null,
      codTribNacional: dto.codTribNacional || null,
      cstIbsCbs: dto.cstIbsCbs || null,
      codClassificacao: dto.codClassificacao || null,
    };
  }
}
