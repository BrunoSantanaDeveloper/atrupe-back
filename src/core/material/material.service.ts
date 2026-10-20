import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MaterialPriceRule, MaterialShape, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import {
  CreateMaterialDto,
  MaterialAdvancedDto,
} from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import {
  MATERIAL_PAGE_LIMIT,
  MaterialFilterDto,
} from './dto/material-filter.dto';
import {
  CreateMaterialVariationsDto,
  UpdateMaterialVariationDto,
} from './dto/material-variation.dto';
import { UpdateMaterialPriceDto } from './dto/material-price.dto';
import { MaterialFiscalDto } from './dto/material-fiscal.dto';
import { pickMaterialFiscal } from '../fiscal/utils/item-fiscal.util';
import { materialNumbers } from './material-number';
import { PricingCharges, variablePriceOf } from './material-pricing';
import {
  MATERIAL_INCLUDE,
  MaterialRow,
  MaterialView,
  toMaterialResponse,
  toPaperResponse,
  toPricingItem,
  toVariationResponse,
} from './material.presenter';
import { materialCode, normalizeText, variationKey } from './material-text';
import {
  NOT_A_PAPER,
  NO_PAPER,
  PAPER_FIELDS_NEED_SHEET,
  PaperColumns,
  PaperInput,
  changedPaperColumns,
  hasPaperValues,
  paperColumnsOf,
  paperInputOf,
  resolvePaper,
} from './paper';

const NOT_FOUND = 'Material não encontrado';

/** O papel do LITE fica na subcategoria dele na tela completa do PRO. */
const PAPER_SUBCATEGORY = 'Papéis';

/**
 * A criação espera a vez quando outra da mesma empresa está em curso (uma
 * importação grande, por exemplo): o prazo padrão da transação é curto.
 */
const CREATE_TIMEOUT_MS = 20_000;

type CostHolder = {
  cost: number | null;
  price: number | null;
  desiredMargin: number | null;
};

/**
 * A mudança de custo de um material ou de uma variação. No preço variável, o
 * preço acompanha o custo pelo lucro guardado (ORG-19); no fixo, só a margem
 * muda, e o item pode ficar abaixo do custo.
 */
export function costChange(
  rule: MaterialPriceRule,
  holder: CostHolder,
  cost: number | null,
  charges: PricingCharges,
) {
  if (cost === holder.cost) return {};

  const data: {
    cost: number | null;
    costUpdatedAt: Date | null;
    price?: number;
  } = { cost, costUpdatedAt: cost === null ? null : new Date() };

  if (
    rule === MaterialPriceRule.VARIABLE &&
    cost !== null &&
    holder.desiredMargin !== null
  ) {
    const price = variablePriceOf(cost, holder.desiredMargin, charges);
    if (price !== null) data.price = price;
  }
  return data;
}

/**
 * As colunas da configuração avançada. `undefined` não mexe em nada (PATCH
 * sem o bloco); o bloco, quando vem, substitui o anterior inteiro.
 */
function advancedColumns(advanced: MaterialAdvancedDto | null | undefined) {
  if (advanced === undefined) return {};
  if (advanced === null) {
    return {
      shape: null,
      profileX: null,
      profileY: null,
      barLength: null,
      sheetWidth: null,
      sheetHeight: null,
      wholeSheets: true,
      weight: null,
    };
  }
  return {
    shape: advanced.shape,
    profileX: advanced.x ?? null,
    profileY: advanced.y ?? null,
    barLength: advanced.barLength ?? null,
    sheetWidth: advanced.width ?? null,
    sheetHeight: advanced.height ?? null,
    // Só a chapa escolhe; fora dela vale a folha inteira (AP-4)
    wholeSheets:
      advanced.shape === 'SHEET' ? (advanced.wholeSheets ?? true) : true,
    weight: advanced.weight ?? null,
  };
}

/** O preço tem rota própria; o corpo do cadastro não o grava. */
const PRICE_HAS_OWN_ROUTE =
  'O preço do material tem rota própria: PATCH /material/:id/price';

/**
 * As colunas do papel na tela completa (com a base de custos). Os campos do
 * papel só valem na forma SHEET; a folha que vier fora (`sheetWidth`,
 * `sheetHeight`) vale sobre a do bloco avançado, que é a mesma coluna. Quando
 * a forma deixa de ser SHEET, o papel sai junto.
 */
function fullPaperColumns(
  current: PaperColumns,
  advanced: ReturnType<typeof advancedColumns>,
  shape: MaterialShape | null,
  dto: CreateMaterialDto | UpdateMaterialDto,
): Partial<PaperColumns> {
  const input = paperInputOf(dto);
  if (shape !== 'SHEET') {
    if (hasPaperValues(input)) {
      throw new BadRequestException(PAPER_FIELDS_NEED_SHEET);
    }
    // A folha do bloco avançado fica como veio; o papel sai
    return changedPaperColumns(current, {
      ...NO_PAPER,
      sheetWidth: current.sheetWidth,
      sheetHeight: current.sheetHeight,
    });
  }
  // A folha do bloco avançado conta como a medida enviada agora
  const base: PaperColumns = {
    ...current,
    ...('sheetWidth' in advanced
      ? { sheetWidth: advanced.sheetWidth, sheetHeight: advanced.sheetHeight }
      : {}),
  };
  const sent: PaperInput = {
    ...('sheetWidth' in advanced
      ? { sheetWidth: advanced.sheetWidth, sheetHeight: advanced.sheetHeight }
      : {}),
    ...input,
  };
  return changedPaperColumns(base, resolvePaper(base, sent));
}

/** As opções que usam o material, em qualquer variação. */
const usesMaterial = (materialId: string) =>
  ({
    OR: [
      { resourceId: `material:${materialId}` },
      { resourceId: { startsWith: `material:${materialId}:` } },
    ],
  }) satisfies Prisma.AssemblyLineOptionWhereInput;

const USAGE_BLOCK = {
  name: true,
  localName: true,
  process: { select: { name: true } },
  assembly: { select: { product: { select: { id: true, name: true } } } },
} satisfies Prisma.AssemblyBlockSelect;

type UsageBlock = Prisma.AssemblyBlockGetPayload<{
  select: typeof USAGE_BLOCK;
}>;

/**
 * Materiais da empresa da sessão. Toda leitura e escrita filtra pela
 * empresa: o id de outra responde como inexistente (404).
 *
 * `view.values` diz se quem chama tem `values:values:view`. Sem ela, custo e
 * preço não saem nas respostas e o custo enviado não é gravado.
 */
@Injectable()
export class MaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingParameters: PricingParametersService,
  ) {}

  async findAll(
    companyId: string,
    filter: MaterialFilterDto,
    view: MaterialView,
  ) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 10, MATERIAL_PAGE_LIMIT);
    const search = normalizeText(filter.search);

    const where: Prisma.MaterialWhereInput = {
      companyId,
      active: filter.active ?? true,
      ...(filter.sectorId ? { sectorId: filter.sectorId } : {}),
      ...(filter.directSale !== undefined
        ? { directSale: filter.directSale }
        : {}),
      ...(filter.productionMaterial !== undefined
        ? { productionMaterial: filter.productionMaterial }
        : {}),
      // O papel é o material com a forma folha (Papéis no LITE)
      ...(filter.paper === true ? { shape: MaterialShape.SHEET } : {}),
      // O `not` do Prisma deixa o nulo de fora: o material sem forma entra
      // pelo OR, dentro do AND para não brigar com o OR da busca
      ...(filter.paper === false
        ? {
            AND: [
              {
                OR: [{ shape: null }, { shape: { not: MaterialShape.SHEET } }],
              },
            ],
          }
        : {}),
      ...(search
        ? {
            OR: [
              { searchName: { contains: search } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.material.findMany({
        where,
        include: MATERIAL_INCLUDE,
        // A tela agrupa nesta ordem: setor, subcategoria, nome
        orderBy: [
          { sector: { name: 'asc' } },
          { subcategory: 'asc' },
          { name: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.material.count({ where }),
    ]);

    return {
      // O papel do LITE sai só com os campos do papel, sem dinheiro
      data: rows.map((row) =>
        view.paper ? toPaperResponse(row) : toMaterialResponse(row, view),
      ),
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  /**
   * O cadastro da tela completa (com a base de custos). Os campos do papel
   * entram na forma SHEET, com as mesmas regras do papel do LITE.
   */
  async create(companyId: string, dto: CreateMaterialDto, view: MaterialView) {
    if (dto.price !== undefined) {
      throw new BadRequestException(PRICE_HAS_OWN_ROUTE);
    }
    if (!dto.sectorId) {
      throw new BadRequestException('Informe o setor do material');
    }
    if (!dto.unit) {
      throw new BadRequestException(
        'Unidade inválida: use HR, M2, M, KM, UN, KG ou LT.',
      );
    }
    await this.assertSector(companyId, dto.sectorId);
    // O custo só entra de quem pode ver valores; sem a permissão, fica nulo
    const cost = view.values ? (dto.cost ?? null) : null;
    const advanced = advancedColumns(dto.advanced ?? undefined);
    const paper = fullPaperColumns(
      NO_PAPER,
      advanced,
      dto.advanced?.shape ?? null,
      dto,
    );

    const created = await this.prisma.$transaction(
      async (tx) => {
        const number = (await materialNumbers(tx, companyId))();
        return tx.material.create({
          data: {
            companyId,
            number,
            code: materialCode(number),
            name: dto.name,
            searchName: normalizeText(dto.name),
            sectorId: dto.sectorId,
            subcategory: dto.subcategory ?? '',
            unit: dto.unit,
            directSale: dto.directSale ?? false,
            productionMaterial: dto.productionMaterial ?? true,
            cost,
            costUpdatedAt: cost === null ? null : new Date(),
            ...(dto.active === false ? { active: false } : {}),
            ...advanced,
            ...paper,
          },
          include: MATERIAL_INCLUDE,
        });
      },
      { timeout: CREATE_TIMEOUT_MS },
    );

    return toMaterialResponse(created, view);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateMaterialDto,
    view: MaterialView,
  ) {
    if (dto.price !== undefined) {
      throw new BadRequestException(PRICE_HAS_OWN_ROUTE);
    }
    const material = await this.find(companyId, id);
    if (dto.sectorId != null) await this.assertSector(companyId, dto.sectorId);

    const advanced = advancedColumns(dto.advanced);
    const data: Prisma.MaterialUncheckedUpdateInput = {
      ...(dto.name != null
        ? { name: dto.name, searchName: normalizeText(dto.name) }
        : {}),
      ...(dto.sectorId != null ? { sectorId: dto.sectorId } : {}),
      ...(dto.subcategory != null ? { subcategory: dto.subcategory } : {}),
      ...(dto.unit != null ? { unit: dto.unit } : {}),
      ...(dto.directSale != null ? { directSale: dto.directSale } : {}),
      ...(dto.productionMaterial != null
        ? { productionMaterial: dto.productionMaterial }
        : {}),
      ...advanced,
      ...fullPaperColumns(
        paperColumnsOf(material),
        advanced,
        dto.advanced === undefined
          ? material.shape
          : (dto.advanced?.shape ?? null),
        dto,
      ),
    };

    // Com variação, custo e preço vivem nela: o modal de edição manda `cost`
    // sempre, e aqui ele é ignorado (MT-3)
    if (
      dto.cost !== undefined &&
      view.values &&
      material.variations.length === 0
    ) {
      Object.assign(
        data,
        costChange(
          material.priceRule,
          material,
          dto.cost,
          await this.pricingParameters.chargesOf(companyId),
        ),
      );
    }

    const updated = await this.save(companyId, material, data, dto.active);
    return toMaterialResponse(updated, view);
  }

  /**
   * O papel do LITE (Papéis, sem a base de custos): só os campos do papel.
   * Nasce com a forma folha, como material de produção, fora da venda
   * direta, por folha (UN) e sem custo nem preço. Sem setor, vai para o
   * primeiro setor ativo da empresa.
   */
  async createPaper(companyId: string, dto: CreateMaterialDto) {
    const sectorId = await this.paperSector(companyId, dto.sectorId);
    const paper = resolvePaper(NO_PAPER, paperInputOf(dto), {
      requireFormat: true,
    });

    const created = await this.prisma.$transaction(
      async (tx) => {
        const number = (await materialNumbers(tx, companyId))();
        return tx.material.create({
          data: {
            companyId,
            number,
            code: materialCode(number),
            name: dto.name,
            searchName: normalizeText(dto.name),
            sectorId,
            subcategory: PAPER_SUBCATEGORY,
            unit: 'UN',
            directSale: false,
            productionMaterial: true,
            active: dto.active ?? true,
            shape: MaterialShape.SHEET,
            wholeSheets: true,
            ...paper,
          },
          include: MATERIAL_INCLUDE,
        });
      },
      { timeout: CREATE_TIMEOUT_MS },
    );
    return toPaperResponse(created);
  }

  /**
   * A edição do papel do LITE: nome, setor, ativo e os campos do papel. O
   * material que não é papel não se edita por aqui (o controller responde o
   * 403 da base de custos antes).
   */
  async updatePaper(companyId: string, id: string, dto: UpdateMaterialDto) {
    const material = await this.find(companyId, id);
    if (material.shape !== MaterialShape.SHEET) {
      throw new BadRequestException(NOT_A_PAPER);
    }
    if (dto.sectorId != null) await this.assertSector(companyId, dto.sectorId);

    const current = paperColumnsOf(material);
    const data: Prisma.MaterialUncheckedUpdateInput = {
      ...(dto.name != null
        ? { name: dto.name, searchName: normalizeText(dto.name) }
        : {}),
      ...(dto.sectorId != null ? { sectorId: dto.sectorId } : {}),
      ...changedPaperColumns(
        current,
        // No LITE o papel tem formato: limpar o formato é recusado
        resolvePaper(current, paperInputOf(dto), {
          requireFormat: dto.sheetFormat === null,
        }),
      ),
    };
    const updated = await this.save(companyId, material, data, dto.active);
    return toPaperResponse(updated);
  }

  /** Se o material da empresa é um papel (forma folha); 404 se não existe. */
  async isPaper(companyId: string, id: string) {
    const material = await this.find(companyId, id);
    return material.shape === MaterialShape.SHEET;
  }

  /**
   * Grava a edição. Com `active` diferente do atual, inativa ou reativa como
   * o toggle-status: ao inativar, o material sai das composições na mesma
   * transação.
   */
  private async save(
    companyId: string,
    material: MaterialRow,
    data: Prisma.MaterialUncheckedUpdateInput,
    active: boolean | undefined,
  ) {
    if (active === undefined || active === material.active) {
      return this.prisma.material.update({
        where: { id: material.id },
        data,
        include: MATERIAL_INCLUDE,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      if (!active) {
        await this.removeFromCompositions(tx, companyId, material.id);
      }
      return tx.material.update({
        where: { id: material.id },
        data: { ...data, active },
        include: MATERIAL_INCLUDE,
      });
    });
  }

  /**
   * O setor do papel: o informado (da empresa) ou o primeiro setor ativo,
   * de produção antes, fora os de sistema. Não há setor padrão para
   * materiais (ver a importação).
   */
  private async paperSector(companyId: string, sectorId?: string | null) {
    if (sectorId) {
      await this.assertSector(companyId, sectorId);
      return sectorId;
    }
    const sectors = await this.prisma.companySector.findMany({
      where: { companyId, isActive: true, isSystem: false },
      select: { id: true, kind: true },
      orderBy: { name: 'asc' },
    });
    const sector =
      sectors.find((item) => item.kind === 'PRODUCTION') ?? sectors[0];
    if (!sector) {
      throw new BadRequestException(
        'Cadastre um setor ativo para guardar o papel',
      );
    }
    return sector.id;
  }

  /** Cria em lote as combinações marca × cor que ainda não existem (MT-3). */
  async createVariations(
    companyId: string,
    id: string,
    dto: CreateMaterialVariationsDto,
    view: MaterialView,
  ) {
    const material = await this.find(companyId, id);
    const cost = view.values ? (dto.cost ?? null) : null;
    const price = view.values ? (dto.price ?? null) : null;

    const taken = new Set(material.variations.map((item) => item.matchKey));
    const combinations: { brand: string; color: string; matchKey: string }[] =
      [];
    for (const brand of dto.brands) {
      for (const color of dto.colors) {
        const matchKey = variationKey(brand, color);
        // Combinação que já existe (ou repetida no envio) é ignorada, sem erro
        if (taken.has(matchKey)) continue;
        taken.add(matchKey);
        combinations.push({ brand, color, matchKey });
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const combination of combinations) {
        rows.push(
          await tx.materialVariation.create({
            data: {
              ...combination,
              materialId: id,
              cost,
              price,
              costUpdatedAt: cost === null ? null : new Date(),
            },
          }),
        );
      }
      // Na primeira variação, custo e preço deixam de valer no material: a
      // venda passa a exigir a escolha da variação (MT-3)
      if (rows.length && material.variations.length === 0) {
        await tx.material.update({
          where: { id },
          data: {
            cost: null,
            price: null,
            desiredMargin: null,
            costUpdatedAt: null,
          },
        });
      }
      return rows;
    });

    return {
      created: created.length,
      variations: created.map((item) => toVariationResponse(item, view)),
    };
  }

  /** Custo e preço de uma combinação (MT-4). Só para quem vê valores. */
  async updateVariation(
    companyId: string,
    id: string,
    variationId: string,
    dto: UpdateMaterialVariationDto,
  ) {
    const material = await this.find(companyId, id);
    const variation = material.variations.find(
      (item) => item.id === variationId,
    );
    if (!variation) throw new NotFoundException('Variação não encontrada');

    const data: Prisma.MaterialVariationUncheckedUpdateInput = {};
    if (dto.cost !== undefined) {
      Object.assign(
        data,
        costChange(
          material.priceRule,
          variation,
          dto.cost,
          await this.pricingParameters.chargesOf(companyId),
        ),
      );
    }
    // A tabela de custos manda junto o preço que já estava: só o preço que
    // mudou é um preço informado, e ele vale sobre o recalculado
    if (dto.price !== undefined && dto.price !== variation.price) {
      data.price = dto.price;
    }

    const updated = await this.prisma.materialVariation.update({
      where: { id: variationId },
      data,
    });
    return toVariationResponse(updated, { values: true });
  }

  /** A regra e o preço do material, ou da variação quando houver (DC-6). */
  async updatePrice(
    companyId: string,
    id: string,
    dto: UpdateMaterialPriceDto,
  ) {
    const material = await this.find(companyId, id, 'Item não encontrado');
    const hasVariations = material.variations.length > 0;

    if (hasVariations && !dto.variationId) {
      throw new BadRequestException(
        'Este material tem variações: o preço é o de cada marca e cor.',
      );
    }
    if (!hasVariations && dto.variationId) {
      throw new BadRequestException('Este material não tem variações.');
    }
    const variation = dto.variationId
      ? material.variations.find((item) => item.id === dto.variationId)
      : null;
    if (dto.variationId && !variation) {
      throw new NotFoundException('Item não encontrado');
    }

    const holder = variation ?? material;
    if (holder.cost === null) {
      throw new BadRequestException('Este item ainda não tem custo.');
    }

    let price = dto.price;
    let desiredMargin: number | null = null;

    if (dto.rule === MaterialPriceRule.VARIABLE) {
      if (dto.desiredMargin === undefined) {
        throw new BadRequestException('Informe o lucro do preço variável.');
      }
      // O modal simula; quem calcula é o servidor (SEG-1)
      const expected = variablePriceOf(
        holder.cost,
        dto.desiredMargin,
        await this.pricingParameters.chargesOf(companyId),
      );
      if (expected === null) {
        throw new BadRequestException(
          'Os encargos e o lucro somam 100 % ou mais: não há preço que os pague.',
        );
      }
      if (Math.abs(expected - dto.price) > 1) {
        throw new BadRequestException(
          'O preço não confere com o custo e o lucro informados. Atualize a tela e tente de novo.',
        );
      }
      price = expected;
      desiredMargin = dto.desiredMargin;
    } else if (dto.desiredMargin !== undefined) {
      throw new BadRequestException('O lucro só vale para o preço variável.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (variation) {
        await tx.materialVariation.update({
          where: { id: variation.id },
          data: { price, desiredMargin },
        });
      }
      // A regra é do material: vale para todas as variações
      return tx.material.update({
        where: { id },
        data: {
          priceRule: dto.rule,
          ...(variation ? {} : { price, desiredMargin }),
        },
        include: MATERIAL_INCLUDE,
      });
    });

    return toPricingItem(
      updated,
      variation
        ? updated.variations.find((item) => item.id === variation.id)
        : null,
    );
  }

  /**
   * Os produtos e processos cuja composição usa o material (qualquer
   * variação), com a etapa. O produto cuja etapa acompanha um processo que
   * usa o material também entra (CP-21).
   */
  async usage(companyId: string, id: string) {
    await this.find(companyId, id);
    const lines = await this.prisma.assemblyLine.findMany({
      where: {
        options: { some: usesMaterial(id) },
        OR: [
          { process: { companyId } },
          // Só os produtos: o rascunho do item montado não tem nome (ORC-11)
          { block: { assembly: { companyId, productId: { not: null } } } },
        ],
      },
      select: {
        process: {
          select: { id: true, name: true, sector: { select: { name: true } } },
        },
        block: { select: USAGE_BLOCK },
      },
    });
    const processIds = [
      ...new Set(
        lines.flatMap((line) => (line.process ? [line.process.id] : [])),
      ),
    ];
    const linked = processIds.length
      ? await this.prisma.assemblyBlock.findMany({
          where: {
            processId: { in: processIds },
            assembly: { companyId, productId: { not: null } },
          },
          select: USAGE_BLOCK,
        })
      : [];

    const data = new Map<
      string,
      { kind: 'PRODUCT' | 'PROCESS'; id: string; name: string; stage: string }
    >();
    const add = (entry: {
      kind: 'PRODUCT' | 'PROCESS';
      id: string;
      name: string;
      stage: string;
    }) => data.set(`${entry.kind}:${entry.id}:${entry.stage}`, entry);
    const addBlock = (block: UsageBlock) =>
      add({
        kind: 'PRODUCT',
        id: block.assembly.product.id,
        name: block.assembly.product.name,
        stage: block.localName || block.process?.name || block.name,
      });
    for (const line of lines) {
      if (line.process) {
        add({
          kind: 'PROCESS',
          id: line.process.id,
          name: line.process.name,
          stage: line.process.sector.name,
        });
      }
      if (line.block) addBlock(line.block);
    }
    linked.forEach(addBlock);
    return { data: [...data.values()] };
  }

  /**
   * Os dados fiscais da venda direta (PO, 14/10/2026). Só o material de
   * venda direta vai sozinho para a nota; o campo vazio sai do padrão do
   * emissor. Gravar sem nenhum campo limpa o cadastro fiscal.
   */
  async updateFiscal(
    companyId: string,
    id: string,
    dto: MaterialFiscalDto,
    view: MaterialView,
  ) {
    const material = await this.find(companyId, id);
    if (!material.directSale) {
      throw new BadRequestException(
        'Só o material de venda direta tem dados fiscais.',
      );
    }
    const fiscal = pickMaterialFiscal(dto);
    const updated = await this.prisma.material.update({
      where: { id },
      data: {
        fiscal: Object.keys(fiscal).length ? fiscal : Prisma.DbNull,
      },
      include: MATERIAL_INCLUDE,
    });
    return toMaterialResponse(updated, view);
  }

  /**
   * Inativa ou reativa. Ao inativar, o material (todas as variações) sai
   * das opções das linhas de produtos e processos na mesma transação: a
   * escolhida passa para a próxima opção e a linha que fica sem opção sai.
   * `removedFrom` conta as linhas alteradas. Reativar não recoloca nada.
   */
  async toggleStatus(
    companyId: string,
    id: string,
    active: boolean,
    view: MaterialView,
  ) {
    const material = await this.find(companyId, id);
    if (material.active === active) {
      throw new BadRequestException(
        active ? 'O material já está ativo.' : 'O material já está inativo.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const removedFrom = active
        ? 0
        : await this.removeFromCompositions(tx, companyId, id);
      const updated = await tx.material.update({
        where: { id },
        data: { active },
        include: MATERIAL_INCLUDE,
      });
      return { ...toMaterialResponse(updated, view), removedFrom };
    });
  }

  private async removeFromCompositions(
    tx: Prisma.TransactionClient,
    companyId: string,
    materialId: string,
  ) {
    const lines = await tx.assemblyLine.findMany({
      where: {
        options: { some: usesMaterial(materialId) },
        OR: [
          { process: { companyId } },
          { block: { assembly: { companyId } } },
        ],
      },
      select: {
        id: true,
        selectedOptionId: true,
        options: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { id: true, resourceId: true },
        },
      },
    });
    const isMaterial = (resourceId: string) =>
      resourceId === `material:${materialId}` ||
      resourceId.startsWith(`material:${materialId}:`);
    for (const line of lines) {
      const rest = line.options.filter((o) => !isMaterial(o.resourceId));
      if (!rest.length) {
        await tx.assemblyLine.delete({ where: { id: line.id } });
        continue;
      }
      await tx.assemblyLineOption.deleteMany({
        where: { lineId: line.id, ...usesMaterial(materialId) },
      });
      if (
        line.selectedOptionId &&
        !rest.some((option) => option.id === line.selectedOptionId)
      ) {
        await tx.assemblyLine.update({
          where: { id: line.id },
          data: { selectedOptionId: rest[0].id },
        });
      }
    }
    return lines.length;
  }

  private async find(
    companyId: string,
    id: string,
    message = NOT_FOUND,
  ): Promise<MaterialRow> {
    const material = await this.prisma.material.findFirst({
      where: { id, companyId },
      include: MATERIAL_INCLUDE,
    });
    if (!material) throw new NotFoundException(message);
    return material;
  }

  private async assertSector(companyId: string, sectorId: string) {
    const sector = await this.prisma.companySector.findFirst({
      where: { id: sectorId, companyId },
      select: { id: true },
    });
    if (!sector) throw new NotFoundException('Setor não encontrado');
  }
}
