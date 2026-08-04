import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';

import { NfeController } from './nfe.controller';
import { NfeService } from './nfe.service';
import { NfeEventsService } from './nfe-events.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { BlockLevelGuard } from '../../auth/guards/block-level.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';

/**
 * A listagem da tela de emissao e refeita a cada troca de aba/filtro. O teto de
 * 10/min do modulo existe para os eventos fiscais (chamadas pagas ao provedor) e
 * derrubava a listagem inteira com 429 depois de poucos cliques.
 */
describe('NfeController — throttle das leituras', () => {
  let app: INestApplication;

  const allowAll = { canActivate: () => true };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        // Mesma configuracao do NfeModule.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 10 }]),
      ],
      controllers: [NfeController],
      providers: [
        { provide: NfeService, useValue: { findUnified: jest.fn(() => []) } },
        { provide: NfeEventsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAll)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAll)
      .overrideGuard(BlockLevelGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { companyId: 'company-1' };
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
});
