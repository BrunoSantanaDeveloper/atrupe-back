import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { normalizeText } from '../material/material-text';
import {
  ProductVariationRowDto,
  UpdateProductVariationDto,
} from './dto/product-variation.dto';
import { PriceTierDto, SavePriceTiersDto } from './dto/price-tier.dto';

const PRODUCT_NOT_FOUND = 'Produto não encontrado';
const VARIATION_NOT_FOUND = 'Variação não encontrada';

const VARIATION_SELECT = {
  id: true,
  name: true,
  unitPrice: true,
  _count: { select: { priceTiers: true } },
} satisfies Prisma.ProductVariationSelect;

type VariationRow = Prisma.ProductVariationGetPayload<{
  select: typeof VARIATION_SELECT;
}>;

const toVariation = (variation: VariationRow) => ({
  id: variation.id,
  name: variation.name,
  unitPrice: variation.unitPrice,
  // A composição própria da variação chega com a composição (fatia 3.4)
  hasOwnAssembly: false,
  hasOwnTiers: variation._count.priceTiers > 0,
});

const toTiers = (tiers: { from: number; unitPrice: number }[]) =>
  tiers.map(({ from, unitPrice }) => ({ from, unitPrice }));

/** Nomes sem caixa e sem acento: duas variações não podem coincidir. */
function assertNames(names: string[]) {
  if (names.some((name) => !name)) {
    throw new BadRequestException('Dê um nome para cada variação');
  }
  const keys = names.map(normalizeText);
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('Duas variações com o mesmo nome');
  }
}

/**
 * Variações simples do produto (PV-6, já no START) e a tabela de preço por
 * faixa de quantidade (FQ-1 a FQ-4). A empresa é a da sessão: produto de
 * outra empresa responde 404.
 *
 * `values` diz se quem chama tem `values:values:view`. Sem ela, o preço que
 * vier no corpo não é gravado: a tela esconde o preço de quem não o vê, e o
 * que ela devolve não pode apagar o que estava lá.
 */
@Injectable()
export class ProductVariationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, productId: string) {
    await this.findProduct(companyId, productId);
    return { data: await this.variationsOf(this.prisma, productId) };
  }

  /**
   * Substitui a lista: as que vêm com id mantêm a composição e as faixas; as
   * que ficam de fora saem, com a tabela delas.
   */
  async replace(
    companyId: string,
    productId: string,
    rows: ProductVariationRowDto[],
    values: boolean,
  ) {
    const product = await this.findProduct(companyId, productId);
    const names = rows.map((row) => (row.name ?? '').trim());
    assertNames(names);
    if (rows.length && product._count.items > 1) {
      throw new BadRequestException(
        'Variações valem para produto de uma unidade de venda; kit não tem variação.',
      );
    }

    const current = await this.prisma.productVariation.findMany({
      where: { productId },
      select: { id: true, unitPrice: true },
    });
    const byId = new Map(current.map((item) => [item.id, item]));
    for (const row of rows) {
      if (row.id && !byId.has(row.id)) {
        throw new NotFoundException(VARIATION_NOT_FOUND);
      }
    }
    const kept = new Set(rows.map((row) => row.id).filter(Boolean));

    await this.prisma.$transaction(async (tx) => {
      const removed = current
        .map((item) => item.id)
        .filter((id) => !kept.has(id));
      if (removed.length) {
        await tx.productVariation.deleteMany({
          where: { id: { in: removed }, productId },
        });
      }
      for (const [position, row] of rows.entries()) {
        const existing = row.id ? byId.get(row.id) : undefined;
        // Sem a permissão de valores, o preço que estava fica
        const unitPrice = values
          ? (row.unitPrice ?? null)
          : (existing?.unitPrice ?? null);
        if (existing) {
          await tx.productVariation.update({
            where: { id: existing.id },
            data: { name: names[position], unitPrice, position },
          });
        } else {
          await tx.productVariation.create({
            data: { productId, name: names[position], unitPrice, position },
          });
        }
      }
    });

    return { data: await this.variationsOf(this.prisma, productId) };
  }

  async update(
    companyId: string,
    productId: string,
    variationId: string,
    dto: UpdateProductVariationDto,
    values: boolean,
  ) {
    await this.findProduct(companyId, productId);
    const variation = await this.findVariation(productId, variationId);

    const data: Prisma.ProductVariationUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Dê um nome à variação');
      const others = await this.prisma.productVariation.findMany({
        where: { productId, id: { not: variation.id } },
        select: { name: true },
      });
      if (
        others.some(
          (other) => normalizeText(other.name) === normalizeText(name),
        )
      ) {
        throw new BadRequestException('Já existe uma variação com esse nome');
      }
      data.name = name;
    }
    if (dto.unitPrice !== undefined && values) data.unitPrice = dto.unitPrice;

    const updated = await this.prisma.productVariation.update({
      where: { id: variation.id },
      data,
      select: VARIATION_SELECT,
    });
    return toVariation(updated);
  }

  /** Remove a variação e a tabela dela (a composição própria vem na 3.4). */
  async remove(companyId: string, productId: string, variationId: string) {
    await this.findProduct(companyId, productId);
    const variation = await this.findVariation(productId, variationId);
    await this.prisma.productVariation.delete({ where: { id: variation.id } });
  }

  /**
   * A tabela do produto, ou a da variação. A variação sem tabela própria usa
   * a do produto (`inherited`).
   */
  async tiers(companyId: string, productId: string, variationId?: string) {
    await this.findProduct(companyId, productId);
    if (variationId) {
      await this.findVariation(productId, variationId);
      const own = await this.tierRows(productId, variationId);
      if (own.length) return { inherited: false, tiers: toTiers(own) };
      return {
        inherited: true,
        tiers: toTiers(await this.tierRows(productId, null)),
      };
    }
    return {
      inherited: false,
      tiers: toTiers(await this.tierRows(productId, null)),
    };
  }

  async saveTiers(
    companyId: string,
    productId: string,
    dto: SavePriceTiersDto,
  ) {
    await this.findProduct(companyId, productId);
    const variationId = dto.variationId ?? null;
    if (variationId) await this.findVariation(productId, variationId);
    if (dto.inherit && !variationId) {
      throw new BadRequestException('Só a variação herda a tabela do produto.');
    }

    const tiers = dto.inherit ? [] : this.sortedTiers(dto.tiers);
    await this.prisma.$transaction(async (tx) => {
      await tx.productPriceTier.deleteMany({
        where: { productId, variationId },
      });
      if (tiers.length) {
        await tx.productPriceTier.createMany({
          data: tiers.map((tier) => ({ ...tier, productId, variationId })),
        });
      }
    });

    return this.tiers(companyId, productId, variationId ?? undefined);
  }

  private sortedTiers(tiers: PriceTierDto[]) {
    const sorted = [...tiers].sort((a, b) => a.from - b.from);
    if (new Set(sorted.map((tier) => tier.from)).size !== sorted.length) {
      throw new BadRequestException('Duas faixas começam na mesma quantidade');
    }
    return sorted.map(({ from, unitPrice }) => ({ from, unitPrice }));
  }

  private tierRows(productId: string, variationId: string | null) {
    return this.prisma.productPriceTier.findMany({
      where: { productId, variationId },
      orderBy: { from: 'asc' },
      select: { from: true, unitPrice: true },
    });
  }

  private async variationsOf(db: Prisma.TransactionClient, productId: string) {
    const rows = await db.productVariation.findMany({
      where: { productId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: VARIATION_SELECT,
    });
    return rows.map(toVariation);
  }

  private async findProduct(companyId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, _count: { select: { items: true } } },
    });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return product;
  }

  private async findVariation(productId: string, variationId: string) {
    const variation = await this.prisma.productVariation.findFirst({
      where: { id: variationId, productId },
      select: { id: true },
    });
    if (!variation) throw new NotFoundException(VARIATION_NOT_FOUND);
    return variation;
  }
}
