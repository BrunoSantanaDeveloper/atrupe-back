import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { PrismaService } from 'nestjs-prisma';
import { ProductFilterDTO } from './dto/filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';

import { Prisma, ProductStructure } from '@prisma/client';

export const STRUCTURE_MISMATCH =
  'A estrutura e o terceirizado não combinam: o produto terceirizado tem a estrutura Terceirizado';
// O tipo do produto (a estrutura) trava depois que ele entra num orçamento
// (Maicol, 25/11/2026): mudar o tipo mudaria como ele calcula daqui para
// frente e o que a venda antiga mostra
export const STRUCTURE_LOCKED =
  'Este produto já foi usado em orçamento e o tipo dele não muda. Para outro tipo, duplique o produto ou inative este e cadastre um novo';
export const OUTSOURCED_BLOCK_REQUIRED =
  'Informe o fornecedor e o custo do terceirizado';
import { JsonArray } from '@prisma/client/runtime/library';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';
import { ProductFiscalService } from '../fiscal/product-fiscal/product-fiscal.service';
import { buildProductListWhere } from './product-list-where.util';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

const EXPORT_LIMIT = '10000';

/**
 * O Produto base do setor (ALT-8, pacote de 26/10/2026) vem antes dos outros
 * na lista. Não pelo nome: a collation do banco (en_US) ignora a pontuação ao
 * ordenar, e um "#" na frente sairia também no orçamento e na nota.
 */
export const BASE_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  name: { startsWith: 'Produto base – ' },
};

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productFiscalService: ProductFiscalService,
  ) {}

  /**
   * O grupo, o setor e as etapas de produção (setores) vêm no corpo: precisam
   * ser da empresa (o grupo pode ser o padrão do sistema)
   */
  private async assertRefsOfCompany(
    companyId: string,
    refs: {
      categoryId?: string | null;
      sectorId?: string | null;
      productionStages?: { id?: string }[] | null;
    },
  ) {
    await assertBelongsToCompany(
      this.prisma.category,
      refs.categoryId,
      { OR: [{ companyId }, { isStandard: true }] },
      'Grupo não encontrado.',
    );
    await assertBelongsToCompany(
      this.prisma.companySector,
      [
        refs.sectorId,
        ...(Array.isArray(refs.productionStages)
          ? refs.productionStages.map((stage) => stage?.id)
          : []),
      ],
      { companyId },
      'Setor não encontrado.',
    );
  }

  /**
   * O bloco do produto terceirizado (T-5): fornecedor obrigatório (um ou
   * mais, da empresa) e custo do fornecedor por unidade; desligado, limpa
   * os dois. Sem o campo no corpo, não mexe.
   */
  private async outsourcedData(
    companyId: string | null | undefined,
    dto: {
      isOutsourced?: boolean;
      outsourcedCost?: number | null;
      supplierIds?: string[];
    },
    mode: 'create' | 'update',
  ) {
    if (dto.isOutsourced === undefined) return {};
    if (!dto.isOutsourced) {
      return {
        isOutsourced: false,
        outsourcedCost: null,
        ...(mode === 'update' ? { suppliers: { set: [] } } : {}),
      };
    }
    const ids = [...new Set(dto.supplierIds ?? [])];
    if (!ids.length) {
      throw new BadRequestException(
        'Informe pelo menos um fornecedor do terceirizado',
      );
    }
    if (!(Number(dto.outsourcedCost) > 0)) {
      throw new BadRequestException('Informe o custo do fornecedor');
    }
    const found = await this.prisma.supplier.count({
      where: { id: { in: ids }, ...(companyId ? { companyId } : {}) },
    });
    if (found !== ids.length) {
      throw new NotFoundException('Fornecedor não encontrado');
    }
    const refs = ids.map((id) => ({ id }));
    return {
      isOutsourced: true,
      outsourcedCost: Number(dto.outsourcedCost),
      suppliers: mode === 'create' ? { connect: refs } : { set: refs },
    };
  }

  /**
   * A estrutura do produto (18/11/2026) e o terceirizado, que passa a ser o
   * espelho dela (OUTSOURCED). A estrutura manda:
   * - OUTSOURCED com fornecedor ou custo no corpo confere como o terceirizado
   *   sempre conferiu; sem eles, reaproveita os guardados;
   * - as outras desligam o terceirizado sem apagar fornecedor e custo (a
   *   troca de estrutura guarda os dados do bloco que some);
   * - o corpo antigo, só com isOutsourced, leva a estrutura junto.
   */
  private async structureData(
    companyId: string | null | undefined,
    dto: {
      structure?: ProductStructure;
      isOutsourced?: boolean;
      outsourcedCost?: number | null;
      supplierIds?: string[];
    },
    mode: 'create' | 'update',
    current?: {
      structure: ProductStructure;
      outsourcedCost: number | null;
      suppliers: number;
    },
  ) {
    const { structure } = dto;
    if (
      structure !== undefined &&
      dto.isOutsourced !== undefined &&
      dto.isOutsourced !== (structure === 'OUTSOURCED')
    ) {
      throw new BadRequestException(STRUCTURE_MISMATCH);
    }
    if (structure === undefined) {
      const outsourced = await this.outsourcedData(companyId, dto, mode);
      if (dto.isOutsourced === undefined) return outsourced;
      const kept =
        current && current.structure !== 'OUTSOURCED'
          ? current.structure
          : 'STANDARD';
      return {
        ...outsourced,
        structure: dto.isOutsourced ? 'OUTSOURCED' : kept,
      } as const;
    }
    if (structure !== 'OUTSOURCED') {
      return { structure, isOutsourced: false };
    }
    const sendsBlock =
      dto.supplierIds !== undefined || dto.outsourcedCost !== undefined;
    if (sendsBlock || !current) {
      return {
        ...(await this.outsourcedData(
          companyId,
          { ...dto, isOutsourced: true },
          mode,
        )),
        structure,
      };
    }
    if (!current.suppliers || !(Number(current.outsourcedCost) > 0)) {
      throw new BadRequestException(OUTSOURCED_BLOCK_REQUIRED);
    }
    return { structure, isOutsourced: true };
  }

  async create(createProductDto: CreateProductDto) {
    await this.assertRefsOfCompany(createProductDto.companyId, {
      categoryId: createProductDto.categoryId,
      sectorId: createProductDto.sectorId,
      productionStages: createProductDto.productionStages as any,
    });

    try {
      console.log(
        'Creating product with isService:',
        createProductDto.isService,
      );
      // Check if product code already exists
      const existingProduct = await this.prisma.product.findFirst({
        where: {
          code: createProductDto.code,
          companyId: createProductDto.companyId,
        },
      });

      if (existingProduct) {
        throw new BadRequestException('Código de produto já existe');
      }

      // Processar itens do produto
      const items =
        createProductDto.items?.map((item, index) => ({
          // A ordem do cadastro (Lista Lite 24/11, item 3)
          position: index,
          name: item.name,
          unitKind: item.unitKind,
          unitCost: item.unitCost,
          salePrice: item.salePrice,
          width: item.width,
          height: item.height,
          length: item.length,
          weight: item.weight,
          volume: item.volume,
          distance: item.distance,
          duration: item.duration,
        })) || [];

      const productionStages = createProductDto.productionStages || [];

      const outsourced = await this.structureData(
        createProductDto.companyId,
        createProductDto,
        'create',
      );
      // Criação do produto com tratamento para inserção condicional de itens
      const created = await this.prisma.product.create({
        data: {
          name: createProductDto.name,
          code: createProductDto.code,
          isActive: createProductDto.isActive,
          isStandard: createProductDto.isStandard,
          isService: createProductDto.isService,
          companyId: createProductDto.companyId || undefined,
          categoryId: createProductDto.categoryId || undefined,
          sectorId: createProductDto.sectorId || undefined,
          technicalDescription:
            createProductDto.technicalDescription || undefined,
          allowEditDescription: createProductDto.allowEditDescription,
          allowEditValues: createProductDto.allowEditValues,
          minQuantity: createProductDto.minQuantity ?? null,
          ...outsourced,
          imageUrl: createProductDto.imageUrl || undefined,
          imageSize: createProductDto.imageSize || undefined,
          items: {
            create: items,
          },
          productionStages: JSON.parse(JSON.stringify(productionStages)),
        },
      });

      // Auto-populate fiscal data with defaults for new products
      if (createProductDto.companyId) {
        try {
          await this.productFiscalService.getOrCreateWithDefaults(
            created.id,
            createProductDto.companyId,
          );
        } catch (error) {
          console.error(
            'Failed to auto-populate fiscal data for product:',
            error.message,
          );
          // Don't fail product creation if fiscal data auto-population fails
        }
      }

      return created;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(error);
    }
  }

  async findAllQuantity(companyId: string) {
    const [activeCount, inactiveCount] = await Promise.all([
      this.prisma.product.count({
        where: { companyId, isActive: true },
      }),
      this.prisma.product.count({
        where: { companyId, isActive: false },
      }),
    ]);

    const total = activeCount + inactiveCount;

    return {
      ACTIVE: activeCount,
      INACTIVE: inactiveCount,
      TOTAL: total,
    };
  }
  async findAll(filter: ProductFilterDTO) {
    try {
      console.log('FindAll Product Filter:', JSON.stringify(filter));
      // Montagem do where extraída para função pura: a alteração de NCM em
      // massa com escopo "todos os produtos" precisa atingir exatamente o
      // mesmo conjunto que esta listagem mostra.
      const where = buildProductListWhere(filter);

      const list = (
        part: Prisma.ProductWhereInput,
        skip: number,
        take: number,
      ) =>
        take > 0
          ? this.prisma.product.findMany({
              where: part,
              select: {
                id: true,
                name: true,
                code: true,
                isActive: true,
                isOutsourced: true,
                structure: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                    kind: true,
                  },
                },
                sector: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                items: {
                  select: {
                    unitCost: true,
                    salePrice: true,
                    unitKind: true,
                  },
                },
                fiscalData: {
                  select: {
                    ncm: true,
                    cest: true,
                    cfopInState: true,
                    cfopOutState: true,
                    icmsCst: true,
                    pisCst: true,
                    cofinsCst: true,
                    codigoServico: true,
                    aliquotaIss: true,
                    discriminacao: true,
                  },
                },
                // A marca da composição na lista (CP-17)
                assemblies: {
                  where: { variationKey: '' },
                  select: {
                    status: true,
                    _count: { select: { blocks: true } },
                  },
                },
                _count: { select: { variations: true } },
                // As variações, para a lista poder mostrar cada uma sob o
                // produto (LITE part3, item 4, 28/10/2026)
                variations: {
                  select: { id: true, name: true, unitPrice: true },
                  orderBy: { position: 'asc' },
                },
              },
              take,
              skip,
              // A tela de produtos pede a ordem de cadastro (LITE part3,
              // item 4); quem não pede (seletores) segue por nome
              orderBy:
                filter.orderBy === 'createdAt'
                  ? [
                      {
                        createdAt:
                          filter.orderDirection === 'desc' ? 'desc' : 'asc',
                      },
                      { name: 'asc' },
                    ]
                  : { name: 'asc' },
            })
          : Promise.resolve([]);

      // A página começa pelos Produtos base que couberem nela; o resto é a
      // lista em ordem de nome, sem eles
      const bases = { AND: [where, BASE_PRODUCT_WHERE] };
      const others = { AND: [where, { NOT: BASE_PRODUCT_WHERE }] };
      const limit = +filter.limit;
      const skip = (+filter.page - 1) * limit;
      const [total, baseTotal] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.count({ where: bases }),
      ]);
      const baseTake = Math.max(0, Math.min(limit, baseTotal - skip));
      const [baseRows, otherRows] = await Promise.all([
        list(bases, skip, baseTake),
        list(others, Math.max(0, skip - baseTotal), limit - baseTake),
      ]);
      const products = [...baseRows, ...otherRows];

      // Mapear os produtos para calcular os totais de unitCost e salePrice
      const data = products.map((product) => {
        const {
          id,
          name,
          code,
          isActive,
          sector,
          category,
          items,
          fiscalData,
          assemblies,
          _count,
        } = product;
        const composition = assemblies[0];

        // Calculando os totais
        const unitCost = items.reduce(
          (sum, item) => sum + (item.unitCost || 0),
          0,
        );
        const salePrice = items.reduce(
          (sum, item) => sum + (item.salePrice || 0),
          0,
        );

        return {
          id,
          name,
          code,
          isActive,
          categoryId: category?.id || null,
          category: category || null,
          sectorId: sector?.id || null,
          sectorName: sector?.name || null,
          unitOfMeasureCode: 'UN',
          unitCost,
          salePrice,
          fiscalData: fiscalData || null,
          hasComposition: !!composition?._count.blocks,
          isOutsourced: product.isOutsourced,
          structure: product.structure,
          compositionStatus: composition?._count.blocks
            ? composition.status
            : null,
          hasVariations: _count.variations > 0,
          variations: (product.variations ?? []).map((variation) => ({
            id: variation.id,
            name: variation.name,
            unitPrice: variation.unitPrice,
          })),
          items: items.map((item) => ({
            unitCost: item.unitCost,
            salePrice: item.salePrice,
            unitKind: item.unitKind,
          })),
        };
      });

      return {
        total,
        lastPage: Math.ceil(total / +filter.limit),
        data,
      };
    } catch (error) {
      console.error(error.message);
      throw error;
    }
  }

  async findAllForExport(filter: ProductFilterDTO) {
    const result = await this.findAll({
      ...filter,
      page: '1',
      limit: EXPORT_LIMIT,
    });

    return {
      total: result.total,
      exportLimit: Number(EXPORT_LIMIT),
      data: result.data,
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        // Na ordem em que foram cadastradas (Lista Lite 24/11, item 3): por
        // nome, a segunda unidade de venda vinha antes da primeira
        items: {
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
        },
        // Em ordem de nome: o primeiro é o fornecedor que recebe a despesa do
        // terceirizado quando o item não escolhe outro (T-3, patch 39)
        suppliers: {
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const productionStages = product.productionStages as JsonArray | null;

    if (productionStages !== null && !Array.isArray(productionStages)) {
      throw new Error('Invalid data for productionStages');
    }

    // Se productionStages for null ou não for um array válido, inicializar como array vazio
    const validProductionStages = Array.isArray(productionStages)
      ? productionStages
      : [];

    // Só os setores da empresa do produto: sem o filtro, as etapas do
    // formulário traziam os setores de produção de todas as empresas
    const allSectors = await this.prisma.companySector.findMany({
      where: {
        companyId: product.companyId,
        isProductionStage: true,
        isSystem: false,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        isActive: true,
      },
    });

    // Filtra apenas setores ativos
    const activeSectors = allSectors.filter((sector) => sector.isActive);

    const existingSectorIds = validProductionStages
      .filter((stage) => (stage as { id: string; isActive: boolean }).isActive)
      .map((stage: { id: string; isActive: boolean }) => ({
        id: stage.id,
        isActive: stage.isActive,
      }));

    const newSectors = activeSectors.filter(
      (sector) => !existingSectorIds.some((stage) => stage.id === sector.id),
    );

    const existingProductionStagesWithDetails = await Promise.all(
      existingSectorIds.map(async (stage) => {
        const sector = activeSectors.find((s) => s.id === stage.id);
        return sector
          ? {
              id: stage.id,
              isActive: stage.isActive,
              ...sector,
            }
          : null;
      }),
    );

    // Remove qualquer entrada nula
    const validExistingProductionStages =
      existingProductionStagesWithDetails.filter(Boolean);

    const newProductionStages = newSectors.map((sector) => ({
      id: sector.id,
      isActive: false,
      name: sector.name,
      icon: sector.icon,
    }));

    const productionStagesWithDetails = [
      ...validExistingProductionStages,
      ...newProductionStages,
    ];

    // A situação da composição padrão (18/11/2026): com ela aprovada, a
    // contagem de folhas vem da composição e o cadastro esconde o cartão
    // "Impressão" do produto
    const composition = await this.prisma.productAssembly.findFirst({
      where: { productId: id, variationKey: '' },
      select: { status: true, _count: { select: { blocks: true } } },
    });

    return {
      ...product,
      productionStages: productionStagesWithDetails,
      compositionStatus: composition?._count.blocks ? composition.status : null,
    };
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const owner = await this.prisma.product.findUnique({
      where: { id },
      select: {
        companyId: true,
        categoryId: true,
        sectorId: true,
        productionStages: true,
      },
    });
    // Sem o produto, o fluxo abaixo responde o 404
    if (owner) {
      // Confere só o que muda (Lista Lite 19/11, item 5): o setor, o grupo e
      // as etapas que o produto já tinha passam, mesmo de um cadastro antigo
      // de setores; só o id novo precisa ser da empresa. Antes, editar e
      // salvar sem mexer no setor dava "Setor não encontrado"
      const savedStages = new Set(
        (Array.isArray(owner.productionStages)
          ? (owner.productionStages as { id?: string }[])
          : []
        ).map((stage) => stage?.id),
      );
      const stages = updateProductDto.productionStages as
        | { id?: string }[]
        | null
        | undefined;
      await this.assertRefsOfCompany(owner.companyId, {
        categoryId:
          updateProductDto.categoryId === owner.categoryId
            ? undefined
            : updateProductDto.categoryId,
        sectorId:
          updateProductDto.sectorId === owner.sectorId
            ? undefined
            : updateProductDto.sectorId,
        productionStages: Array.isArray(stages)
          ? stages.filter((stage) => !savedStages.has(stage?.id))
          : stages,
      });
    }

    try {
      console.log(
        'Updating product',
        id,
        'isService:',
        updateProductDto.isService,
      );
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: { items: true, _count: { select: { suppliers: true } } },
      });

      if (!product) {
        throw new BadRequestException('Product not found');
      }

      // Check if the new code already exists for another product
      if (updateProductDto.code && updateProductDto.code !== product.code) {
        const existingProduct = await this.prisma.product.findFirst({
          where: {
            code: updateProductDto.code,
            companyId: updateProductDto.companyId || product.companyId,
            id: { not: id }, // Exclude current product
          },
        });

        if (existingProduct) {
          throw new BadRequestException('Produto com este código já existe');
        }
      }

      const outsourced = await this.structureData(
        product.companyId,
        updateProductDto,
        'update',
        {
          structure: product.structure,
          outsourcedCost: product.outsourcedCost,
          suppliers: product._count?.suppliers ?? 0,
        },
      );
      const nextStructure = (outsourced as { structure?: ProductStructure })
        .structure;
      if (
        product.structure &&
        nextStructure &&
        nextStructure !== product.structure
      ) {
        const sold = await this.prisma.quotationProduct.count({
          where: { productId: id },
        });
        if (sold > 0) throw new BadRequestException(STRUCTURE_LOCKED);
      }
      const items = updateProductDto.items?.map((item, index) => ({
        id: item.id,
        // A ordem em que vêm na tela é a ordem do cadastro (item 3, 24/11)
        position: index,
        name: item.name,
        unitKind: item.unitKind,
        unitCost: item.unitCost,
        salePrice: item.salePrice,
        width: item.width,
        height: item.height,
        length: item.length,
        weight: item.weight,
        volume: item.volume,
        distance: item.distance,
        duration: item.duration,
      }));

      const itemsWithId = items?.filter((item) => item.id);
      const itemsWithoutId = items?.filter((item) => !item.id);

      // Identificar IDs dos itens presentes no banco e não enviados no body.
      // Sem `items` no corpo, a edição é parcial (descritivo, permissões):
      // nenhum item sai. Antes, o PATCH sem a lista apagava todos os itens
      // e as referências deles nos itens de orçamento
      const existingItemIds = product.items.map((item) => item.id);
      const incomingItemIds = itemsWithId?.map((item) => item.id) || [];
      const itemsToRemove = updateProductDto.items
        ? existingItemIds.filter((id) => !incomingItemIds.includes(id))
        : [];

      // Remover itens que não foram enviados no body
      if (itemsToRemove.length > 0) {
        // Primeiro, remover referências em quotation_product_items
        await this.prisma.quotationProductItem.deleteMany({
          where: {
            productItemId: { in: itemsToRemove },
          },
        });

        // Depois, remover os product items
        await this.prisma.productItem.deleteMany({
          where: {
            id: { in: itemsToRemove },
          },
        });
      }

      return await this.prisma.product.update({
        where: { id },
        data: {
          ...(updateProductDto.name !== undefined && {
            name: updateProductDto.name,
          }),
          ...(updateProductDto.code !== undefined && {
            code: updateProductDto.code,
          }),
          ...(updateProductDto.isActive !== undefined && {
            isActive: updateProductDto.isActive,
          }),
          ...(updateProductDto.isService !== undefined && {
            isService: updateProductDto.isService,
          }),
          ...(updateProductDto.imageUrl !== undefined && {
            imageUrl: updateProductDto.imageUrl,
          }),
          ...(updateProductDto.imageSize !== undefined && {
            imageSize: updateProductDto.imageSize,
          }),
          ...(updateProductDto.isStandard !== undefined && {
            isStandard: updateProductDto.isStandard,
          }),
          ...(updateProductDto.companyId !== undefined && {
            companyId: updateProductDto.companyId || undefined,
          }),
          ...(updateProductDto.categoryId !== undefined && {
            categoryId: updateProductDto.categoryId || undefined,
          }),
          ...(updateProductDto.sectorId !== undefined && {
            sectorId: updateProductDto.sectorId || undefined,
          }),
          ...(updateProductDto.status !== undefined && {
            status: updateProductDto.status,
          }),
          ...(updateProductDto.technicalDescription !== undefined && {
            technicalDescription:
              updateProductDto.technicalDescription || undefined,
          }),
          ...(updateProductDto.allowEditDescription !== undefined && {
            allowEditDescription: updateProductDto.allowEditDescription,
          }),
          ...(updateProductDto.allowEditValues !== undefined && {
            allowEditValues: updateProductDto.allowEditValues,
          }),
          // O terceirizado vale por si: dentro do bloco acima, só gravava
          // quando o corpo trazia também o allowEditValues
          ...outsourced,
          ...(updateProductDto.minQuantity !== undefined && {
            minQuantity: updateProductDto.minQuantity,
          }),
          items: {
            upsert: itemsWithId?.map((item) => ({
              where: { id: item.id },
              create: item,
              update: item,
            })),
            create: itemsWithoutId?.map((item) => ({ ...item })),
          },
          // Sem `productionStages` no corpo, as etapas ficam como estão
          ...(updateProductDto.productionStages !== undefined && {
            productionStages: JSON.parse(
              JSON.stringify(updateProductDto.productionStages || []),
            ),
          }),
        },
      });
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error);
    }
  }

  async toggleStatus(id: string, isActive: boolean) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          sector: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // Se está tentando ativar o produto, validar se o setor está ativo
      if (isActive && product.sectorId) {
        if (!product.sector) {
          throw new BadRequestException('Setor do produto não encontrado');
        }

        if (!product.sector.isActive) {
          throw new BadRequestException(
            'Não é possível ativar o produto porque o setor está inativo',
          );
        }
      }

      return this.prisma.product.update({
        where: { id },
        data: {
          isActive: isActive,
        },
      });
    } catch (error) {
      throw new BadRequestException(error);
    }
  }

  async remove(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        throw new BadRequestException('Product not found');
      }
      return this.prisma.product.update({
        where: { id },
        data: {
          isActive: false,
        },
      });
    } catch (error) {
      throw new BadRequestException(error);
    }
  }

  async removeItem(id: string) {
    try {
      return this.prisma.productItem.delete({
        where: { id },
      });
    } catch (error) {
      throw new BadRequestException(error);
    }
  }

  async createProductsFromCsv(filePath: string, companyId: string) {
    const products: any[] = [];
    const processedCategories = new Set<string>();
    const productCodes = new Map<string, number>();

    // Removido: não precisamos mais buscar unidades de medida padrão

    // Mapeamento de unidades de medida
    const unitMapping: { [key: string]: string } = {
      M2: 'M²',
      M: 'MT',
      LT: 'LT',
      UN: 'UN',
      KG: 'KG',
      KM: 'KM',
      HH: 'HH',
      ML: 'ML',
      GR: 'GR',
      CM: 'CM',
      MM: 'MM',
      MG: 'MG',
    };

    return new Promise<void>((resolve, reject) => {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(1024);
      const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
      fs.closeSync(fd);

      const firstChunk = buffer.toString('utf-8', 0, bytesRead);
      const headLine = firstChunk.split('\n')[0] || '';
      const commaCount = (headLine.match(/,/g) || []).length;
      const semicolonCount = (headLine.match(/;/g) || []).length;
      const delimiter = semicolonCount > commaCount ? ';' : ',';

      // Coleta todas as linhas antes de processar para evitar race condition.
      // O handler .on('data', async ...) do fast-csv NÃO aguarda a Promise de
      // cada linha, processando tudo em paralelo e causando itens de produtos
      // diferentes serem associados ao mesmo produto.
      const rows: any[] = [];

      fs.createReadStream(filePath)
        .pipe(
          fastCsv.parse({
            headers: [
              'idproduto',
              'fkidsetor',
              'fkidcategoria',
              'fkiditemconfnfe',
              'fkidsubcategoria',
              'fkidtipocalculo',
              'fkidservico_1',
              'fkidalbum',
              'tipo_producao',
              'tipo_produto',
              'tipo_locacao',
              'controlar_estoque',
              'nome',
              'cod',
              'descricao',
              'volume_de_venda_media_mes',
              'fkidstatus',
              'disponivel_venda_unitaria',
              'idcategoria',
              'categoria',
              'fkidcategoria_parent',
              'fkidstatus_categoria',
              'idsetor',
              'setor',
              'icone_setor',
              'carga_producao',
              'perc_rateio_indireto',
              'custo_rateio',
              'custo_direto_total',
              'custo_total',
              'permite_rateio',
              'rateio_perc_serv',
              'rateio_valor_serv',
              'rateio_perc_mat',
              'rateio_valor_mat',
              'fkidtiposervico',
              'fkidservico_2',
              'fixed',
              'opcional',
              'actived',
              'setor_fkidcentrodecusto',
              'ordem_ico_venda',
              'idservico',
              'fkidsetor_2',
              'fkidcategoria_2',
              'fkidtipocalculo_2',
              'tipo',
              'servico',
              'descricao_2',
              'media_venda_mes',
              'def_custo_by_sys',
              'custo',
              'perc_tributacao',
              'perc_despesas_gerais',
              'perc_comissao',
              'perc_lucro',
              'mrkp',
              'valor',
              'valor_sugerido',
              'servfkidstatus',
              'is_valor_fixo',
              'human_edit',
              'ser_un_comercial',
              'iduncom',
              'uncom',
              'unidadecomercial',
              'input_icon',
              'input_mask',
            ],
            delimiter,
            trim: true,
            skipRows: 1,
          }),
        )
        // Coleta linhas de forma síncrona — sem async aqui para evitar race condition
        .on('data', (row) => {
          rows.push(row);
        })
        .on('error', (error) => {
          console.error('Erro ao processar CSV:', error);
          reject(error);
        })
        .on('end', () => {
          // Processa cada linha SEQUENCIALMENTE após coletar todas
          (async () => {
            try {
              for (const row of rows) {
                let categoryId = null;
                console.log('Processando linha com categoria:', row.categoria);

                if (row.categoria) {
                  console.log(
                    'Categoria existe, verificando se já foi processada:',
                    processedCategories.has(row.categoria),
                  );

                  if (!processedCategories.has(row.categoria)) {
                    processedCategories.add(row.categoria);
                    console.log('Categoria adicionada ao Set:', row.categoria);

                    const category = await this.prisma.$transaction(
                      async (prisma) => {
                        let existingCategory = await prisma.category.findFirst({
                          where: {
                            name: row.categoria,
                            companyId,
                            kind: 'PRODUCT',
                          },
                        });

                        if (!existingCategory) {
                          console.log('Criando nova categoria:', row.categoria);
                          existingCategory = await prisma.category.create({
                            data: {
                              name: row.categoria,
                              companyId,
                              kind: 'PRODUCT',
                              isActive: true,
                            },
                          });
                        } else {
                          console.log('Categoria já existe:', row.categoria);
                        }
                        return existingCategory;
                      },
                    );
                    categoryId = category.id;
                  } else {
                    console.log(
                      'Categoria já processada anteriormente:',
                      row.categoria,
                    );
                    const existingCategory =
                      await this.prisma.category.findFirst({
                        where: {
                          name: row.categoria,
                          companyId,
                          kind: 'PRODUCT',
                        },
                      });
                    if (existingCategory) {
                      categoryId = existingCategory.id;
                    }
                  }
                } else {
                  console.log('Linha sem categoria definida');
                }

                console.log('categoryId final:', categoryId);

                // Verificar código duplicado (seguro pois é sequencial)
                let productCode = row.cod;
                if (productCodes.has(productCode)) {
                  const count = productCodes.get(productCode) + 1;
                  productCodes.set(productCode, count);
                  productCode = `${productCode}${count}`;
                } else {
                  productCodes.set(productCode, 0);
                }

                // Buscar setor
                let sectorId = null;
                if (row.setor) {
                  const sector = await this.prisma.companySector.findFirst({
                    where: { name: row.setor, companyId },
                  });
                  if (sector) sectorId = sector.id;
                }

                // Criar produto
                const product = await this.prisma.product.create({
                  data: {
                    name: row.nome,
                    code: productCode,
                    status: 'ACTIVE',
                    isActive: true,
                    companyId,
                    categoryId,
                    sectorId,
                  },
                });

                // Criar item do produto
                if (row.servico) {
                  const unitCode = unitMapping[row.uncom] || row.uncom;
                  let unitKind = null;
                  const measures: any = {};

                  switch (unitCode) {
                    case 'M²':
                      unitKind = 'AREA';
                      measures.width = 1;
                      measures.length = 1;
                      break;
                    case 'MT':
                    case 'CM':
                    case 'MM':
                      unitKind = 'LENGTH';
                      measures.height = 1;
                      break;
                    case 'UN':
                      unitKind = 'UNITY';
                      break;
                    case 'KG':
                    case 'GR':
                    case 'MG':
                      unitKind = 'WEIGHT';
                      measures.weight = 1;
                      break;
                    case 'KM':
                      unitKind = 'DISTANCE';
                      measures.distance = 1;
                      break;
                    case 'HH':
                      unitKind = 'DURATION';
                      measures.duration = 1;
                      break;
                    case 'LT':
                    case 'ML':
                      unitKind = 'CAPACITY';
                      measures.volume = 1;
                      break;
                  }

                  if (unitKind) {
                    await this.prisma.productItem.create({
                      data: {
                        name: row.servico,
                        productId: product.id,
                        unitKind: unitKind,
                        unitCost: parseFloat(row.custo) || 0,
                        salePrice: parseFloat(row.valor) || 0,
                        ...measures,
                      },
                    });
                  }
                }

                products.push(product);
              }

              console.log(
                `Importação concluída. ${products.length} produtos importados.`,
              );
              resolve();
            } catch (error) {
              console.error('Erro ao processar linha do CSV:', error);
              reject(error);
            }
          })();
        });
    });
  }
}
