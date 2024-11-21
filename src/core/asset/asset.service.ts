import { Injectable } from '@nestjs/common';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  create(createAssetDto: CreateAssetDto) {
    return this.prisma.asset.create({
      data: {
        ...createAssetDto,
      },
    });
  }

  findAll(pageSize?: number, page?: number) {
    // const where = {
    //   OR: [
    //     // Adicione os campos que você deseja pesquisar aqui
    //     { name: { contains: filter, mode: 'insensitive' } },
    //   ],
    // };

    return this.prisma.asset.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  findAllTypes() {
    return this.prisma.assetType.findMany();
  }

  findOne(id: string) {
    return this.prisma.asset.findUnique({ where: { id } });
  }

  update(id: string, updateAssetDto: UpdateAssetDto) {
    return this.prisma.asset.update({ data: updateAssetDto, where: { id } });
  }

  remove(id: string) {
    return this.prisma.asset.delete({ where: { id } });
  }
}
