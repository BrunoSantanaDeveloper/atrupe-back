import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { PrismaService } from 'nestjs-prisma';
import { ProductFilterDTO } from './dto/filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductStatus } from '@prisma/client';
import { JsonArray } from '@prisma/client/runtime/library';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    try {
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

      const items = createProductDto.items?.map((item) => ({
        name: item.name,
        unitOfMeasureId: item.unitOfMeasureId,
        unitCost: item.unitCost,
        salePrice: item.salePrice,
        width: item.width || undefined,
        height: item.height || undefined,
        length: item.length || undefined,
        weight: item.weight || undefined,
        volume: item.volume || undefined,
        distance: item.distance || undefined,
        duration: item.duration || undefined,
      }));
      const productionStages = createProductDto.productionStages || [];
      // Criação do produto com tratamento para inserção condicional de itens
      const created = await this.prisma.product.create({
        data: {
          name: createProductDto.name,
          code: createProductDto.code,
          isActive: createProductDto.isActive,
          isStandard: createProductDto.isStandard,
          companyId: createProductDto.companyId || undefined,
          categoryId: createProductDto.categoryId || undefined,
          sectorId: createProductDto.sectorId || undefined,
          technicalDescription:
            createProductDto.technicalDescription || undefined,
          allowEditDescription: createProductDto.allowEditDescription,
          allowEditValues: createProductDto.allowEditDescription,
          imageUrl: createProductDto.imageUrl || undefined,
          items: {
            create: items,
          },
          productionStages: JSON.parse(JSON.stringify(productionStages)),
        },
      });

      return created;
    } catch (error) {
      throw new BadRequestException('Failed to create product', error.message);
    }
  }

  async findAllQuantity(companyId: string) {
    const allStatuses: ProductStatus[] = ['ACTIVE', 'INACTIVE'];

    const result = await this.prisma.product.groupBy({
      by: ['status'],
      where: { companyId, status: { in: allStatuses } },
      _count: true,
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in ProductStatus]: number },
    );

    result.forEach((cur) => {
      statusCount[cur.status] = cur._count;
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      TOTAL: total,
    };
  }
  async findAll(filter: ProductFilterDTO) {
    try {
      let where = {};
      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
      }

      if (filter.categoryId) {
        where = { ...where, categoryId: filter.categoryId };
      }

      if (filter.unitOfMeasureId) {
        where = { ...where, unitOfMeasureId: filter.unitOfMeasureId };
      }

      if (filter.sectorId) {
        where = { ...where, sectorId: filter.sectorId };
      }

      if (filter.status) {
        where = { ...where, status: filter.status };
      }

      if (filter.search) {
        where = {
          ...where,
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { code: { contains: filter.search, mode: 'insensitive' } },
            {
              technicalDescription: {
                contains: filter.search,
                mode: 'insensitive',
              },
            },
          ],
        };
      }

      const [total, products] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where: where,
          select: {
            id: true,
            name: true,
            code: true,
            category: {
              select: {
                id: true,
                name: true,
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
                unitOfMeasure: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: { name: 'asc' },
        }),
      ]);

      // Mapear os produtos para calcular os totais de unitCost e salePrice
      const data = products.map((product) => {
        const { id, name, code, sector, category, items } = product;

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
          categoryId: category?.id || null,
          sectorId: sector?.id || null,
          sectorName: sector?.name || null,
          unitOfMeasureCode: 'UN',
          unitCost,
          salePrice,
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

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: {
            name: 'asc',
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const productionStages = product.productionStages as JsonArray | null;

    if (!Array.isArray(productionStages)) {
      throw new Error('Invalid data for productionStages');
    }

    const allSectors = await this.prisma.companySector.findMany({
      where: { isProductionStage: true, isSystem: false },
      select: { id: true, name: true, icon: true, isActive: true },
    });

    // Filtra apenas setores ativos
    const activeSectors = allSectors.filter((sector) => sector.isActive);

    const existingSectorIds = productionStages
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

    return {
      ...product,
      productionStages: productionStagesWithDetails,
    };
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: { items: true },
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

      const items = updateProductDto.items?.map((item) => ({
        id: item.id,
        name: item.name,
        unitOfMeasureId: item.unitOfMeasureId,
        unitCost: item.unitCost,
        salePrice: item.salePrice,
        width: item.width || undefined,
        height: item.height || undefined,
        length: item.length || undefined,
        weight: item.weight || undefined,
        volume: item.volume || undefined,
        distance: item.distance || undefined,
        duration: item.duration || undefined,
      }));

      const itemsWithId = items?.filter((item) => item.id);
      const itemsWithoutId = items?.filter((item) => !item.id);

      // Identificar IDs dos itens presentes no banco e não enviados no body
      const existingItemIds = product.items.map((item) => item.id);
      const incomingItemIds = itemsWithId?.map((item) => item.id) || [];
      const itemsToRemove = existingItemIds.filter(
        (id) => !incomingItemIds.includes(id),
      );

      const productionStages = updateProductDto.productionStages || [];

      // Remover itens que não foram enviados no body
      if (itemsToRemove.length > 0) {
        await this.prisma.productItem.deleteMany({
          where: {
            id: { in: itemsToRemove },
          },
        });
      }

      return await this.prisma.product.update({
        where: { id },
        data: {
          name: updateProductDto.name,
          code: updateProductDto.code,
          isActive: updateProductDto.isActive,
          imageUrl: updateProductDto.imageUrl,
          isStandard: updateProductDto.isStandard,
          companyId: updateProductDto.companyId || undefined,
          categoryId: updateProductDto.categoryId || undefined,
          sectorId: updateProductDto.sectorId || undefined,
          status: updateProductDto.status,
          technicalDescription:
            updateProductDto.technicalDescription || undefined,
          allowEditDescription: updateProductDto.allowEditDescription,
          allowEditValues: updateProductDto.allowEditValues,
          items: {
            upsert: itemsWithId?.map((item) => ({
              where: { id: item.id },
              create: item,
              update: item,
            })),
            create: itemsWithoutId?.map((item) => ({ ...item })),
          },
          productionStages: JSON.parse(JSON.stringify(productionStages)),
        },
      });
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Failed to update product', error.message);
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
      throw new BadRequestException('Failed to delete product', error.message);
    }
  }

  async removeItem(id: string) {
    try {
      return this.prisma.productItem.delete({
        where: { id },
      });
    } catch (error) {
      throw new BadRequestException(
        'Failed to delete product item',
        error.message,
      );
    }
  }

  async createProductsFromCsv(filePath: string, companyId: string) {
    const products: any[] = [];
    const processedCategories = new Set<string>();
    const productCodes = new Map<string, number>();

    // Buscar unidades de medida padrão
    const defaultUnits = await this.prisma.defaultUnitOfMeasure.findMany({
      where: { isActive: true },
      select: { id: true, code: true },
    });

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
            delimiter: ',',
            trim: true,
            skipRows: 1,
          }),
        )
        .on('data', async (row) => {
          try {
            let categoryId = null;
            console.log('Processando linha com categoria:', row.categoria);

            // Verificar se a categoria já foi processada
            if (row.categoria) {
              console.log(
                'Categoria existe, verificando se já foi processada:',
                processedCategories.has(row.categoria),
              );

              if (!processedCategories.has(row.categoria)) {
                processedCategories.add(row.categoria);
                console.log('Categoria adicionada ao Set:', row.categoria);

                // Buscar ou criar categoria
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
                // Buscar a categoria existente
                const existingCategory = await this.prisma.category.findFirst({
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

            // Verificar código duplicado
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
                where: {
                  name: row.setor,
                  companyId,
                },
              });
              if (sector) {
                sectorId = sector.id;
              }
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
              // Encontrar unidade de medida correspondente
              const unitCode = unitMapping[row.uncom] || row.uncom;
              const unitOfMeasure = defaultUnits.find(
                (unit) => unit.code === unitCode,
              );

              if (unitOfMeasure) {
                // Definir medidas baseado na unidade
                const measures: any = {};
                switch (unitCode) {
                  case 'M²':
                    measures.width = 1;
                    measures.length = 1;
                    break;
                  case 'MT':
                    measures.height = 1;
                    break;
                  case 'UN':
                    break;
                  case 'KG':
                    measures.weight = 1;
                    break;
                  case 'KM':
                    measures.distance = 1;
                    break;
                  case 'HH':
                    measures.duration = 1;
                    break;
                }

                await this.prisma.productItem.create({
                  data: {
                    name: row.servico,
                    productId: product.id,
                    unitOfMeasureId: unitOfMeasure.id,
                    unitCost: parseFloat(row.custo) || 0,
                    salePrice: parseFloat(row.valor) || 0,
                    ...measures,
                  },
                });
              }
            }

            products.push(product);
          } catch (error) {
            console.error('Erro ao processar linha do CSV:', error);
            reject(error);
          }
        })
        .on('end', () => {
          console.log(
            `Importação concluída. ${products.length} produtos importados.`,
          );
          resolve();
        })
        .on('error', (error) => {
          console.error('Erro ao processar CSV:', error);
          reject(error);
        });
    });
  }
}
