import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SalarySheetsController } from './salary-sheets.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TENANT_RESOURCE_KEY } from 'src/core/auth/guards/tenant-resource.decorator';

const tenantOf = (method: string) =>
  Reflect.getMetadata(
    TENANT_RESOURCE_KEY,
    SalarySheetsController.prototype[method],
  );

describe('SalarySheetsController (folha lançada)', () => {
  it('a classe passa pelo login, pela permissão e pela empresa da folha', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SalarySheetsController),
    ).toEqual([JwtAuthGuard, PermissionsGuard, TenantGuard]);
  });

  it.each([
    ['getSalarySheet', 'payroll', 'id', undefined],
    ['getSalarySheetPdfData', 'payroll', 'id', undefined],
    ['addSalaryItem', 'payroll', 'payrollId', undefined],
    ['getAdvanceItemPdfData', 'payrollItem', 'itemId', 'payroll'],
    ['updateSalaryItem', 'payrollItem', 'itemId', 'payroll'],
    ['deleteSalaryItem', 'payrollItem', 'itemId', 'payroll'],
    ['cancelAdvance', 'payrollItem', 'itemId', 'payroll'],
  ])('%s confere a empresa (%s :%s)', (method, model, paramName, via) => {
    expect(tenantOf(method)).toEqual({ model, paramName, via });
  });

  it('gerar e abrir/fechar a folha usam a empresa da sessão', async () => {
    const service = {
      generateSalarySheetForEmployees: jest.fn(),
      toggleSalarySheetStatus: jest.fn(),
    };
    const controller = new SalarySheetsController(service as any);
    const req = { user: { companyId: 'c-1' } };

    await controller.generateSalarySheets(req, {
      month: 1,
      year: 2026,
      list: ['e-1'],
    });
    await controller.toggleStatus(req, {
      payrollId: 'f-1',
      status: 'CLOSED',
    } as any);

    expect(service.generateSalarySheetForEmployees).toHaveBeenCalledWith(
      { month: 1, year: 2026, list: ['e-1'] },
      'c-1',
    );
    expect(service.toggleSalarySheetStatus).toHaveBeenCalledWith(
      { payrollId: 'f-1', status: 'CLOSED' },
      'c-1',
    );
  });
});
