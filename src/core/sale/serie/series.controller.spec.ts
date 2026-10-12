import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SaleSeriesController } from './series.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HAS_PERMISSION_KEY } from 'src/core/auth/abac/has-permission.decorator';

const PERMISSION = 'sales_settings:series';

describe('SaleSeriesController', () => {
  const req = { user: { companyId: 'c-1', userId: 'u-1', isAdmin: false } };
  let service: Record<string, jest.Mock>;
  let controller: SaleSeriesController;

  const permissionOf = (method: string) =>
    Reflect.getMetadata(
      HAS_PERMISSION_KEY,
      SaleSeriesController.prototype[method],
    );

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      removeTrainingSerieData: jest.fn(),
    };
    controller = new SaleSeriesController(service as any);
  });

  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SaleSeriesController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each(['create', 'update', 'remove', 'purge'])(
    '%s exige editar séries, como a tela',
    (method) => {
      expect(permissionOf(method)).toEqual({
        action: 'edit',
        resource: PERMISSION,
      });
    },
  );

  it.each(['findAll', 'findOne'])(
    '%s fica sem permissão: o orçamento lista as séries',
    (method) => {
      expect(permissionOf(method)).toBeUndefined();
    },
  );

  it('toda rota por id usa a empresa da sessão', async () => {
    await controller.findOne(req, 's-1');
    await controller.update('s-1', { description: 'x' } as any, req);
    await controller.remove(req, 's-1');
    await controller.purge(req, 's-1');

    expect(service.findOne).toHaveBeenCalledWith('s-1', 'c-1');
    expect(service.update).toHaveBeenCalledWith(
      's-1',
      'c-1',
      { description: 'x' },
      false,
    );
    expect(service.remove).toHaveBeenCalledWith('s-1', 'c-1');
    expect(service.removeTrainingSerieData).toHaveBeenCalledWith('s-1', 'c-1');
  });
});
