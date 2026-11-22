import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PlanControlService } from '../../plan/plan-control.service';

/**
 * O espaço dos arquivos de produção (GP-48 item 27): um armazenamento só,
 * com a pasta de cada empresa; o espaço usado é a soma do tamanho de todas
 * as versões dos anexos da empresa, lida no banco (sem perguntar à AWS).
 *
 * Quem não contrata tem a cota grátis do plano (limite
 * `production_storage_free_mb`, 1 GB de partida) e o arquivo de até 20 MB;
 * quem contrata uma faixa (complemento com `storageGb`) soma o espaço dela e
 * envia arquivos de até 2 GB, direto do navegador para o armazenamento.
 */

export const FREE_LIMIT_KEY = 'production_storage_free_mb';
/** Sem o limite no plano, a cota de partida. */
export const DEFAULT_FREE_MB = 1024;

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

/** O arquivo de quem não contrata (D32, PO 13/10/2026). */
export const FREE_FILE_MAX_BYTES = 20 * MB;
/** O arquivo de quem contrata: abaixo do teto do tamanho guardado (Int). */
export const TIER_FILE_MAX_BYTES = 2 * 1000 * 1000 * 1000;

/** A partir de quanto do espaço a tela oferece a faixa seguinte. */
export const OFFER_RATIO = 0.8;

export const STORAGE_FULL = 'STORAGE_FULL';
export const FILE_TOO_LARGE = 'FILE_TOO_LARGE';

export interface StorageTier {
  key: string;
  name: string;
  storageGb: number;
}

export interface StorageSummary {
  usedBytes: number;
  /** Nulo = sem limite (o plano libera sem teto). */
  quotaBytes: number | null;
  freeBytes: number | null;
  maxFileBytes: number;
  tier: StorageTier | null;
  /** O arquivo pesado vai direto do navegador ao armazenamento. */
  directUpload: boolean;
}

/** A conta do espaço, sem banco: a cota grátis mais a faixa. */
export function storageSummary(input: {
  usedBytes: number;
  /** O limite do plano em MB: indefinido = partida; -1 = sem limite. */
  freeMb: number | undefined;
  tier: StorageTier | null;
}): Omit<StorageSummary, 'directUpload'> {
  const freeMb = input.freeMb ?? DEFAULT_FREE_MB;
  const quotaBytes =
    freeMb === -1 ? null : freeMb * MB + (input.tier?.storageGb ?? 0) * GB;
  return {
    usedBytes: input.usedBytes,
    quotaBytes,
    freeBytes:
      quotaBytes === null ? null : Math.max(quotaBytes - input.usedBytes, 0),
    maxFileBytes: input.tier ? TIER_FILE_MAX_BYTES : FREE_FILE_MAX_BYTES,
    tier: input.tier,
  };
}

/** O que impede o arquivo de entrar; nulo quando cabe. */
export function refusalOf(
  summary: Pick<StorageSummary, 'usedBytes' | 'quotaBytes' | 'maxFileBytes'>,
  size: number,
): { code: string; message: string } | null {
  if (size > summary.maxFileBytes) {
    return {
      code: FILE_TOO_LARGE,
      message:
        summary.maxFileBytes === FREE_FILE_MAX_BYTES
          ? 'O arquivo passa de 20 MB. Com os arquivos de produção contratados, cada arquivo pode ter até 2 GB.'
          : 'O arquivo passa de 2 GB.',
    };
  }
  if (
    summary.quotaBytes !== null &&
    summary.usedBytes + size > summary.quotaBytes
  ) {
    return {
      code: STORAGE_FULL,
      message:
        'O espaço dos arquivos de produção acabou. Contrate mais espaço ou apague arquivos que não usa mais.',
    };
  }
  return null;
}

type Db = Pick<
  PrismaClient,
  'productionAttachmentVersion' | 'orderFile' | 'feature'
>;

/**
 * A soma do tamanho de todas as versões dos anexos da empresa e dos
 * arquivos das O.S. (GP-49). O apagado na limpeza não ocupa mais espaço.
 */
export async function usedBytesOf(db: Db, companyId: string) {
  const [versions, orders] = await Promise.all([
    db.productionAttachmentVersion.aggregate({
      _sum: { size: true },
      where: { removedAt: null, attachment: { task: { companyId } } },
    }),
    db.orderFile.aggregate({
      _sum: { size: true },
      where: { removedAt: null, companyId },
    }),
  ]);
  return Number(versions._sum.size ?? 0) + Number(orders._sum.size ?? 0);
}

/** A maior faixa entre os recursos que a empresa tem. */
export async function tierOf(
  db: Db,
  featureKeys: string[],
): Promise<StorageTier | null> {
  if (!featureKeys.length) return null;
  const tier = await db.feature.findFirst({
    where: { key: { in: featureKeys }, storageGb: { not: null } },
    orderBy: { storageGb: 'desc' },
    select: { key: true, name: true, storageGb: true },
  });
  return tier ? { ...tier, storageGb: tier.storageGb! } : null;
}

@Injectable()
export class ProductionFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanControlService,
  ) {}

  async summary(
    companyId: string,
    directUpload: boolean,
  ): Promise<StorageSummary> {
    const plan = await this.plans.getCompanyPlanInfo(companyId);
    const keys = Object.keys(plan?.features ?? {}).filter(
      (key) => plan!.features[key],
    );
    const [usedBytes, tier] = await Promise.all([
      usedBytesOf(this.prisma, companyId),
      tierOf(this.prisma, keys),
    ]);
    const summary = storageSummary({
      usedBytes,
      freeMb: plan?.limits[FREE_LIMIT_KEY],
      tier,
    });
    // Sem o envio direto, o arquivo passa pelo servidor e fica no teto dele
    return {
      ...summary,
      maxFileBytes: directUpload ? summary.maxFileBytes : FREE_FILE_MAX_BYTES,
      directUpload,
    };
  }

  /** Recusa o arquivo que não cabe, com o código que a tela reconhece. */
  assertFits(summary: StorageSummary, size: number) {
    const refusal = refusalOf(summary, size);
    if (refusal) throw new UnprocessableEntityException(refusal);
  }
}
