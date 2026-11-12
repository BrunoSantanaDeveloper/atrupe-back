import { PaymentStatus } from '@prisma/client';
import { resolveTitleStatus } from './title-status.util';

describe('resolveTitleStatus', () => {
  const { PENDING, PAID, CANCELED, PROVISIONED } = PaymentStatus;

  it('mantem o titulo em aberto quando uma parcela e cancelada e outra segue pendente', () => {
    // A regra antiga marcava o titulo inteiro como CANCELED aqui, e a
    // cobranca das parcelas restantes sumia do relatorio financeiro.
    expect(resolveTitleStatus([CANCELED, PENDING])).toBe(PENDING);
    expect(resolveTitleStatus([PENDING, CANCELED, PENDING])).toBe(PENDING);
  });

  it('cancela o titulo so quando todas as parcelas estao canceladas', () => {
    expect(resolveTitleStatus([CANCELED])).toBe(CANCELED);
    expect(resolveTitleStatus([CANCELED, CANCELED])).toBe(CANCELED);
  });

  it('considera pago ignorando as parcelas canceladas', () => {
    expect(resolveTitleStatus([PAID, PAID])).toBe(PAID);
    expect(resolveTitleStatus([CANCELED, PAID])).toBe(PAID);
  });

  it('nao decide quando as parcelas nao determinam o status', () => {
    expect(resolveTitleStatus([PROVISIONED])).toBeNull();
    expect(resolveTitleStatus([PAID, PROVISIONED])).toBeNull();
    expect(resolveTitleStatus([])).toBeNull();
    expect(resolveTitleStatus(undefined as any)).toBeNull();
  });
});
