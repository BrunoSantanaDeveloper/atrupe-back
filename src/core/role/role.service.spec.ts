import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { RoleActor, RoleService } from './role.service';

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeDefined();
  return error;
}

describe('RoleService', () => {
  let service: RoleService;
  let prisma: any;

  const seller: RoleActor = { companyId: 'c-1', role: 'r-seller' };
  const roleOfCompany = {
    id: 'r-1',
    companyId: 'c-1',
    isAdmin: false,
    permissions: [],
  };

  beforeEach(async () => {
    prisma = {
      role: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      companySector: { findFirst: jest.fn() },
      employee: { findMany: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RoleService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RoleService);
  });

  describe('isolamento por empresa', () => {
    it('findOne procura pelo id e pela empresa da sessão', async () => {
      prisma.role.findFirst.mockResolvedValue(roleOfCompany);
      await expect(service.findOne('r-1', 'c-1')).resolves.toBe(roleOfCompany);
      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { id: 'r-1', companyId: 'c-1' },
      });
    });

    it('findOne responde 404 ao cargo de outra empresa', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(service.findOne('r-9', 'c-1')).rejects.toThrow(
        new NotFoundException('Cargo não encontrado.'),
      );
    });

    it('update não altera o cargo de outra empresa', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(
        service.update('r-9', { permissions: ['client:view'] }, seller),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('remove não desativa o cargo de outra empresa', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(service.remove('r-9', 'c-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.employee.updateMany).not.toHaveBeenCalled();
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('remove desvincula só os colaboradores da empresa', async () => {
      prisma.role.findFirst.mockResolvedValue(roleOfCompany);
      prisma.employee.findMany.mockResolvedValue([]);
      await service.remove('r-1', 'c-1');
      expect(prisma.employee.updateMany).toHaveBeenCalledWith({
        where: { roleId: 'r-1', companyId: 'c-1' },
        data: { roleId: null },
      });
      expect(prisma.role.update).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: { isActive: false },
      });
    });

    it('remove mantém a recusa do cargo do titular', async () => {
      prisma.role.findFirst.mockResolvedValue(roleOfCompany);
      prisma.employee.findMany.mockResolvedValue([
        { userId: 'u-dono', company: { ownerUserId: 'u-dono' } },
      ]);
      const error = await rejection(service.remove('r-1', 'c-1'));
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse().code).toBe('OWNER_ROLE');
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('o setor do cargo precisa ser da empresa', async () => {
      prisma.role.findFirst.mockResolvedValue(roleOfCompany);
      prisma.companySector.findFirst.mockResolvedValue(null);
      await expect(
        service.update('r-1', { sectorId: 's-9' }, seller),
      ).rejects.toThrow(new NotFoundException('Setor não encontrado.'));
      expect(prisma.companySector.findFirst).toHaveBeenCalledWith({
        where: { id: 's-9', companyId: 'c-1' },
        select: { id: true },
      });
      expect(prisma.role.update).not.toHaveBeenCalled();

      await expect(
        service.create(
          { name: 'Caixa', companyId: 'c-1', sectorId: 's-9' },
          seller,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.create).not.toHaveBeenCalled();
    });

    it('sem setor (vazio, como a tela manda), não consulta o setor', async () => {
      prisma.role.findFirst.mockResolvedValue(roleOfCompany);
      await service.update('r-1', { name: 'Vendas', sectorId: '' }, seller);
      expect(prisma.companySector.findFirst).not.toHaveBeenCalled();
      expect(prisma.role.update).toHaveBeenCalled();
    });
  });

  describe('cargo de administrador', () => {
    const adminRole = { ...roleOfCompany, isAdmin: true };

    it('não pode ser alterado, como na tela', async () => {
      prisma.role.findFirst.mockResolvedValue(adminRole);
      const error = await rejection(
        service.update('r-1', { name: 'Outro' }, { ...seller, isAdmin: true }),
      );
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse().code).toBe('ADMIN_ROLE');
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('não pode ser excluído, como na tela', async () => {
      prisma.role.findFirst.mockResolvedValue(adminRole);
      const error = await rejection(service.remove('r-1', 'c-1'));
      expect(error.getResponse().code).toBe('ADMIN_ROLE');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("acesso total ('*')", () => {
    const wildcard = { permissions: ['*'] };

    beforeEach(() => prisma.role.findFirst.mockResolvedValue(roleOfCompany));

    it('quem não é administrador não concede', async () => {
      prisma.role.findUnique.mockResolvedValue({
        isAdmin: false,
        permissions: ['company_settings:roles:edit'],
      });
      const error = await rejection(service.update('r-1', wildcard, seller));
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toEqual({
        code: 'ROLE_WILDCARD_ADMIN_ONLY',
        message: 'Só um administrador pode dar acesso total a um cargo.',
      });
      expect(prisma.role.findUnique).toHaveBeenCalledWith({
        where: { id: 'r-seller' },
        select: { isAdmin: true, permissions: true },
      });
      expect(prisma.role.update).not.toHaveBeenCalled();

      await expect(
        service.create({ name: 'X', companyId: 'c-1', ...wildcard }, seller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.role.create).not.toHaveBeenCalled();
    });

    it('nem o usuário sem cargo', async () => {
      await expect(
        service.update('r-1', wildcard, { companyId: 'c-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ['administrador pelo token', { ...seller, isAdmin: true }, null],
      ['superadmin', { ...seller, isSystemAdmin: true }, null],
      [
        'cargo administrador no banco',
        seller,
        { isAdmin: true, permissions: [] },
      ],
      [
        'cargo com acesso total',
        seller,
        { isAdmin: false, permissions: ['*'] },
      ],
    ])('%s concede', async (_label, actor, ownRole) => {
      prisma.role.findUnique.mockResolvedValue(ownRole);
      await service.update('r-1', wildcard, actor as RoleActor);
      expect(prisma.role.update).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: wildcard,
      });
    });

    it('lista sem acesso total não passa pela regra', async () => {
      await service.update('r-1', { permissions: ['client:view'] }, seller);
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
      expect(prisma.role.update).toHaveBeenCalled();
    });
  });
});
