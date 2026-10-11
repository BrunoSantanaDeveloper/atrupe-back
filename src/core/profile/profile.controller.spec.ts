import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ProfileController } from './profile.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HAS_PERMISSION_KEY } from '../auth/abac/has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from '../auth/abac/has-any-permission.decorator';

const PERMISSION = 'sales_settings:seller_profile';

describe('ProfileController', () => {
  const req = { user: { companyId: 'c-1', userId: 'u-1' } };
  let service: Record<string, jest.Mock>;
  let controller: ProfileController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      listEmployeesWithoutProfile: jest.fn(),
      addEmployee: jest.fn(),
      removeEmployee: jest.fn(),
    };
    controller = new ProfileController(service as any);
  });

  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ProfileController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each([
    ['listEmployess', 'edit'],
    ['addEmployee', 'edit'],
    ['removeEmployee', 'delete'],
    ['create', 'create'],
    ['findOne', 'view'],
    ['update', 'edit'],
    ['remove', 'delete'],
  ])('%s exige %s no perfil de vendedor', (method, action) => {
    const handler = ProfileController.prototype[method];
    expect(Reflect.getMetadata(HAS_PERMISSION_KEY, handler)).toEqual({
      action,
      resource: PERMISSION,
    });
  });

  it('a lista aceita quem vê o perfil de vendedor ou edita a série de venda', () => {
    const handler = ProfileController.prototype.findAll;
    expect(Reflect.getMetadata(HAS_ANY_PERMISSION_KEY, handler)).toEqual([
      { action: 'view', resource: PERMISSION },
      { action: 'edit', resource: 'sales_settings:series' },
    ]);
  });

  it('toda rota usa a empresa da sessão', async () => {
    const dto: any = { name: 'Balcão', commission: 3 };
    const filter: any = { page: 1, limit: 10, companyId: 'c-2' };

    await controller.listEmployess(req);
    await controller.addEmployee(req, 'p-1', { employeeId: 'e-1' });
    await controller.removeEmployee(req, 'e-1');
    await controller.create(req, { ...dto, companyId: 'c-2' });
    await controller.findAll(filter, req);
    await controller.findOne(req, 'p-1');
    await controller.update(req, 'p-1', dto);
    await controller.remove(req, 'p-1');

    expect(service.listEmployeesWithoutProfile).toHaveBeenCalledWith('c-1');
    expect(service.addEmployee).toHaveBeenCalledWith('p-1', 'c-1', {
      employeeId: 'e-1',
    });
    expect(service.removeEmployee).toHaveBeenCalledWith('e-1', 'c-1');
    expect(service.create).toHaveBeenCalledWith({ ...dto, companyId: 'c-1' });
    expect(service.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      companyId: 'c-1',
    });
    expect(service.findOne).toHaveBeenCalledWith('p-1', 'c-1');
    expect(service.update).toHaveBeenCalledWith('p-1', 'c-1', dto);
    expect(service.remove).toHaveBeenCalledWith('p-1', 'c-1');
  });
});
