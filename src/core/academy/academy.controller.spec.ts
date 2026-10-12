import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AcademyController } from './academy.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

const guardsOf = (method: string) =>
  Reflect.getMetadata(GUARDS_METADATA, AcademyController.prototype[method]);

describe('AcademyController', () => {
  it.each([
    'getExtra',
    'createAcademySystem',
    'updateAcademySystem',
    'deleteAcademySystem',
  ])('%s é do superadmin: não tinha nem login', (method) => {
    expect(guardsOf(method)).toEqual([JwtAuthGuard, SystemAdminGuard]);
  });

  it.each([
    'getHelpDataByPage',
    'getAcademySystemsByType',
    'toggleAcademyProgress',
    'createAcademyProgress',
  ])('%s segue aberta a quem está logado', (method) => {
    expect(guardsOf(method)).toEqual([JwtAuthGuard]);
  });
});
