import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  BULK_NCM_MAX_PRODUCTS,
  BulkUpdateNcmDto,
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
import { defaultsCadastroFiscal } from '../utils/product-fiscal-defaults.util';
import { buildProductListWhere } from '../../product/product-list-where.util';

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

  async create(dto: CreateProductFiscalDataDto, companyId: string) {
    // O produto precisa ser da empresa da sessão
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId },
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

  async upsert(dto: CreateProductFiscalDataDto, companyId: string) {
    // O produto precisa ser da empresa da sessão
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId },
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
   * Dois escopos: SELECTED aplica aos IDs informados (o caminho antigo);
   * ALL aplica a todos os produtos da empresa que atendem aos filtros da
   * listagem, para quem precisa corrigir uma base recém-migrada inteira sem
   * paginar de 500 em 500.
   *
   * Escopo por empresa: IDs de outra empresa (ou inexistentes) são ignorados em
   * silêncio e devolvidos apenas como contagem em `ignored` — o controller não
   * tem TenantGuard e o filtro por companyId aqui é a única barreira; no escopo
   * ALL a empresa vem do token e nunca do corpo.
   *
   * Produto sem cadastro fiscal recebe um registro novo com os defaults do
   * regime do emissor, trocando só o NCM pelo informado. Produto que já tem
   * cadastro tem SOMENTE o ncm alterado — CFOP, CSTs e alíquotas ajustados
   * pelo usuário são preservados.
   */
  async bulkUpdateNcm(companyId: string, dto: BulkUpdateNcmDto) {
    const check = validateNcm(dto.ncm);
    if (!check.valid) {
      throw new BadRequestException(check.message);
    }

    const cleanNcm = formatNcm(dto.ncm);
    const defaults = await this.getCompanyFiscalDefaults(companyId);

    // Preserva NCM ajustado à mão: só entram produtos sem cadastro fiscal, com
    // NCM vazio, ou ainda com o NCM padrão herdado do emissor.
    const semNcmProprio = dto.onlyInheritedNcm
      ? {
          OR: [
            { ncm: null },
            { ncm: '' },
            ...(defaults.defaultNcm
              ? [{ ncm: formatNcm(defaults.defaultNcm) }]
              : []),
          ],
        }
      : {};

    const { productWhere, ignored } =
      dto.scope === 'ALL'
        ? {
            // companyId sempre do token, nunca do corpo.
            productWhere: buildProductListWhere({
              ...dto.filters,
              companyId,
            }),
            ignored: 0,
          }
        : await this.resolverEscopoSelecionado(companyId, dto.productIds ?? []);

    // Produto sem cadastro fiscal não tem NCM próprio: entra mesmo com o
    // filtro "só sem NCM próprio" ligado.
    const semCadastro = await this.prisma.product.findMany({
      where: { ...productWhere, fiscalData: null },
      select: { id: true },
    });

    // Sem transação única de propósito: no escopo ALL ela seguraria locks por
    // toda a base de produtos da empresa. A operação é idempotente — aplicar o
    // mesmo NCM duas vezes não muda nada —, então uma falha no meio pode ser
    // simplesmente repetida.
    const updateResult = await this.prisma.productFiscalData.updateMany({
      where: { product: productWhere, ...semNcmProprio },
      data: { ncm: cleanNcm },
    });

    let created = 0;
    for (let i = 0; i < semCadastro.length; i += BULK_NCM_MAX_PRODUCTS) {
      const lote = semCadastro.slice(i, i + BULK_NCM_MAX_PRODUCTS);
      const { count } = await this.prisma.productFiscalData.createMany({
        data: lote.map(({ id: productId }) => ({
          productId,
          ncm: cleanNcm,
          cfopInState: defaults.defaultCfop || '5101',
          // CST de ICMS conforme o regime do emissor: CSOSN em emissor do
          // Regime Normal nasce bloqueado para emissão.
          ...defaultsCadastroFiscal(defaults.emitCrt),
        })),
        skipDuplicates: true,
      });
      created += count;
    }

    const total = updateResult.count + created;
    if (total === 0) {
      throw new NotFoundException(
        dto.onlyInheritedNcm
          ? 'Nenhum produto para alterar: todos os selecionados já têm um NCM próprio.'
          : 'Nenhum produto encontrado para aplicar o NCM.',
      );
    }

    this.logger.log(
      `Bulk NCM ${cleanNcm} na empresa ${companyId} (escopo ${dto.scope ?? 'SELECTED'}` +
        `${dto.onlyInheritedNcm ? ', só sem NCM próprio' : ''}` +
        `${dto.filters ? `, filtros ${JSON.stringify(dto.filters)}` : ''}): ` +
        `${updateResult.count} atualizados, ${created} criados, ${ignored} ignorados.`,
    );

    return {
      ncm: cleanNcm,
      scope: dto.scope ?? 'SELECTED',
      updated: updateResult.count,
      created,
      ignored,
      total,
    };
  }

  /**
   * Escopo por seleção: confere quais IDs pertencem à empresa.
   *
   * IDs de outra empresa (ou inexistentes) são ignorados em silêncio e
   * devolvidos apenas como contagem — este controller não passa pelo
   * TenantGuard, e o filtro por companyId aqui é a única barreira.
   */
  private async resolverEscopoSelecionado(
    companyId: string,
    productIds: string[],
  ) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true },
    });

    if (products.length === 0) {
      throw new NotFoundException(
        'Nenhum produto encontrado para aplicar o NCM.',
      );
    }

    return {
      productWhere: { id: { in: products.map((p) => p.id) }, companyId },
      ignored: productIds.length - products.length,
    };
  }

  /**
   * Quantos produtos a alteração em massa atingiria, sem alterar nada.
   *
   * A tela mostra "serão alterados N" antes de aplicar — principalmente com o
   * filtro "só sem NCM próprio", em que N não é o total da listagem.
   */
  async contarAlvosBulkNcm(companyId: string, dto: BulkUpdateNcmDto) {
    const defaults = await this.getCompanyFiscalDefaults(companyId);
    const productWhere =
      dto.scope === 'ALL'
        ? buildProductListWhere({ ...dto.filters, companyId })
        : { id: { in: dto.productIds ?? [] }, companyId };

    const semNcmProprio = dto.onlyInheritedNcm
      ? {
          OR: [
            { ncm: null },
            { ncm: '' },
            ...(defaults.defaultNcm
              ? [{ ncm: formatNcm(defaults.defaultNcm) }]
              : []),
          ],
        }
      : {};

    const [comCadastro, semCadastro] = await Promise.all([
      this.prisma.productFiscalData.count({
        where: { product: productWhere, ...semNcmProprio },
      }),
      this.prisma.product.count({
        where: { ...productWhere, fiscalData: null },
      }),
    ]);

    return {
      total: comCadastro + semCadastro,
      comCadastroFiscal: comCadastro,
      semCadastroFiscal: semCadastro,
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
        // CST de ICMS conforme o regime: CSOSN em emissor do Regime Normal
        // faz a emissão ser recusada.
        ...defaultsCadastroFiscal(config.emitCrt),
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
    /** Regime do emissor; decide o CST de ICMS dos cadastros criados. */
    emitCrt: number | null;
  }> {
    const select = { defaultNcm: true, defaultCfop: true, emitCrt: true };

    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
      select,
    });

    if (!config) {
      // Fallback: try first config if no default is set
      const firstConfig = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        select,
      });

      return {
        defaultNcm: firstConfig?.defaultNcm || null,
        defaultCfop: firstConfig?.defaultCfop || null,
        emitCrt: firstConfig?.emitCrt ?? null,
      };
    }

    return {
      defaultNcm: config.defaultNcm || null,
      defaultCfop: config.defaultCfop || null,
      emitCrt: config.emitCrt ?? null,
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
