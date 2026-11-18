import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListActiveClientsDto } from './list-active-clients.dto';
import { ACCOUNT_TABS } from '../account-subscription';

describe('ListActiveClientsDto', () => {
  // A aba Aguardando pagamento ficou fora da validação: o total contava a
  // conta e a lista dela voltava 400, vazia. Toda aba contada é listável.
  it.each(ACCOUNT_TABS)('aceita a aba %s', async (tab) => {
    const dto = plainToInstance(ListActiveClientsDto, {
      status: tab,
      groupBy: 'none',
    });

    expect(await validate(dto)).toEqual([]);
  });

  it('recusa aba que não existe', async () => {
    const dto = plainToInstance(ListActiveClientsDto, { status: 'todas' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('status');
  });
});
