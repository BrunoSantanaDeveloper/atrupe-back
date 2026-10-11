import { EmployeeService } from './employee.service';

/**
 * O titular da conta não é inativado nem deixa de ser administrador: a
 * titularidade sai só por transferência.
 */
describe('EmployeeService — titular da conta', () => {
  let tx: any;
  let service: EmployeeService;

  const ownerEmployee = {
    userId: 'titular',
    company: { ownerUserId: 'titular' },
  };

  beforeEach(() => {
    tx = {
      employee: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'emp-1', name: 'Ana' }),
      },
      user: { update: jest.fn() },
      role: { findUnique: jest.fn() },
      address: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn) => fn(tx)) };
    const history: any = { createEmployeeHistory: jest.fn() };
    const planControl: any = {};
    service = new EmployeeService(prisma, history, planControl);
  });

  it('inativar o titular é recusado, com o caminho: transferir antes', async () => {
    tx.employee.findUnique.mockResolvedValueOnce(ownerEmployee);

    await expect(
      service.update('emp-1', { isActive: false } as any),
    ).rejects.toMatchObject({
      response: { code: 'OWNER_CANNOT_BE_DEACTIVATED' },
    });
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('excluir o titular também é recusado', async () => {
    tx.employee.findUnique.mockResolvedValueOnce(ownerEmployee);

    await expect(service.remove('emp-1')).rejects.toMatchObject({
      response: { code: 'OWNER_CANNOT_BE_DEACTIVATED' },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('tirar o titular do cargo de administrador é recusado', async () => {
    tx.employee.findUnique.mockResolvedValueOnce(ownerEmployee);
    tx.role.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(
      service.update('emp-1', { roleId: 'role-vendedor' } as any),
    ).rejects.toMatchObject({ response: { code: 'OWNER_MUST_BE_ADMIN' } });
  });

  it('o titular continua editável no mais, inclusive num cargo de administrador', async () => {
    tx.employee.findUnique
      .mockResolvedValueOnce(ownerEmployee)
      .mockResolvedValueOnce({
        name: 'Ana',
        isActive: true,
        roleId: 'role-admin',
      });
    tx.role.findUnique.mockResolvedValue({ isAdmin: true });

    await expect(
      service.update('emp-1', {
        roleId: 'role-admin',
        name: 'Ana Souza',
      } as any),
    ).resolves.toMatchObject({ id: 'emp-1' });
  });

  it('outro colaborador é inativado como sempre', async () => {
    tx.employee.findUnique
      .mockResolvedValueOnce({
        userId: 'vendedor',
        company: { ownerUserId: 'titular' },
      })
      .mockResolvedValueOnce({ name: 'Rafa', isActive: true })
      .mockResolvedValueOnce({ userId: 'vendedor' });

    await service.update('emp-2', { isActive: false } as any);

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'vendedor' },
      data: { isActive: false },
    });
  });
});
