import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AssetController } from './asset.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';

describe('AssetController', () => {
  const req = { user: { companyId: 'c1', userId: 'u1' } };
  let service: Record<string, jest.Mock>;
  let controller: AssetController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findAllTypes: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new AssetController(service as any);
  });

  it('a classe inteira exige a base de custos, depois do login', () => {
    expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, AssetController)).toBe(
      'cost_base',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AssetController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
      FeatureGuard,
    ]);
  });

  it('toda rota usa a empresa da sessão', async () => {
    const dto: any = { name: 'Plotter', companyId: 'c2' };

    await controller.create(req, dto);
    await controller.findAll(req, 10, 1);
    await controller.allTypes(req);
    await controller.findOne(req, 'a-1');
    await controller.update(req, 'a-1', dto);
    await controller.remove(req, 'a-1');

    expect(service.create).toHaveBeenCalledWith('c1', dto);
    expect(service.findAll).toHaveBeenCalledWith('c1', 10, 1);
    expect(service.findAllTypes).toHaveBeenCalledWith('c1');
    expect(service.findOne).toHaveBeenCalledWith('c1', 'a-1');
    expect(service.update).toHaveBeenCalledWith('c1', 'a-1', dto);
    expect(service.remove).toHaveBeenCalledWith('c1', 'a-1');
  });
});
