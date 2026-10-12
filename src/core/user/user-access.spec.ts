import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserCrudService } from './user-crud.service';
import { UserRegistrationService } from './user-registration.service';
import { UserController } from './user.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

/**
 * Usuários entre empresas: o login novo de colaborador, a leitura por id, a
 * lista de usuários e a reativação atravessavam empresas.
 */
describe('Usuários: acesso entre empresas', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => consoleError.mockRestore());

  describe('POST /user/employee', () => {
    it('colaborador de outra empresa: 404, sem criar o login', async () => {
      const prisma: any = {
        employee: { findFirst: jest.fn().mockResolvedValue(null) },
        user: { create: jest.fn() },
      };
      const service = new UserRegistrationService(
        prisma,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await expect(
        service.createUserForEmployee(
          {
            employeeId: 'colaborador-b',
            email: 'novo@empresa-a.com',
            name: 'Novo',
            company: 'empresa-a',
            password: 'Senha@123',
          } as any,
          'admin-a',
        ),
      ).rejects.toThrow(new NotFoundException('Colaborador não encontrado.'));
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'colaborador-b', companyId: 'empresa-a' },
        select: { id: true },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /user/:id', () => {
    const target = {
      id: 'usuario-b',
      name: 'Bia',
      email: 'bia@empresa-b.com',
      avatar: null,
      employee: [
        {
          name: 'Bia',
          company: {
            id: 'empresa-b',
            name: 'Empresa B',
            accessKey: 'chave-invoicy',
            partnerKey: 'chave-parceiro',
          },
          role: { name: 'Admin', isAdmin: true, permissions: ['*'] },
        },
      ],
      userRole: [],
    };
    let prisma: any;
    let service: UserCrudService;

    beforeEach(() => {
      prisma = {
        user: {
          findUnique: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(target),
        },
      };
      service = new UserCrudService(
        prisma,
        { set: jest.fn() } as any,
        {} as any,
      );
    });

    it('usuário de outra empresa: 403, sem ler', async () => {
      prisma.user.findUnique.mockResolvedValue({
        employee: [{ companyId: 'empresa-b' }],
      });

      await expect(
        service.findOneForActor('usuario-b', {
          userId: 'usuario-a',
          companyId: 'empresa-a',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('o próprio usuário lê, e a empresa vem sem as chaves do provedor fiscal', async () => {
      const result = await service.findOneForActor('usuario-b', {
        userId: 'usuario-b',
        companyId: 'empresa-b',
      });

      expect(result.employee.company).toEqual({
        id: 'empresa-b',
        name: 'Empresa B',
      });
    });
  });

  it('GET /user (todos os usuários do sistema, com e-mail) é só do superadmin', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, UserController.prototype.findAll),
    ).toEqual([JwtAuthGuard, SystemAdminGuard]);
  });

  it('reativar o usuário reativa o vínculo da empresa de quem reativa', async () => {
    const prisma: any = {
      company: { findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          employee: [{ companyId: 'empresa-b' }, { companyId: 'empresa-a' }],
        }),
        update: jest.fn().mockResolvedValue({ id: 'usuario-x' }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'vinculo-a' }),
        update: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    const service = new UserCrudService(prisma, {} as any, {} as any);

    await service
      .update('usuario-x', { isActive: true } as any, {
        userId: 'admin-a',
        companyId: 'empresa-a',
      })
      .catch(() => undefined);

    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { userId: 'usuario-x', companyId: 'empresa-a' },
      select: { id: true },
    });
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'vinculo-a' },
      data: { isActive: true },
    });
  });
});
