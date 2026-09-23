import { createHash, randomBytes } from 'crypto';

/**
 * Regras da transferência de titularidade que não dependem de banco.
 *
 * Portadas do protótipo (prototype/packages/dominio/src/transferencia.ts):
 * o convite vale 14 dias a partir do envio, e a expiração é DERIVADA dessa
 * data — uma pendente que passou do prazo já é expirada, mesmo que ninguém
 * tenha aberto a tela. Gravar o vencimento criaria um estado que mente
 * enquanto ninguém olha.
 */

/**
 * Catorze dias. Um convite que nunca expira continua aceitável muito depois
 * de a negociação ter morrido, e a titularidade não deve mudar por um link
 * esquecido numa caixa de entrada.
 */
export const TRANSFER_DEADLINE_DAYS = 14;

const DAY_MS = 86_400_000;

export type TransferState = 'PENDING' | 'CANCELED' | 'EXPIRED' | 'ACCEPTED';

/**
 * Status gravados. ACCEPTING é o aceite em curso: quem aceita reserva a
 * transferência antes de mexer na cobrança, para dois aceites simultâneos não
 * abrirem duas assinaturas. Para quem olha, continua pendente.
 */
export type TransferStatus = 'PENDING' | 'ACCEPTING' | 'CANCELED' | 'ACCEPTED';

/**
 * Por quanto tempo a reserva do aceite vale. Um aceite que caiu no meio (o
 * processo reiniciou) libera a transferência depois disso.
 */
export const ACCEPTANCE_LEASE_MS = 2 * 60 * 1000;

interface StoredTransfer {
  status: string;
  createdAt: Date;
}

export function transferExpiresAt(transfer: { createdAt: Date }): Date {
  return new Date(
    transfer.createdAt.getTime() + TRANSFER_DEADLINE_DAYS * DAY_MS,
  );
}

/** O estado como ele é hoje: uma pendente vencida já é expirada. */
export function transferStateOf(
  transfer: StoredTransfer,
  now: Date,
): TransferState {
  if (transfer.status === 'CANCELED') return 'CANCELED';
  if (transfer.status === 'ACCEPTED') return 'ACCEPTED';
  return now.getTime() > transferExpiresAt(transfer).getTime()
    ? 'EXPIRED'
    : 'PENDING';
}

/** Dias que restam para o aceite; fração de dia conta como dia inteiro. */
export function transferDaysLeft(
  transfer: { createdAt: Date },
  now: Date,
): number {
  const left = transferExpiresAt(transfer).getTime() - now.getTime();
  return Math.max(0, Math.ceil(left / DAY_MS));
}

/** O que o link diz quando o convite não vale mais. */
export const INVITE_LINK_MESSAGE: Record<
  Exclude<TransferState, 'PENDING'>,
  string
> = {
  CANCELED: 'Esta transferência foi cancelada por quem a enviou.',
  EXPIRED: `Esta transferência expirou. O convite vale por ${TRANSFER_DEADLINE_DAYS} dias a partir do envio.`,
  ACCEPTED: 'Esta transferência já foi aceita.',
};

/**
 * O token do convite: opaco, com 256 bits, e só o hash vai para o banco. Quem
 * lê o banco não consegue montar um link válido.
 */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
