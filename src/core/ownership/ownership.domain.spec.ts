import {
  hashInviteToken,
  newInviteToken,
  transferDaysLeft,
  transferStateOf,
  TRANSFER_DEADLINE_DAYS,
} from './ownership.domain';

const ENVIADA = new Date('2026-09-10T15:00:00.000Z');
const depois = (dias: number, horas = 0) =>
  new Date(ENVIADA.getTime() + dias * 86_400_000 + horas * 3_600_000);

describe('ownership.domain', () => {
  describe('transferStateOf', () => {
    const pendente = { status: 'PENDING', createdAt: ENVIADA };

    it('dentro do prazo, pendente', () => {
      expect(transferStateOf(pendente, depois(13, 23))).toBe('PENDING');
    });

    it('passados 14 dias, expirada sem que nada tenha sido gravado', () => {
      expect(transferStateOf(pendente, depois(14, 1))).toBe('EXPIRED');
    });

    it('em aceite continua pendente para quem olha, e vence como qualquer pendente', () => {
      const emAceite = { status: 'ACCEPTING', createdAt: ENVIADA };
      expect(transferStateOf(emAceite, depois(2))).toBe('PENDING');
      expect(transferStateOf(emAceite, depois(15))).toBe('EXPIRED');
    });

    it('cancelada e aceita ficam como estão, qualquer que seja a data', () => {
      expect(
        transferStateOf({ status: 'CANCELED', createdAt: ENVIADA }, depois(1)),
      ).toBe('CANCELED');
      expect(
        transferStateOf({ status: 'ACCEPTED', createdAt: ENVIADA }, depois(30)),
      ).toBe('ACCEPTED');
    });
  });

  describe('transferDaysLeft', () => {
    it('conta os dias que faltam, com fração de dia como dia inteiro', () => {
      expect(transferDaysLeft({ createdAt: ENVIADA }, ENVIADA)).toBe(
        TRANSFER_DEADLINE_DAYS,
      );
      expect(transferDaysLeft({ createdAt: ENVIADA }, depois(3, 2))).toBe(11);
      expect(transferDaysLeft({ createdAt: ENVIADA }, depois(20))).toBe(0);
    });
  });

  describe('token do convite', () => {
    it('é opaco e só o hash é guardado', () => {
      const { token, hash } = newInviteToken();
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(hash).toBe(hashInviteToken(token));
      expect(hash).not.toContain(token);
      expect(newInviteToken().token).not.toBe(token);
    });
  });
});
