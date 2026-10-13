import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  PAYROLL_SETTINGS_PERMISSION,
  SalariesController,
} from './salaries.controller';
import { PayrollTemplatesController } from './payroll-templates.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HAS_PERMISSION_KEY } from 'src/core/auth/abac/has-permission.decorator';

const permissionOf = (target: any, method: string) =>
  Reflect.getMetadata(HAS_PERMISSION_KEY, target.prototype[method]);

describe('SalariesController (estrutura da folha por colaborador)', () => {
  const req = { user: { companyId: 'c-1', userId: 'u-1' } };
  let service: Record<string, jest.Mock>;
  let controller: SalariesController;

  beforeEach(() => {
    service = {
      findAll: jest.fn(),
      getSalaryDetails: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    controller = new SalariesController(service as any);
  });

  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(PAYROLL_SETTINGS_PERMISSION).toBe('financial_settings:payroll');
    expect(Reflect.getMetadata(GUARDS_METADATA, SalariesController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each(['findAll', 'getSalaryDetails', 'create', 'update', 'delete'])(
    '%s exige ver a folha, como a tela',
    (method) => {
      expect(permissionOf(SalariesController, method)).toEqual({
        action: 'view',
        resource: PAYROLL_SETTINGS_PERMISSION,
      });
    },
  );

  it('toda rota por id usa a empresa da sessão', async () => {
    await controller.getSalaryDetails(req, 'ps-1');
    await controller.update(req, 'ps-1', { amount: 10 });
    await controller.delete(req, 'ps-1');

    expect(service.getSalaryDetails).toHaveBeenCalledWith('ps-1', 'c-1');
    expect(service.update).toHaveBeenCalledWith(
      'ps-1',
      'c-1',
      { amount: 10 },
      'u-1',
    );
    expect(service.delete).toHaveBeenCalledWith('ps-1', 'c-1');
  });
});

describe('PayrollTemplatesController (itens de custo da folha)', () => {
  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PayrollTemplatesController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it.each([
    ['findAll', 'view'],
    ['update', 'view'],
    ['remove', 'delete'],
  ])('%s exige %s na folha', (method, action) => {
    expect(permissionOf(PayrollTemplatesController, method)).toEqual({
      action,
      resource: PAYROLL_SETTINGS_PERMISSION,
    });
  });
});
