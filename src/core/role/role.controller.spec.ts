import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoleController } from './role.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HAS_PERMISSION_KEY } from '../auth/abac/has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from '../auth/abac/has-any-permission.decorator';

const PERMISSION = 'company_settings:roles';

describe('RoleController', () => {
  const req = {
    user: { companyId: 'c-1', userId: 'u-1', role: 'r-x', isAdmin: false },
  };
  let service: Record<string, jest.Mock>;
  let controller: RoleController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new RoleController(service as any);
  });

  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RoleController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each([
    ['create', 'create'],
    ['findOne', 'view'],
    ['update', 'edit'],
    ['remove', 'delete'],
  ])('%s exige %s em cargos', (method, action) => {
    const handler = RoleController.prototype[method];
    expect(Reflect.getMetadata(HAS_PERMISSION_KEY, handler)).toEqual({
      action,
      resource: PERMISSION,
    });
  });

  it('a lista fica sem permissão: "Meu perfil" e o cadastro de colaborador a usam', () => {
    const handler = RoleController.prototype.findAll;
    expect(Reflect.getMetadata(HAS_PERMISSION_KEY, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(HAS_ANY_PERMISSION_KEY, handler),
    ).toBeUndefined();
  });

  it('toda rota usa a empresa da sessão', async () => {
    const filter: any = { page: '1', limit: '10', companyId: 'c-2' };
    const dto: any = { name: 'Caixa', companyId: 'c-2' };

    await controller.create(req, dto);
    await controller.findAll(filter, req);
    await controller.findOne(req, 'r-1');
    await controller.update(req, 'r-1', { name: 'Vendas' });
    await controller.remove(req, 'r-1');

    expect(service.create).toHaveBeenCalledWith(
      { name: 'Caixa', companyId: 'c-1' },
      req.user,
    );
    expect(service.findAll).toHaveBeenCalledWith({
      page: '1',
      limit: '10',
      companyId: 'c-1',
    });
    expect(service.findOne).toHaveBeenCalledWith('r-1', 'c-1');
    expect(service.update).toHaveBeenCalledWith(
      'r-1',
      { name: 'Vendas' },
      req.user,
    );
    expect(service.remove).toHaveBeenCalledWith('r-1', 'c-1');
  });

  it('create devolve as recusas do service como vieram e o erro do banco como 400', async () => {
    const notFound = new NotFoundException('Setor não encontrado.');
    service.create.mockRejectedValueOnce(notFound);
    await expect(controller.create(req, { name: 'X' } as any)).rejects.toBe(
      notFound,
    );

    jest.spyOn(console, 'log').mockImplementation();
    service.create.mockRejectedValueOnce(new Error('falha do banco'));
    await expect(
      controller.create(req, { name: 'X' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
