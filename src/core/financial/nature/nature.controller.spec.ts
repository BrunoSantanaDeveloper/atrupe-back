import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NatureController } from './nature.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HAS_PERMISSION_KEY } from 'src/core/auth/abac/has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from 'src/core/auth/abac/has-any-permission.decorator';

const PERMISSION = 'financial_settings:chart_accounts';

describe('NatureController', () => {
  const req = { user: { companyId: 'c-1', userId: 'u-1' } };
  let service: Record<string, jest.Mock>;
  let controller: NatureController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      createSubCategory: jest.fn(),
      findAllNatures: jest.fn(),
      findAllNaturesByLevel2: jest.fn(),
      findAllSubCategoryByNature: jest.fn(),
      findAllQuantity: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      updateSubCategory: jest.fn(),
      removeSubCategory: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new NatureController(service as any);
  });

  const permissionOf = (method: string) =>
    Reflect.getMetadata(HAS_PERMISSION_KEY, NatureController.prototype[method]);
  const anyPermissionOf = (method: string) =>
    Reflect.getMetadata(
      HAS_ANY_PERMISSION_KEY,
      NatureController.prototype[method],
    );

  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, NatureController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each([
    ['create', 'create'],
    ['findAllQuantity', 'view'],
    ['findAll', 'view'],
    ['findOne', 'view'],
    ['updateSubCategory', 'edit'],
    ['removeSubCategory', 'edit'],
    ['update', 'edit'],
    ['remove', 'delete'],
  ])('%s exige %s no plano de contas', (method, action) => {
    expect(permissionOf(method)).toEqual({ action, resource: PERMISSION });
  });

  it('criar subcategoria aceita create (o que a tela pede) ou edit (regra do time)', () => {
    expect(permissionOf('createSubCategory')).toBeUndefined();
    expect(anyPermissionOf('createSubCategory')).toEqual([
      { action: 'create', resource: PERMISSION },
      { action: 'edit', resource: PERMISSION },
    ]);
  });

  it.each([
    'findAllSubNatures',
    'findAllSubNaturesLevel2',
    'findAllSubCategory',
  ])(
    '%s fica sem permissão: é lista de apoio dos formulários financeiros',
    (method) => {
      expect(permissionOf(method)).toBeUndefined();
      expect(anyPermissionOf(method)).toBeUndefined();
    },
  );

  it('toda rota usa a empresa da sessão', async () => {
    await controller.create(req, { companyId: 'c-2' } as any);
    await controller.createSubCategory(req, 'n-1', { companyId: 'c-2' } as any);
    await controller.findAllSubCategory(req, 'n-1');
    await controller.findOne(req, 'n-1');
    await controller.updateSubCategory('s-1', { description: 'x' }, req);
    await controller.removeSubCategory(req, 's-1');
    await controller.update(req, 'n-1', { description: 'x' });
    await controller.remove(req, 'n-1');

    expect(service.create).toHaveBeenCalledWith({ companyId: 'c-1' });
    expect(service.createSubCategory).toHaveBeenCalledWith({
      companyId: 'c-1',
      natureId: 'n-1',
    });
    expect(service.findAllSubCategoryByNature).toHaveBeenCalledWith(
      'n-1',
      'c-1',
    );
    expect(service.findOne).toHaveBeenCalledWith('n-1', 'c-1');
    expect(service.updateSubCategory).toHaveBeenCalledWith(
      's-1',
      { description: 'x' },
      'c-1',
    );
    expect(service.removeSubCategory).toHaveBeenCalledWith('s-1', 'c-1');
    expect(service.update).toHaveBeenCalledWith('n-1', 'c-1', {
      description: 'x',
    });
    expect(service.remove).toHaveBeenCalledWith('n-1', 'c-1');
  });
});
