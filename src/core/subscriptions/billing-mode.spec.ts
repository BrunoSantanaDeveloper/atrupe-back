import { billingModeOf, billingModeWhere } from './billing-mode';

describe('billingModeWhere', () => {
  it('vale o modo gravado ou, sem ele, o prefixo do id no Asaas', () => {
    expect(billingModeWhere('ASAAS_SUBSCRIPTION')).toEqual({
      OR: [
        { billingMode: 'ASAAS_SUBSCRIPTION' },
        { billingMode: null, asaasSubscriptionId: { startsWith: 'sub_' } },
      ],
    });
    expect(billingModeWhere('ASAAS_INSTALLMENT')).toEqual({
      OR: [
        { billingMode: 'ASAAS_INSTALLMENT' },
        { billingMode: null, asaasSubscriptionId: { startsWith: 'inst_' } },
      ],
    });
  });

  it('manual é o que não tem nenhum dos prefixos conhecidos, como em billingModeOf', () => {
    expect(billingModeWhere('MANUAL')).toEqual({
      OR: [
        { billingMode: 'MANUAL' },
        {
          billingMode: null,
          NOT: [
            { asaasSubscriptionId: { startsWith: 'sub_' } },
            { asaasSubscriptionId: { startsWith: 'inst_' } },
            { asaasSubscriptionId: { startsWith: 'trial_' } },
          ],
        },
      ],
    });
    expect(billingModeOf({ asaasSubscriptionId: 'manual_123' })).toBe('MANUAL');
  });
});
