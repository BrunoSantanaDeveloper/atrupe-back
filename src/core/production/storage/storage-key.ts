import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * A chave do arquivo no armazenamento (anexos da produção e arquivos da
 * O.S.). No envio direto a chave volta do navegador, então ela tem duas
 * defesas: o formato que o próprio servidor gera e o uso único (a chave já
 * registrada não entra de novo nem é apagada como arquivo recusado).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A chave nova: a pasta (empresa e tarefa ou O.S.), um uuid e o nome seguro. */
export const newStorageKey = (folder: string, safeName: string) =>
  `${folder}/${randomUUID()}-${safeName}`;

/**
 * A chave que o servidor gera para esta pasta e este nome seguro. Barra a
 * de outra pasta, o `..`, o `//` e qualquer coisa fora do formato (o nome
 * seguro só tem letras, números, `_`, `.` e `-`).
 */
export function isStorageKeyOf(key: string, folder: string, safeName: string) {
  return new RegExp(`^${literal(folder)}/${UUID}-${literal(safeName)}$`).test(
    key,
  );
}

export const KEY_ALREADY_SAVED = 'Este arquivo já foi guardado';

type KeyDb = Pick<PrismaClient, 'productionAttachmentVersion' | 'orderFile'>;

/** A chave já está num anexo ou num arquivo de O.S. (mesmo apagado na limpeza). */
export async function storageKeyRegistered(db: KeyDb, key: string) {
  const version = await db.productionAttachmentVersion.findFirst({
    where: { storageKey: key },
    select: { id: true },
  });
  if (version) return true;
  const order = await db.orderFile.findFirst({
    where: { storageKey: key },
    select: { id: true },
  });
  return !!order;
}

/** Trava a chave até o fim da transação: o envio repetido espera o outro. */
export async function lockStorageKey(
  tx: Prisma.TransactionClient,
  key: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`storage-key:${key}`}))`;
}

/**
 * Na transação que grava a linha: trava a chave e recusa a já registrada.
 * Assim o envio direto repetido não cria duas linhas para o mesmo arquivo.
 */
export async function claimStorageKey(
  tx: Prisma.TransactionClient,
  key: string,
) {
  await lockStorageKey(tx, key);
  if (await storageKeyRegistered(tx, key)) {
    throw new ConflictException(KEY_ALREADY_SAVED);
  }
}

/**
 * O arquivo recusado (sem espaço, grande demais) sai do armazenamento, mas
 * nunca o de uma chave registrada: sob a trava, confere antes de apagar. A
 * falha só deixa o arquivo solto; a recusa segue para a tela.
 */
export async function discardUnregistered(
  prisma: Pick<PrismaClient, '$transaction'>,
  key: string,
  remove: (key: string) => Promise<unknown>,
) {
  await prisma
    .$transaction(async (tx) => {
      await lockStorageKey(tx, key);
      if (!(await storageKeyRegistered(tx, key))) await remove(key);
    })
    .catch(() => undefined);
}
