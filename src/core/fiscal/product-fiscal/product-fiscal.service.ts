import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  BULK_FISCAL_MAX_PRODUCTS,
  BULK_NCM_MAX_PRODUCTS,
  BulkUpdateNcmDto,
  BulkUpdateTributacaoDto,
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
import {
  defaultsCadastroFiscal,
  isRegimeNormal,
} from '../utils/product-fiscal-defaults.util';
import {
  codigosCstDeOutroRegime,
  exigeAliquotaIcms,
  exigeReducaoBase,
  opcoesCstIcms,
  validarCstIcmsParaRegime,
} from '../utils/icms-cst.util';
import { normalizarUf } from '../utils/icms-aliquota-interna.util';
import { IcmsAliquotaInternaService } from '../shared/icms-aliquota-interna.service';
import { buildProductListWhere } from '../../product/product-list-where.util';

/**
 * Campos de tributação que a correção em massa sabe gravar.
 *
 * Tipado campo a campo, e não como um mapa aberto: o Prisma precisa saber que
 * `icmsRate` é número para aceitar a escrita, e o tipo também é o que impede
 * acrescentar um campo aqui sem passar pela validação.
 */
export interface CamposTributacaoEmMassa {
  icmsCst?: string;
  icmsRate?: number;
  icmsReducao?: number;
  icmsOrigin?: string;
  cfopInState?: string;
  cfopOutState?: string;
}

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

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Mesma fonte de alíquota interna que o cálculo da NF-e usa, com os
     * ajustes do superadmin sobre os padrões por UF: a sugestão da tela de
     * correção não pode divergir do que a emissão vai calcular.
     */
    private readonly icmsAliquotaInterna: IcmsAliquotaInternaService,
  ) {}

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
    mensagemVazio = 'Nenhum produto encontrado para aplicar o NCM.',
  ) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true },
    });

    if (products.length === 0) {
      throw new NotFoundException(mensagemVazio);
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

  /**
   * Correção de tributação em massa: CST de ICMS, alíquota, redução de base,
   * origem e CFOPs.
   *
   * Existe por causa da troca de regime. No Simples todo produto nasce com
   * CSOSN (padrão 102); ao virar Regime Normal, a base inteira recusa a
   * emissão de uma vez — "o código 102 é CSOSN e não vale no Regime Normal" —
   * e não há como abrir 119 cadastros um por um. Um script por cliente
   * resolveria o primeiro caso e nenhum dos seguintes, então a correção mora
   * aqui, com a mesma mecânica de escopo da alteração de NCM em massa.
   *
   * Só os campos informados são gravados: quem precisa apenas do CST não tem o
   * CFOP ajustado à mão sobrescrito por um padrão.
   *
   * O CST escolhido é conferido contra o regime do emissor antes de qualquer
   * escrita, nos dois sentidos — CSOSN no Regime Normal e CST no Simples —, e
   * a operação é recusada quando o novo CST exigiria alíquota (ou redução de
   * base) que os produtos não têm e que não vem na requisição: gravar só o
   * código trocaria um bloqueio de emissão por outro.
   */
  async bulkUpdateTributacao(companyId: string, dto: BulkUpdateTributacaoDto) {
    const defaults = await this.getCompanyFiscalDefaults(companyId);
    const dados = this.validarTributacaoEmMassa(dto, defaults.emitCrt);

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
        : await this.resolverEscopoSelecionado(
            companyId,
            dto.productIds ?? [],
            'Nenhum produto encontrado para corrigir a tributação.',
          );

    const filtroRegime = this.filtroCstDeOutroRegime(dto, defaults.emitCrt);

    // Produto sem cadastro fiscal não tem CST: entra mesmo com o filtro "só os
    // do outro regime" ligado, porque o cadastro nasce com o CST do regime.
    const semCadastro = await this.prisma.product.findMany({
      where: { ...productWhere, fiscalData: null },
      select: { id: true },
    });

    await this.conferirExigenciasDoCst(
      dto,
      { product: productWhere, ...filtroRegime },
      semCadastro.length,
    );

    // Sem transação única pelo mesmo motivo da alteração de NCM: no escopo ALL
    // ela seguraria locks sobre toda a base de produtos. A operação é
    // idempotente — aplicar a mesma tributação duas vezes não muda nada —,
    // então uma falha no meio pode ser repetida.
    const whereFiscal = { product: productWhere, ...filtroRegime };
    const updateResult = await this.aplicarTributacao(
      whereFiscal,
      dados,
      dto.onlyMissingRate === true,
    );

    let created = 0;
    for (let i = 0; i < semCadastro.length; i += BULK_FISCAL_MAX_PRODUCTS) {
      const lote = semCadastro.slice(i, i + BULK_FISCAL_MAX_PRODUCTS);
      const { count } = await this.prisma.productFiscalData.createMany({
        data: lote.map(({ id: productId }) => ({
          productId,
          // NCM fica com o padrão do emissor, ou nulo: inventar um código aqui
          // seria gravar uma classificação fiscal errada em silêncio. A
          // emissão e a alteração de NCM em massa cobram o NCM certo.
          ncm: defaults.defaultNcm ? formatNcm(defaults.defaultNcm) : null,
          cfopInState: defaults.defaultCfop || '5101',
          ...defaultsCadastroFiscal(defaults.emitCrt),
          // O que foi pedido vence os defaults.
          ...dados,
        })),
        skipDuplicates: true,
      });
      created += count;
    }

    const total = updateResult.count + created;
    if (total === 0) {
      throw new NotFoundException(
        dto.onlyIncompatibleRegime
          ? 'Nenhum produto para corrigir: todos já estão com um CST do regime do emissor.'
          : 'Nenhum produto encontrado para corrigir a tributação.',
      );
    }

    this.logger.log(
      `Tributação em massa na empresa ${companyId} (escopo ${dto.scope ?? 'SELECTED'}` +
        `${dto.onlyIncompatibleRegime ? ', só CST de outro regime' : ''}` +
        `${dto.onlyMissingRate ? ', alíquota só de quem está sem' : ''}): ` +
        `${JSON.stringify(dados)} em ${updateResult.count} atualizados, ` +
        `${created} criados, ${ignored} ignorados.`,
    );

    return {
      scope: dto.scope ?? 'SELECTED',
      aplicado: dados,
      onlyMissingRate: dto.onlyMissingRate === true,
      updated: updateResult.count,
      created,
      ignored,
      total,
    };
  }

  /**
   * Grava a correção, respeitando "preencher a alíquota somente de quem está
   * sem".
   *
   * Nesse modo a escrita vira dois passos, porque o alvo de cada parte é
   * diferente: o CST (e os demais campos) vão para todos os produtos do
   * escopo, e a alíquota só para quem está sem uma. Numa base migrada a
   * alíquota preenchida é a exceção deliberada — um produto com tributação
   * diferente do padrão da UF —, e sobrescrevê-la junto seria apagar em
   * silêncio o único dado que alguém conferiu.
   *
   * `updated` continua sendo quantos produtos a correção tocou: o passo que
   * atinge todos quando há outros campos, ou o da alíquota quando ela é a
   * única coisa pedida.
   */
  private async aplicarTributacao(
    whereFiscal: Record<string, unknown>,
    dados: CamposTributacaoEmMassa,
    somenteSemAliquota: boolean,
  ): Promise<{ count: number }> {
    const { icmsRate, ...outrosCampos } = dados;

    if (!somenteSemAliquota || icmsRate === undefined) {
      return this.prisma.productFiscalData.updateMany({
        where: whereFiscal,
        data: dados,
      });
    }

    // AND explícito: whereFiscal pode já ter um OR (filtro por regime), e
    // espalhar as duas condições no mesmo objeto sobrescreveria aquele.
    const aliquotaResult = await this.prisma.productFiscalData.updateMany({
      where: { AND: [whereFiscal, { icmsRate: null }] },
      data: { icmsRate },
    });

    if (Object.keys(outrosCampos).length === 0) return aliquotaResult;

    return this.prisma.productFiscalData.updateMany({
      where: whereFiscal,
      data: outrosCampos,
    });
  }

  /** Quantos produtos a correção de tributação atingiria, sem alterar nada. */
  async contarAlvosBulkTributacao(
    companyId: string,
    dto: BulkUpdateTributacaoDto,
  ) {
    const defaults = await this.getCompanyFiscalDefaults(companyId);
    const productWhere =
      dto.scope === 'ALL'
        ? buildProductListWhere({ ...dto.filters, companyId })
        : { id: { in: dto.productIds ?? [] }, companyId };

    const filtroRegime = this.filtroCstDeOutroRegime(dto, defaults.emitCrt);

    const [comCadastro, semCadastro] = await Promise.all([
      this.prisma.productFiscalData.count({
        where: { product: productWhere, ...filtroRegime },
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

  /**
   * O que a tela de correção precisa saber antes de oferecer qualquer opção:
   * o regime do emissor, os CSTs que valem nele, a alíquota interna da UF como
   * sugestão e quantos produtos estão com o código do outro regime.
   *
   * A alíquota vem com `origem` e `revisado` de propósito: parte dos padrões
   * por UF não foi conferida na legislação estadual, e a tela precisa poder
   * dizer isso em vez de apresentar o número como verdade fiscal. Quem decide
   * a alíquota é o contador do cliente.
   */
  async opcoesBulkTributacao(companyId: string) {
    const defaults = await this.getCompanyFiscalDefaults(companyId);

    const enderecos = await this.prisma.address.findMany({
      where: { companyId },
      select: { state: true, type: true },
    });
    const principal =
      enderecos.find((endereco) => endereco.type === 'Principal') ??
      enderecos[0];
    const uf = normalizarUf(principal?.state);

    const [aliquotas, incompativeis, semCadastroFiscal] = await Promise.all([
      this.icmsAliquotaInterna.listar(),
      this.prisma.productFiscalData.count({
        where: {
          product: { companyId },
          icmsCst: { in: [...codigosCstDeOutroRegime(defaults.emitCrt)] },
        },
      }),
      this.prisma.product.count({ where: { companyId, fiscalData: null } }),
    ]);

    return {
      emitCrt: defaults.emitCrt,
      regime: isRegimeNormal(defaults.emitCrt) ? 'NORMAL' : 'SIMPLES',
      uf: uf || null,
      aliquotaInternaSugerida:
        aliquotas.find((aliquota) => aliquota.uf === uf) ?? null,
      cstOptions: opcoesCstIcms(defaults.emitCrt),
      incompativeis,
      semCadastroFiscal,
    };
  }

  /**
   * Filtro "só os produtos com CST do outro regime".
   *
   * Vale nos dois sentidos: ao migrar para o Regime Normal pega os CSOSN, e ao
   * voltar para o Simples pega os CST. Preserva quem já está com o código
   * certo, inclusive ajustado à mão.
   */
  private filtroCstDeOutroRegime(
    dto: BulkUpdateTributacaoDto,
    emitCrt: number | null,
  ) {
    if (!dto.onlyIncompatibleRegime) return {};

    return {
      OR: [
        { icmsCst: { in: [...codigosCstDeOutroRegime(emitCrt)] } },
        // Cadastro sem CST também não emite, e a mensagem que o cliente recebe
        // ("CST do ICMS não informado") é a mesma classe de problema.
        { icmsCst: null },
        { icmsCst: '' },
      ],
    };
  }

  /**
   * Barra a correção que deixaria os produtos bloqueados de outra forma.
   *
   * Trocar CSOSN 102 por CST 00 sem alíquota só troca a mensagem de recusa —
   * de "é CSOSN e não vale no Regime Normal" para "CST 00 exige alíquota de
   * ICMS". A conferência roda antes de escrever e diz quantos produtos ficariam
   * parados, para a alíquota vir na mesma correção.
   *
   * Só se aplica quando a requisição troca o CST: sem troca, cada produto
   * continua com o código que já tinha e as exigências dele não mudam.
   */
  private async conferirExigenciasDoCst(
    dto: BulkUpdateTributacaoDto,
    whereFiscal: Record<string, unknown>,
    semCadastroFiscal: number,
  ) {
    const cst = dto.icmsCst?.trim();
    if (!cst) return;

    // AND explícito: whereFiscal pode já ter um OR (filtro por regime), e
    // espalhar as duas condições no mesmo objeto sobrescreveria aquele.
    const contarSem = async (condicao: Record<string, unknown>) =>
      this.prisma.productFiscalData.count({
        where: { AND: [whereFiscal, condicao] },
      });

    if (exigeAliquotaIcms(cst) && dto.icmsRate === undefined) {
      const semAliquota =
        (await contarSem({ icmsRate: null })) + semCadastroFiscal;
      if (semAliquota > 0) {
        throw new BadRequestException(
          `${semAliquota} produto(s) ficariam com o CST ${cst} sem alíquota de ` +
            'ICMS cadastrada, e a emissão continuaria bloqueada. Informe a ' +
            'alíquota de ICMS junto da correção.',
        );
      }
    }

    if (exigeReducaoBase(cst) && dto.icmsReducao === undefined) {
      const semReducao =
        (await contarSem({ OR: [{ icmsReducao: null }, { icmsReducao: 0 }] })) +
        semCadastroFiscal;
      if (semReducao > 0) {
        throw new BadRequestException(
          `${semReducao} produto(s) ficariam com o CST ${cst} sem o percentual ` +
            'de redução da base de cálculo, e a emissão continuaria bloqueada. ' +
            'Informe a redução junto da correção.',
        );
      }
    }
  }

  /**
   * Confere os campos informados e devolve só eles, prontos para gravar.
   *
   * A validação mora no service, e não apenas nos decoradores do DTO, porque
   * depende do regime do emissor — que vem do banco — e porque a mensagem
   * precisa dizer o que fazer, não apenas que o valor é inválido.
   */
  private validarTributacaoEmMassa(
    dto: BulkUpdateTributacaoDto,
    emitCrt: number | null,
  ): CamposTributacaoEmMassa {
    const dados: CamposTributacaoEmMassa = {};

    const cst = dto.icmsCst?.trim();
    if (cst) {
      const check = validarCstIcmsParaRegime(cst, emitCrt);
      if (!check.valid) throw new BadRequestException(check.message);
      dados.icmsCst = cst;
    }

    if (dto.icmsRate !== undefined) dados.icmsRate = dto.icmsRate;

    if (dto.icmsReducao !== undefined) {
      // O cálculo exige redução estritamente entre 0 e 100: 0 não reduz nada
      // (e aí o CST certo é outro) e 100 zeraria a base do imposto.
      if (dto.icmsReducao <= 0 || dto.icmsReducao >= 100) {
        throw new BadRequestException(
          'A redução da base de cálculo do ICMS deve ficar entre 0 e 100, ' +
            'sem incluir os extremos.',
        );
      }
      dados.icmsReducao = dto.icmsReducao;
    }

    if (dto.icmsOrigin !== undefined) {
      const origem = dto.icmsOrigin.trim();
      if (!/^[0-8]$/.test(origem)) {
        throw new BadRequestException(
          'A origem da mercadoria deve ser um dígito de 0 a 8.',
        );
      }
      dados.icmsOrigin = origem;
    }

    for (const campo of ['cfopInState', 'cfopOutState'] as const) {
      const valor = dto[campo];
      if (valor === undefined) continue;
      const limpo = valor.trim();
      if (!/^[0-9]{4}$/.test(limpo)) {
        throw new BadRequestException(
          'O CFOP deve ter 4 dígitos (ex.: 5101 dentro do estado, 6101 fora).',
        );
      }
      dados[campo] = limpo;
    }

    if (Object.keys(dados).length === 0) {
      throw new BadRequestException(
        'Informe pelo menos um campo para corrigir: CST de ICMS, alíquota, ' +
          'redução da base, origem da mercadoria ou CFOP.',
      );
    }

    return dados;
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
