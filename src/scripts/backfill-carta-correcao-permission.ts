#!/usr/bin/env node
/**
 * Concede 'nota_fiscal:carta_correcao' aos cargos que hoje enviam CC-e.
 *
 * Até esta mudança o endpoint POST /fiscal/nfe/:id/correction-letter exigia
 * 'nota_fiscal:emitir:edit' — a MESMA permissão de editar um rascunho. Como a
 * tela de cargos liga 'edit' automaticamente ao marcar 'create', qualquer cargo
 * criado para preparar rascunhos ganhava, sem que o administrador percebesse, o
 * poder de disparar até 20 eventos 110110 na SEFAZ sobre notas já autorizadas.
 *
 * Agora existe um recurso dedicado. Este script preserva o comportamento atual
 * (quem enviava continua enviando) e a partir daí a permissão pode ser revogada
 * isoladamente pela tela de cargos.
 *
 * É idempotente.
 *
 * Uso:
 *   npm run permissions:cce:dry   # relatório, não escreve
 *   npm run permissions:cce       # aplica
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const SOURCE_RESOURCE = 'nota_fiscal:emitir';
const TARGET_RESOURCE = 'nota_fiscal:carta_correcao';

/** Quantos cargos atualizar por transação. */
const BATCH_SIZE = 200;

/** Ações que, no recurso de origem, implicam poder enviar CC-e. */
const GRANTING_ACTIONS = ['edit', '*'];

function hasGrantingPermission(permissions: string[]): boolean {
  return permissions.some((policy) => {
    if (policy === '*') return true;
    const parts = policy.split(':');
    if (parts.length !== 3) return false;
    const resource = `${parts[0]}:${parts[1]}`;
    return resource === SOURCE_RESOURCE && GRANTING_ACTIONS.includes(parts[2]);
  });
}

/**
 * Acrescenta view+edit do recurso dedicado, sem duplicar e sem reordenar o que
 * já existe. Retorna o array original quando nada muda, para o chamador poder
 * pular a escrita.
 */
export function grantCorrectionLetterPermission(
  permissions: string[],
): string[] {
  if (!hasGrantingPermission(permissions)) return permissions;

  const result = [...permissions];
  for (const action of ['view', 'edit']) {
    const policy = `${TARGET_RESOURCE}:${action}`;
    if (!result.includes(policy)) result.push(policy);
  }

  return result.length === permissions.length ? permissions : result;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const roles = await prisma.role.findMany({
      select: { id: true, name: true, companyId: true, permissions: true },
    });

    const pending = roles
      .map((role) => ({
        role,
        next: grantCorrectionLetterPermission(role.permissions || []),
      }))
      .filter(({ role, next }) => next !== (role.permissions || []));

    console.log(
      `${roles.length} cargos analisados; ${pending.length} precisam de ${TARGET_RESOURCE}.`,
    );

    for (const { role, next } of pending) {
      console.log(
        `  - [${role.companyId}] ${role.name} (${role.id}): +${next
          .filter((p) => !(role.permissions || []).includes(p))
          .join(', ')}`,
      );
    }

    if (DRY_RUN) {
      console.log('\nDRY RUN — nenhuma alteração gravada.');
      return;
    }

    if (pending.length === 0) {
      console.log('Nada a fazer.');
      return;
    }

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(
        batch.map(({ role, next }) =>
          prisma.role.update({
            where: { id: role.id },
            data: { permissions: next },
          }),
        ),
      );
      console.log(
        `Gravados ${Math.min(i + BATCH_SIZE, pending.length)}/${pending.length}`,
      );
    }

    console.log('Concluído.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
