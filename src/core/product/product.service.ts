import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { PrismaService } from 'nestjs-prisma';
import { ProductFilterDTO } from './dto/filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';

import { JsonArray } from '@prisma/client/runtime/library';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';
import { ProductFiscalService } from '../fiscal/product-fiscal/product-fiscal.service';
import { buildProductListWhere } from './product-list-where.util';

const EXPORT_LIMIT = '10000';

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productFiscalService: ProductFiscalService,
  ) {}

  async create(createProductDto: CreateProductDto) {
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
        createProductDto.items?.map((item) => ({
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

      const [total, products] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where: where,
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
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
                // A busca de produtos da nota fiscal escolhe valor e unidade
                // pela unidade comercial cadastrada.
                commercialUnit: true,
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
          },
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: { name: 'asc' },
        }),
      ]);

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
        } = product;

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

    if (productionStages !== null && !Array.isArray(productionStages)) {
      throw new Error('Invalid data for productionStages');
    }

    // Se productionStages for null ou não for um array válido, inicializar como array vazio
    const validProductionStages = Array.isArray(productionStages)
      ? productionStages
      : [];

    const allSectors = await this.prisma.companySector.findMany({
      where: { isProductionStage: true, isSystem: false },
      select: { id: true, name: true, icon: true, isActive: true },
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

    return {
      ...product,
      productionStages: productionStagesWithDetails,
    };
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    try {
      console.log(
        'Updating product',
        id,
        'isService:',
        updateProductDto.isService,
      );
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
      // Corpo sem `items` não mexe nos itens: antes contava como "nenhum
      // enviado" e apagava todos, junto com as composições das O.S.
      const existingItemIds = product.items.map((item) => item.id);
      const incomingItemIds = itemsWithId?.map((item) => item.id) || [];
      const itemsToRemove = items
        ? existingItemIds.filter((id) => !incomingItemIds.includes(id))
        : [];

      // Mesma regra para as etapas: sem o campo, ficam as que estão. O
      // "Salvar no produto" da nota mandava só os itens e zerava as etapas.
      const productionStages = updateProductDto.productionStages;

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
          ...(items && {
            items: {
              upsert: itemsWithId?.map((item) => ({
                where: { id: item.id },
                create: item,
                update: item,
              })),
              create: itemsWithoutId?.map((item) => ({ ...item })),
            },
          }),
          ...(productionStages !== undefined && {
            productionStages: JSON.parse(
              JSON.stringify(productionStages || []),
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
