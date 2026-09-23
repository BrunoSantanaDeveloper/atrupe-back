import { INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';

import { NfeController } from './nfe.controller';
import { NfeService } from './nfe.service';
import { NfeEventsService } from './nfe-events.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { BlockLevelGuard } from '../../auth/guards/block-level.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { FiscalHistoryLockGuard } from '../shared/fiscal-history-lock.guard';

/**
 * A listagem da tela de emissao e refeita a cada troca de aba/filtro. O teto de
 * 10/min do modulo existe para os eventos fiscais (chamadas pagas ao provedor) e
 * derrubava a listagem inteira com 429 depois de poucos cliques.
 *
 * O cenario abaixo reproduz o registro global do ThrottlerModule: enquanto os
 * limites vinham do `forRoot()` (@Global, sobrescrito pela ultima registracao),
 * o teto de 3/min dos endpoints publicos governava tambem a listagem fiscal e o
 * `@SkipThrottle()` — que so vale para o throttler chamado 'default' — era
 * ignorado.
 */
@Module({
  controllers: [NfeController],
  providers: [
    {
      provide: NfeService,
      useValue: {
        findUnified: jest.fn(() => []),
        consultStatus: jest.fn(() => ({ status: 'AUTHORIZED' })),
      },
    },
    { provide: NfeEventsService, useValue: {} },
  ],
})
class FakeNfeModule {}

describe('NfeController — throttle das leituras', () => {
  let app: INestApplication;

  const allowAll = { canActivate: () => true };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      // O registro global declara o throttler mais restritivo da aplicacao
      // ('public', 3/min): o guard fiscal precisa ignora-lo por completo.
      imports: [
        ThrottlerModule.forRoot([{ name: 'public', ttl: 60000, limit: 3 }]),
        FakeNfeModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAll)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAll)
      .overrideGuard(BlockLevelGuard)
      .useValue(allowAll)
      .overrideGuard(FiscalHistoryLockGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { companyId: req.headers['x-test-company'] || 'company-1' };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('nao aplica 429 na listagem unificada mesmo acima do teto do modulo', async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 25; i++) {
      const response = await request(app.getHttpServer()).get(
        '/fiscal/nfe/unified',
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(0);
    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  // Sem isto, um throttler zerado passaria no teste acima sem proteger nada.
  it('mantem o teto de 10/min nos endpoints que consultam o provedor', async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 12; i++) {
      const response = await request(app.getHttpServer())
        .get('/fiscal/nfe/nfe-1/status')
        .set('x-test-company', 'company-throttled');
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('conta o teto por empresa, e nao pelo IP de egress compartilhado', async () => {
    for (let i = 0; i < 12; i++) {
      await request(app.getHttpServer())
        .get('/fiscal/nfe/nfe-1/status')
        .set('x-test-company', 'company-a');
    }

    const other = await request(app.getHttpServer())
      .get('/fiscal/nfe/nfe-1/status')
      .set('x-test-company', 'company-b');

    expect(other.status).toBe(200);
  });
});
