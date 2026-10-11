import { EmployeeService } from './employee.service';

/**
 * A tela de colaboradores mostra a cota de usuários do plano ("2 de 3") com
 * a mesma conta que o limite usa ao criar ou reativar um usuário.
 */
describe('EmployeeService — quantidade e cota de usuários', () => {
  let prisma: any;
  let planControl: any;
  let service: EmployeeService;

  beforeEach(() => {
    prisma = {
      employee: {
        groupBy: jest.fn().mockResolvedValue([
          { isActive: true, _count: { _all: 4 } },
          { isActive: false, _count: { _all: 2 } },
        ]),
      },
    };
    planControl = {
      getCurrentUserCount: jest.fn().mockResolvedValue(2),
      getCompanyPlanInfo: jest.fn().mockResolvedValue({
        planType: 'LITE',
        limits: { max_users: 4 },
      }),
    };
    const history: any = { createEmployeeHistory: jest.fn() };
    service = new EmployeeService(prisma, history, planControl);
  });

  it('traz quem tem acesso e o limite do plano, já com os adicionais', async () => {
    const result = await service.findAllQuantity('c1');

    expect(result).toEqual({
      ACTIVES: 4,
      INACTIVES: 2,
      TOTAL: 6,
      USERS: { used: 2, limit: 4 },
    });
    expect(planControl.getCurrentUserCount).toHaveBeenCalledWith('c1');
    expect(planControl.getCompanyPlanInfo).toHaveBeenCalledWith('c1');
  });

  it('ilimitado continua -1', async () => {
    planControl.getCompanyPlanInfo.mockResolvedValue({
      planType: 'FULL',
      limits: { max_users: -1 },
    });

    const result = await service.findAllQuantity('c1');

    expect(result.USERS).toEqual({ used: 2, limit: -1 });
  });

  it('sem assinatura ativa ou sem o limite no plano, o limite é nulo', async () => {
    planControl.getCompanyPlanInfo.mockResolvedValueOnce(null);
    const withoutSubscription = await service.findAllQuantity('c1');

    planControl.getCompanyPlanInfo.mockResolvedValueOnce({
      planType: 'START',
      limits: {},
    });
    const withoutLimit = await service.findAllQuantity('c1');

    expect(withoutSubscription.USERS).toEqual({ used: 2, limit: null });
    expect(withoutLimit.USERS).toEqual({ used: 2, limit: null });
  });
});
