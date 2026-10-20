import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AssetController } from './asset.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';

describe('AssetController', () => {
  let assets: Record<string, jest.Mock>;
  let groups: Record<string, jest.Mock>;
  let abac: { hasPermission: jest.Mock };
  let controller: AssetController;
  // Cada requisição nova: a resposta de "ver valores" fica guardada nela
  const req = () => ({ user: { companyId: 'c1', userId: 'u1' } });

  beforeEach(() => {
    const mock = () => jest.fn().mockResolvedValue({});
    assets = {
      list: mock(),
      quantity: mock(),
      detail: mock(),
      create: mock(),
      update: mock(),
      toggle: mock(),
      sell: mock(),
      addCost: mock(),
      addSetup: mock(),
      readings: mock(),
      addReading: mock(),
      removeReading: mock(),
    };
    groups = { list: mock(), create: mock(), rename: mock(), remove: mock() };
    abac = { hasPermission: jest.fn().mockResolvedValue(true) };
    controller = new AssetController(assets as any, groups as any, abac as any);
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
    await controller.findAll(req(), {});
    await controller.findOne(req(), 'a-1');
    await controller.create(req(), dto);
    await controller.update(req(), 'a-1', dto);
    await controller.createGroup(req(), dto);

    expect(assets.list).toHaveBeenCalledWith('c1', {}, true);
    expect(assets.detail).toHaveBeenCalledWith('c1', 'a-1', true);
    expect(assets.create).toHaveBeenCalledWith('c1', 'u1', dto);
    expect(assets.update).toHaveBeenCalledWith('c1', 'u1', 'a-1', dto);
    expect(groups.create).toHaveBeenCalledWith('c1', 'u1', dto);
  });

  it('sem ver valores: a leitura sai sem valores e a escrita é recusada', async () => {
    abac.hasPermission.mockResolvedValue(false);
    await controller.findOne(req(), 'a-1');
    expect(assets.detail).toHaveBeenCalledWith('c1', 'a-1', false);

    await expect(controller.create(req(), {} as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.sell(req(), 'a-1', {} as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assets.create).not.toHaveBeenCalled();
    expect(assets.sell).not.toHaveBeenCalled();
  });

  it('leituras: a empresa da sessão; ler sem valores, gravar como as escritas do bem', async () => {
    const dto = { date: '2026-10-10', value: 1500 };
    await controller.readings(req(), 'a-1', {});
    await controller.addReading(req(), 'a-1', dto);
    await controller.removeReading(req(), 'a-1', 'r-1');
    expect(assets.readings).toHaveBeenCalledWith('c1', 'a-1', {});
    expect(assets.addReading).toHaveBeenCalledWith(
      'c1',
      { companyId: 'c1', userId: 'u1' },
      'a-1',
      dto,
    );
    expect(assets.removeReading).toHaveBeenCalledWith('c1', 'u1', 'a-1', 'r-1');

    abac.hasPermission.mockResolvedValue(false);
    await controller.readings(req(), 'a-1', {});
    await expect(
      controller.addReading(req(), 'a-1', dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assets.addReading).toHaveBeenCalledTimes(1);
  });
});
