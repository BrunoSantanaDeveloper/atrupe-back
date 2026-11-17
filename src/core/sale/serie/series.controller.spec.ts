import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { SaleSeriesController } from './series.controller';

/**
 * As rotas por id da série não conferiam a empresa: uma conta lia, alterava,
 * inativava ou apagava os documentos da série de outra conta. O que a série
 * define (nomenclatura, validade, textos) sai na proposta que a outra conta
 * envia ao cliente.
 */
describe('SaleSeriesController: isolamento por empresa', () => {
  const rotasPorId = ['findOne', 'update', 'remove', 'purge'] as const;

  const contexto = (handler: unknown, companyId: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: { companyId, userId: 'usuario-1' },
          params: { id: 'serie-1' },
        }),
      }),
      getHandler: () => handler,
    }) as unknown as ExecutionContext;

  it('passa pelo TenantGuard depois do login', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SaleSeriesController)).toEqual([
      JwtAuthGuard,
      TenantGuard,
    ]);
  });

  it('o modelo do @TenantResource existe no Prisma (senão o guard deixa passar)', () => {
    const delegates = Object.values(Prisma.ModelName).map(
      (modelo) => modelo[0].toLowerCase() + modelo.slice(1),
    );

    expect(delegates).toContain('saleSeries');
  });

  describe.each(rotasPorId)('%s', (rota) => {
    let guard: TenantGuard;

    beforeEach(() => {
      const prisma = {
        saleSeries: {
          findUnique: jest.fn().mockResolvedValue({ companyId: 'empresa-b' }),
        },
      };
      guard = new TenantGuard(new Reflector(), prisma as any);
    });

    it('recusa a série de outra empresa', async () => {
      const handler = SaleSeriesController.prototype[rota];

      await expect(
        guard.canActivate(contexto(handler, 'empresa-a')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deixa passar a série da própria empresa', async () => {
      const handler = SaleSeriesController.prototype[rota];

      await expect(
        guard.canActivate(contexto(handler, 'empresa-b')),
      ).resolves.toBe(true);
    });
  });
});
