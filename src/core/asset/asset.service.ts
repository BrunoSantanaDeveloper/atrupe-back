import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { PrismaService } from 'nestjs-prisma';

/**
 * Patrimônios da empresa da sessão. Toda leitura e escrita filtra pela
 * empresa: um id de outra empresa responde como inexistente (404), e o
 * `companyId` que vier no corpo é ignorado.
 */
@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, createAssetDto: CreateAssetDto) {
    const { companyId: _fromBody, ...data } = createAssetDto;
    await this.assertReferences(companyId, data);
    return this.prisma.asset.create({
      data: {
        ...data,
        companyId,
      },
    });
  }

  findAll(companyId: string, pageSize?: number, page?: number) {
    // const where = {
    //   OR: [
    //     // Adicione os campos que você deseja pesquisar aqui
    //     { name: { contains: filter, mode: 'insensitive' } },
    //   ],
    // };

    return this.prisma.asset.findMany({
      where: { companyId },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  /** Os tipos padrão (sem empresa) e os da empresa. */
  findAllTypes(companyId: string) {
    return this.prisma.assetType.findMany({
      where: { OR: [{ companyId: null }, { companyId }] },
    });
  }

  async findOne(companyId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, companyId },
    });
    if (!asset) {
      throw new NotFoundException('Patrimônio não encontrado.');
    }
    return asset;
  }

  async update(companyId: string, id: string, updateAssetDto: UpdateAssetDto) {
    await this.findOne(companyId, id);
    const { companyId: _fromBody, ...data } = updateAssetDto;
    await this.assertReferences(companyId, data);
    return this.prisma.asset.update({ data, where: { id } });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.asset.delete({ where: { id } });
  }

  /** O setor é da empresa; o tipo é da empresa ou padrão. */
  private async assertReferences(
    companyId: string,
    data: { sectorId?: string; typeId?: string },
  ) {
    if (data.sectorId) {
      const sector = await this.prisma.companySector.findFirst({
        where: { id: data.sectorId, companyId },
        select: { id: true },
      });
      if (!sector) {
        throw new NotFoundException('Setor não encontrado.');
      }
    }
    if (data.typeId) {
      const type = await this.prisma.assetType.findFirst({
        where: {
          id: data.typeId,
          OR: [{ companyId: null }, { companyId }],
        },
        select: { id: true },
      });
      if (!type) {
        throw new NotFoundException('Tipo de patrimônio não encontrado.');
      }
    }
  }
}
