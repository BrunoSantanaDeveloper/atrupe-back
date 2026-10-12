import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException } from '@nestjs/common';
import { CategoryController } from './category.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeDefined();
  return error;
}

describe('CategoryController: permissão pelo tipo do grupo (EC-31)', () => {
  const req = { user: { companyId: 'c-1', userId: 'u-1', role: 'r-1' } };
  let service: Record<string, jest.Mock>;
  let abac: { hasPermission: jest.Mock };
  let controller: CategoryController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      findOwn: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    abac = { hasPermission: jest.fn().mockResolvedValue(true) };
    controller = new CategoryController(service as any, abac as any);
  });

  it('a classe só exige login: as leituras servem aos formulários', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CategoryController)).toEqual([
      JwtAuthGuard,
    ]);
  });

  it.each([
    ['CLIENT', 'register:client'],
    ['SUPPLIER', 'register:supplier'],
    ['PRODUCT', 'product_settings:products'],
    ['SERVICE', 'product_settings:products'],
    ['PAYABLE', 'financial_settings:chart_accounts'],
  ])('criar grupo %s pede create em %s', async (kind, resource) => {
    await controller.create(req, { name: 'Grupo', kind } as any);
    expect(abac.hasPermission).toHaveBeenCalledWith(
      req.user,
      'create',
      resource,
    );
    expect(service.create).toHaveBeenCalledWith({
      name: 'Grupo',
      kind,
      companyId: 'c-1',
    });
  });

  it('sem a permissão do tipo, recusa com o 403 do guard e não cria', async () => {
    abac.hasPermission.mockResolvedValue(false);
    const error = await rejection(
      controller.create(req, { name: 'VIP', kind: 'CLIENT' } as any),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        code: 'PERMISSION_DENIED',
        message: 'Você não tem permissão para esta ação.',
        permissions: ['register:client:create'],
      }),
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('alterar pede edit no tipo gravado, e confere a empresa antes', async () => {
    service.findOwn.mockResolvedValue({ id: 'g-1', kind: 'SUPPLIER' });
    await controller.update(req, 'g-1', { name: 'Outro nome' });
    expect(service.findOwn).toHaveBeenCalledWith('g-1', 'c-1');
    expect(abac.hasPermission).toHaveBeenCalledTimes(1);
    expect(abac.hasPermission).toHaveBeenCalledWith(
      req.user,
      'edit',
      'register:supplier',
    );
    expect(service.update).toHaveBeenCalledWith('g-1', 'c-1', {
      name: 'Outro nome',
    });
  });

  it('trocar o tipo pede edit nos dois cadastros', async () => {
    service.findOwn.mockResolvedValue({ id: 'g-1', kind: 'CLIENT' });
    abac.hasPermission.mockImplementation(
      async (_u, _a, resource) => resource === 'register:client',
    );
    const error = await rejection(
      controller.update(req, 'g-1', { kind: 'PRODUCT' as any }),
    );
    expect(error.getResponse().permissions).toEqual([
      'product_settings:products:edit',
    ]);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('excluir pede delete no tipo gravado', async () => {
    service.findOwn.mockResolvedValue({ id: 'g-1', kind: 'CLIENT' });
    abac.hasPermission.mockResolvedValue(false);
    const error = await rejection(controller.remove(req, 'g-1'));
    expect(error.getResponse().permissions).toEqual(['register:client:delete']);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('a categoria de outra empresa nem chega à permissão', async () => {
    const notFound = new Error('404');
    service.findOwn.mockRejectedValue(notFound);
    await expect(controller.remove(req, 'g-9')).rejects.toBe(notFound);
    expect(abac.hasPermission).not.toHaveBeenCalled();
  });

  it('a leitura por id usa a empresa da sessão', async () => {
    await controller.findOne(req, 'g-1');
    expect(service.findOne).toHaveBeenCalledWith('g-1', 'c-1');
  });
});
