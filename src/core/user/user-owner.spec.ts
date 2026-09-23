import { UserCrudService } from './user-crud.service';

/**
 * O usuário do titular da conta: não é inativado, e o e-mail de acesso dele só
 * ele muda.
 */
describe('UserCrudService — titular da conta', () => {
  let prisma: any;
  let service: UserCrudService;

  // Mesma empresa: quem edita e o titular são colaboradores dela.
  const admin = { userId: 'outro-admin', companyId: 'company-1' };

  beforeEach(() => {
    prisma = {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
      user: {
        findUnique: jest.fn(async ({ select }) =>
          select?.employee
            ? { employee: [{ companyId: 'company-1' }] }
            : { email: 'ana@horizonte.com.br' },
        ),
        update: jest.fn().mockResolvedValue({ id: 'titular' }),
      },
      employee: { update: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    service = new UserCrudService(prisma, {} as any, {} as any);
  });

  it('inativar o usuário do titular é recusado', async () => {
    await expect(
      service.update('titular', { isActive: false } as any, admin),
    ).rejects.toMatchObject({
      response: { code: 'OWNER_CANNOT_BE_DEACTIVATED' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('outro administrador não muda o e-mail de acesso do titular', async () => {
    await expect(
      service.update('titular', { email: 'outro@x.com' } as any, admin),
    ).rejects.toMatchObject({ response: { code: 'OWNER_ONLY' } });
  });

  it('o próprio titular muda o e-mail dele', async () => {
    await service.update(
      'titular',
      { email: 'ana.nova@horizonte.com.br' } as any,
      { userId: 'titular', companyId: 'company-1' },
    );

    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('o formulário que reenvia o mesmo e-mail não é barrado', async () => {
    await service.update(
      'titular',
      { email: 'ANA@horizonte.com.br', name: 'Ana Souza' } as any,
      admin,
    );

    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('quem não é titular segue as regras de sempre', async () => {
    prisma.company.findFirst.mockResolvedValue(null);

    await service.update('vendedor', { isActive: false } as any, admin);

    expect(prisma.user.update).toHaveBeenCalled();
  });
});
