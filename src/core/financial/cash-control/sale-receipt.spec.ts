import { BadRequestException } from '@nestjs/common';
import { accountForMethod, resolveParts } from './sale-receipt';

/**
 * A conta que o sistema escolhe para a forma (CX-2, regra de 26/10/2026): a
 * tela de contas não marca mais uma "padrão". Dinheiro vai para a Caixa
 * Empresa (banco 000) e, sem ela, para o primeiro caixa físico; as outras
 * formas, para a primeira conta ativa que recebe a forma.
 */
describe('accountForMethod', () => {
  const tx = (drawers: unknown[], rule: unknown) =>
    ({
      bankAccount: { findMany: jest.fn().mockResolvedValue(drawers) },
      bankAccountCashControl: { findFirst: jest.fn().mockResolvedValue(rule) },
    }) as any;

  it('dinheiro vai para a Caixa Empresa, mesmo com caixa físico mais antigo', async () => {
    const db = tx(
      [
        { id: 'gaveta-2', bank: { code: '237' } },
        { id: 'caixa-empresa', bank: { code: '000' } },
      ],
      null,
    );
    await expect(accountForMethod(db, 'c-1', 'din', 'CASH')).resolves.toBe(
      'caixa-empresa',
    );
    expect(db.bankAccountCashControl.findFirst).not.toHaveBeenCalled();
  });

  it('sem a Caixa Empresa, dinheiro vai para o primeiro caixa físico', async () => {
    const db = tx([{ id: 'gaveta-2', bank: { code: '237' } }], null);
    await expect(accountForMethod(db, 'c-1', 'din', 'CASH')).resolves.toBe(
      'gaveta-2',
    );
  });

  it('as outras formas vão para a primeira conta ativa que recebe a forma', async () => {
    const db = tx([], { bankAccountId: 'bradesco' });
    await expect(accountForMethod(db, 'c-1', 'pix', 'PIX')).resolves.toBe(
      'bradesco',
    );
    expect(db.bankAccountCashControl.findFirst).toHaveBeenCalledWith({
      where: {
        paymentConditionId: 'pix',
        acceptIncomes: true,
        bankAccount: { companyId: 'c-1', isActive: true },
      },
      orderBy: { bankAccount: { createdAt: 'asc' } },
      select: { bankAccountId: true },
    });
  });

  it('sem conta que receba a forma, o recebimento pede a conta', async () => {
    const db = {
      ...tx([], null),
      paymentCondition: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'pix', name: 'Pix', paymentMethod: { code: 'PIX' } },
          ]),
      },
    } as any;
    await expect(
      resolveParts(
        db,
        'c-1',
        [{ method: 'PIX', paymentConditionId: 'pix', amount: 1000 }],
        { cashNeedsAccount: true },
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Escolha a conta do PIX: nenhuma conta ativa recebe essa forma em Contas bancárias',
      ),
    );
  });

  // VR-11 (16/11/2026): o balcão só recebe à vista, pelo tipo do cadastro
  it('boleto não é recebido no balcão, mesmo enviado como dinheiro', async () => {
    const db = {
      ...tx([], null),
      paymentCondition: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'bol', name: 'Boleto', paymentMethod: { code: 'BOL' } },
          ]),
      },
    } as any;
    await expect(
      resolveParts(
        db,
        'c-1',
        [{ method: 'CASH', paymentConditionId: 'bol', amount: 1000 }],
        { cashNeedsAccount: true },
      ),
    ).rejects.toThrow('A forma "Boleto" não é recebida no balcão');
  });

  it('a forma enviada precisa ser a do cadastro (cartão não entra como PIX)', async () => {
    const db = {
      ...tx([], null),
      paymentCondition: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'deb',
            name: 'Cartão de Débito',
            paymentMethod: { code: 'DEB' },
          },
        ]),
      },
    } as any;
    await expect(
      resolveParts(
        db,
        'c-1',
        [{ method: 'PIX', paymentConditionId: 'deb', amount: 1000 }],
        { cashNeedsAccount: true },
      ),
    ).rejects.toThrow('não é recebida no balcão');
  });
});
