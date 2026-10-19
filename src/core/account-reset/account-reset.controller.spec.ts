import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { AccountResetController } from './account-reset.controller';
import { AccountResetService } from './account-reset.service';

/**
 * As rotas do "zerar dados" com o ValidationPipe de produção: o corpo que a
 * tela do superadmin manda passa, campo a mais não chega ao serviço, e a
 * prévia lê as opções da query string.
 */
describe('AccountResetController', () => {
  let app: INestApplication;
  const service = {
    preview: jest.fn().mockResolvedValue({ groups: [] }),
    reset: jest.fn().mockResolvedValue({ resetId: 'reset-1' }),
    list: jest.fn().mockResolvedValue([]),
    backupFile: jest.fn().mockResolvedValue({
      filename: 'zerar-dados-company-1-2026-10-19.json.gz',
      content: Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
    }),
  };
  const allowAll = { canActivate: () => true };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AccountResetController],
      providers: [{ provide: AccountResetService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAll)
      .overrideGuard(SystemAdminGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'admin-1' };
      next();
    });
    // Precisa ser idêntica à de src/app.module.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('a prévia lê as opções da query string', async () => {
    await request(app.getHttpServer())
      .get(
        '/admin/companies/company-1/data-reset/preview?includeFiscalDocuments=true&restoreDefaults=false',
      )
      .expect(200);

    expect(service.preview).toHaveBeenCalledWith('company-1', {
      includeFiscalDocuments: true,
      restoreDefaults: false,
    });
  });

  it('sem opções, a prévia deixa notas e configurações de fora', async () => {
    await request(app.getHttpServer())
      .get('/admin/companies/company-1/data-reset/preview')
      .expect(200);

    expect(service.preview).toHaveBeenCalledWith('company-1', {
      includeFiscalDocuments: false,
      restoreDefaults: false,
    });
  });

  it('o corpo que a tela manda passa, e o superadmin vem do token', async () => {
    const body = {
      password: 'senha',
      confirmation: 'Bravix Comunicação Visual',
      includeFiscalDocuments: false,
      restoreDefaults: true,
    };

    await request(app.getHttpServer())
      .post('/admin/companies/company-1/data-reset')
      .send(body)
      .expect(200);

    expect(service.reset).toHaveBeenCalledWith('company-1', body, 'admin-1');
  });

  it.each([
    ['campo a mais', { password: 'senha', confirmation: 'X', companyId: 'y' }],
    ['senha vazia', { password: '', confirmation: 'X' }],
    ['sem o nome', { password: 'senha' }],
    [
      'opção que não é booleana',
      { password: 's', confirmation: 'X', restoreDefaults: 'sim' },
    ],
  ])('%s não chega ao serviço', async (_case, body) => {
    await request(app.getHttpServer())
      .post('/admin/companies/company-1/data-reset')
      .send(body)
      .expect(400);

    expect(service.reset).not.toHaveBeenCalled();
  });

  it('a cópia sai como arquivo .json.gz', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/companies/data-resets/reset-1/backup')
      .expect(200);

    expect(service.backupFile).toHaveBeenCalledWith('reset-1');
    expect(response.headers['content-type']).toBe('application/gzip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="zerar-dados-company-1-2026-10-19.json.gz"',
    );
  });
});
