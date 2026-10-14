import { NfeStatus } from '@prisma/client';
import { accessKeyConflictAction } from './nfe.service';

// A chave de acesso que voltou do provedor já está em outra NF-e
describe('chave de acesso repetida', () => {
  const mine = 'c-1';

  it('a da mesma empresa sem valor fiscal perde a chave para a nova', () => {
    for (const status of [
      NfeStatus.DRAFT,
      NfeStatus.REJECTED,
      NfeStatus.PROCESSING,
    ]) {
      expect(accessKeyConflictAction({ companyId: mine, status }, mine)).toBe(
        'CLEAR_OLD',
      );
    }
  });

  it('a da mesma empresa emitida ou cancelada faz da nova uma duplicidade', () => {
    for (const status of [
      NfeStatus.AUTHORIZED,
      NfeStatus.CORRECTION_SENT,
      NfeStatus.CANCELLED,
    ]) {
      expect(accessKeyConflictAction({ companyId: mine, status }, mine)).toBe(
        'DUPLICATE',
      );
    }
  });

  it('a de outra empresa não é tocada', () => {
    expect(
      accessKeyConflictAction(
        { companyId: 'c-2', status: NfeStatus.REJECTED },
        mine,
      ),
    ).toBe('OTHER_COMPANY');
  });
});
