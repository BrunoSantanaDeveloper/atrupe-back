import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssetUnit } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { CostAuditService } from '../cost-base/cost-audit.service';
import { ASSET_INCLUDE, computeAsset } from './asset.service';
import {
  CreateAssetGroupDto,
  GroupFilterDto,
  RenameAssetGroupDto,
} from './dto/asset.dto';

export const GROUP_NOT_FOUND = 'Grupo não encontrado';
const GROUP_PAGE_LIMIT = 100;

/** Os grupos que toda empresa ganha cadastrados e editáveis (P-13). */
const DEFAULT_GROUPS: { name: string; unit: AssetUnit }[] = [
  { name: 'Carros', unit: 'KM' },
  { name: 'Motos', unit: 'KM' },
  { name: 'Caminhões', unit: 'KM' },
];

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

/**
 * Grupos de bens equivalentes (P-5.2, P-13, P-28): bens da mesma unidade e
 * do mesmo setor que a composição e a precificação tratam como uma linha
 * só, pelo custo médio e pela capacidade somada.
 */
@Injectable()
export class AssetGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: CostAuditService,
  ) {}

  async list(companyId: string, filter: GroupFilterDto, values: boolean) {
    await this.seedDefaults(companyId);
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 50, GROUP_PAGE_LIMIT);
    const [total, groups] = await this.prisma.$transaction([
      this.prisma.assetGroup.count({ where: { companyId } }),
      this.prisma.assetGroup.findMany({
        where: { companyId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sector: { select: { name: true } },
          assets: { where: { active: true }, include: ASSET_INCLUDE },
        },
      }),
    ]);
    const today = new Date();
    return {
      data: groups.map((group) => {
        const members = group.assets.map((asset) => computeAsset(asset, today));
        // O custo médio é o do custo unitário dos bens (P-28)
        const unitCosts = members
          .map((member) => member.unitCost)
          .filter((cost): cost is number => cost !== null);
        return {
          id: group.id,
          name: group.name,
          unit: group.unit,
          sector: group.sector?.name ?? null,
          sectorId: group.sectorId,
          assetCount: members.length,
          ...(values && {
            averageCost: unitCosts.length
              ? Math.round(
                  unitCosts.reduce((sum, cost) => sum + cost, 0) /
                    unitCosts.length,
                )
              : null,
          }),
          totalProductivity: members.reduce(
            (sum, member) => sum + member.productivity,
            0,
          ),
          // Grupo sem bem é uma inconsistência (P-28)
          inconsistent: members.length === 0,
        };
      }),
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  async create(companyId: string, userId: string, dto: CreateAssetGroupDto) {
    const sector = await this.prisma.companySector.findFirst({
      where: { id: dto.sectorId, companyId, isActive: true },
      select: { id: true },
    });
    if (!sector) throw new NotFoundException('Setor não encontrado');
    await this.assertUniqueName(companyId, dto.name, null);
    const group = await this.prisma.assetGroup.create({
      data: {
        companyId,
        name: dto.name,
        unit: dto.unit,
        sectorId: dto.sectorId,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_GROUP',
      entityId: group.id,
      action: 'CREATE',
      after: group,
    });
    return group;
  }

  async rename(
    companyId: string,
    userId: string,
    id: string,
    dto: RenameAssetGroupDto,
  ) {
    const group = await this.findGroup(companyId, id);
    await this.assertUniqueName(companyId, dto.name, id);
    const updated = await this.prisma.assetGroup.update({
      where: { id },
      data: { name: dto.name },
    });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_GROUP',
      entityId: id,
      action: 'UPDATE',
      before: { name: group.name },
      after: { name: updated.name },
    });
    return updated;
  }

  /** Só o grupo vazio, sem bem nenhum, nem inativo, é excluído. */
  async remove(companyId: string, userId: string, id: string) {
    const group = await this.findGroup(companyId, id);
    const count = await this.prisma.asset.count({ where: { groupId: id } });
    if (count) {
      bad(
        `Este grupo tem ${count} bem(ns). Tire os bens do grupo antes de excluir`,
      );
    }
    const usage = await this.prisma.assemblyLineOption.count({
      where: { resourceId: `machine-group:${id}` },
    });
    if (usage) bad('Este grupo é usado em composições: ele não é excluído');
    await this.prisma.assetGroup.delete({ where: { id } });
    await this.audit.record({
      companyId,
      userId,
      entity: 'ASSET_GROUP',
      entityId: id,
      action: 'DELETE',
      before: group,
    });
  }

  private async findGroup(companyId: string, id: string) {
    const group = await this.prisma.assetGroup.findFirst({
      where: { id, companyId },
    });
    if (!group) throw new NotFoundException(GROUP_NOT_FOUND);
    return group;
  }

  private async assertUniqueName(
    companyId: string,
    name: string,
    currentId: string | null,
  ) {
    const clash = await this.prisma.assetGroup.findFirst({
      where: {
        companyId,
        name: { equals: name, mode: 'insensitive' },
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
      select: { id: true },
    });
    if (clash) bad('Já existe um grupo com este nome');
  }

  /**
   * Carros, Motos e Caminhões nascem cadastrados, uma vez por empresa: o
   * grupo excluído depois não volta (P-13).
   */
  private async seedDefaults(companyId: string) {
    const settings = await this.prisma.costBaseSettings.findUnique({
      where: { companyId },
      select: { assetGroupsSeededAt: true },
    });
    if (settings?.assetGroupsSeededAt) return;
    const existing = await this.prisma.assetGroup.findMany({
      where: { companyId },
      select: { name: true },
    });
    const names = new Set(existing.map((group) => group.name.toLowerCase()));
    const missing = DEFAULT_GROUPS.filter(
      (group) => !names.has(group.name.toLowerCase()),
    );
    await this.prisma.$transaction([
      ...(missing.length
        ? [
            this.prisma.assetGroup.createMany({
              data: missing.map((group) => ({ companyId, ...group })),
              skipDuplicates: true,
            }),
          ]
        : []),
      this.prisma.costBaseSettings.upsert({
        where: { companyId },
        create: { companyId, assetGroupsSeededAt: new Date() },
        update: { assetGroupsSeededAt: new Date() },
      }),
    ]);
  }
}
