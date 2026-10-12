import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { firstValueFrom, of } from 'rxjs';
import { MoneyFields, ValuesOnly } from './money-fields.decorator';
import {
  ValuesVisibilityInterceptor,
  canViewValues,
  findMoneyFields,
  omitMoneyFields,
  valuesRuleOf,
} from './values-visibility.interceptor';

/**
 * Dinheiro só para quem tem `values:values:view`: o helper único das rotas
 * antigas. Observa por padrão; com VALUES_VISIBILITY_ENFORCE=true omite os
 * campos (@MoneyFields) e recusa a rota (@ValuesOnly).
 */
describe('valores só com values:values:view', () => {
  const fields = new Set(['salePrice', 'unitCost', 'discount', 'value']);

  describe('omitMoneyFields', () => {
    it('tira o campo de dinheiro em qualquer nível e deixa o resto', () => {
      const body = {
        total: 2,
        data: [
          {
            id: 'p-1',
            name: 'Lona',
            salePrice: 30,
            unitCost: 12,
            items: [{ id: 'i-1', name: 'Tinta', unitCost: 0, width: 2.5 }],
          },
        ],
      };

      expect(omitMoneyFields(body, fields)).toEqual({
        total: 2,
        data: [
          {
            id: 'p-1',
            name: 'Lona',
            items: [{ id: 'i-1', name: 'Tinta', width: 2.5 }],
          },
        ],
      });
    });

    it('não altera a resposta original (pode estar num cache)', () => {
      const body = { salePrice: 30, items: [{ unitCost: 12 }] };

      const pruned = omitMoneyFields(body, fields);

      expect(pruned).not.toBe(body);
      expect(body).toEqual({ salePrice: 30, items: [{ unitCost: 12 }] });
    });

    it('só o número sai: bloco, texto e nulo com o mesmo nome ficam', () => {
      const body = {
        // Nas condições de pagamento `discount` é um bloco; no item, o valor
        discount: { discountType: 'VALUE', discountValue: 5 },
        items: [{ discount: 10 }],
        // No PDF, o documento do cliente vem em `value`
        document: { type: 'CPF', value: '12345678900' },
        salePrice: null,
      };

      expect(
        omitMoneyFields(body, new Set([...fields, 'discountValue'])),
      ).toEqual({
        discount: { discountType: 'VALUE' },
        items: [{}],
        document: { type: 'CPF', value: '12345678900' },
        salePrice: null,
      });
    });

    it('Decimal é número; data, buffer e arquivo passam como estão', () => {
      const createdAt = new Date('2026-10-12T12:00:00Z');
      const file = Buffer.from('pdf');
      const body = {
        salePrice: new Prisma.Decimal('19.90'),
        quantity: new Prisma.Decimal('3'),
        createdAt,
        file,
      };

      const pruned = omitMoneyFields(body, fields);

      expect(Object.keys(pruned)).toEqual(['quantity', 'createdAt', 'file']);
      expect(pruned.quantity).toBe(body.quantity);
      expect(pruned.createdAt).toBe(createdAt);
      expect(pruned.file).toBe(file);
    });

    it('mantém a classe do objeto e resolve referência circular', () => {
      class Line {
        constructor(
          public name: string,
          public unitCost: number,
        ) {}
        label() {
          return `linha ${this.name}`;
        }
      }
      const line = new Line('Corte', 8);
      const body: any = { line, again: line };
      body.self = body;

      const pruned: any = omitMoneyFields(body, fields);

      expect(pruned.line).toBeInstanceOf(Line);
      expect(pruned.line.label()).toBe('linha Corte');
      expect(pruned.line).not.toHaveProperty('unitCost');
      expect(pruned.again).toBe(pruned.line);
      expect(pruned.self).toBe(pruned);
    });

    it('resposta que não é objeto passa como veio', () => {
      expect(omitMoneyFields(undefined, fields)).toBeUndefined();
      expect(omitMoneyFields(null, fields)).toBeNull();
      expect(omitMoneyFields(42, fields)).toBe(42);
      expect(omitMoneyFields('ok', fields)).toBe('ok');
    });
  });

  describe('findMoneyFields', () => {
    it('lista os campos de dinheiro presentes, sem repetir', () => {
      const body = {
        data: [
          { salePrice: 30, unitCost: 12, items: [{ unitCost: 4 }] },
          { salePrice: 10, discount: { discountType: 'VALUE' } },
        ],
      };

      expect(findMoneyFields(body, fields)).toEqual(['salePrice', 'unitCost']);
    });

    it('sem dinheiro na resposta, lista vazia', () => {
      expect(findMoneyFields({ data: [{ name: 'Lona' }] }, fields)).toEqual([]);
      expect(findMoneyFields(undefined, fields)).toEqual([]);
    });
  });

  describe('valuesRuleOf', () => {
    @ValuesOnly()
    class Extrato {
      list() {}
      @ValuesOnly(false)
      quantity() {}
      @MoneyFields('amount')
      mixed() {}
    }

    class Produto {
      @MoneyFields('salePrice', 'unitCost')
      list() {}
      plain() {}
    }

    it('a marca da classe vale para a rota sem marca', () => {
      expect(valuesRuleOf(Extrato.prototype.list, Extrato)).toEqual({
        valuesOnly: true,
      });
    });

    it('a marca da rota vale sobre a da classe', () => {
      expect(valuesRuleOf(Extrato.prototype.quantity, Extrato)).toBeNull();
      expect(valuesRuleOf(Extrato.prototype.mixed, Extrato)).toEqual({
        fields: new Set(['amount']),
      });
    });

    it('rota com campos e rota sem marca', () => {
      expect(valuesRuleOf(Produto.prototype.list, Produto)).toEqual({
        fields: new Set(['salePrice', 'unitCost']),
      });
      expect(valuesRuleOf(Produto.prototype.plain, Produto)).toBeNull();
    });
  });

  describe('interceptor', () => {
    @ValuesOnly()
    class ExtratoController {
      list() {}
    }

    class ProdutoController {
      @MoneyFields('salePrice', 'unitCost')
      list() {}
      plain() {}
    }

    const user = { userId: 'u-1', companyId: 'c-1', role: 'cargo-1' };
    const body = () => ({ data: [{ name: 'Lona', salePrice: 30 }] });

    let hasPermission: jest.Mock;
    let interceptor: ValuesVisibilityInterceptor;
    let warn: jest.SpyInstance;
    const enforce = process.env.VALUES_VISIBILITY_ENFORCE;

    const contextOf = (
      controller: any,
      handler: string,
      request: Record<string, unknown> = {},
    ) =>
      ({
        getType: () => 'http',
        getHandler: () => controller.prototype[handler],
        getClass: () => controller,
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            route: { path: '/rota' },
            user,
            ...request,
          }),
        }),
      }) as unknown as ExecutionContext;

    const run = async (context: ExecutionContext, response = body()) => {
      const handle = jest.fn(() => of(response));
      const result = await firstValueFrom(
        await interceptor.intercept(context, { handle }),
      );
      return { result, handle, response };
    };

    beforeEach(() => {
      hasPermission = jest.fn().mockResolvedValue(false);
      interceptor = new ValuesVisibilityInterceptor({ hasPermission } as any);
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      delete process.env.VALUES_VISIBILITY_ENFORCE;
    });

    afterEach(() => {
      warn.mockRestore();
      if (enforce === undefined) delete process.env.VALUES_VISIBILITY_ENFORCE;
      else process.env.VALUES_VISIBILITY_ENFORCE = enforce;
    });

    it('rota sem marca não consulta a permissão', async () => {
      const { result, response } = await run(
        contextOf(ProdutoController, 'plain'),
      );

      expect(result).toBe(response);
      expect(hasPermission).not.toHaveBeenCalled();
    });

    it('quem tem a permissão recebe a resposta inteira', async () => {
      hasPermission.mockResolvedValue(true);
      process.env.VALUES_VISIBILITY_ENFORCE = 'true';

      const { result, response } = await run(
        contextOf(ProdutoController, 'list'),
      );

      expect(result).toBe(response);
      expect(hasPermission).toHaveBeenCalledWith(user, 'view', 'values:values');
      expect(warn).not.toHaveBeenCalled();
    });

    describe('observando (padrão)', () => {
      it('devolve a resposta inteira e registra o que sairia', async () => {
        const { result, response } = await run(
          contextOf(ProdutoController, 'list'),
        );

        expect(result).toBe(response);
        expect(warn).toHaveBeenCalledWith(
          '[observar] GET /rota sairia sem salePrice: usuário u-1, ' +
            'empresa c-1, cargo cargo-1, falta values:values:view',
        );
      });

      it('resposta sem dinheiro não gera aviso', async () => {
        await run(contextOf(ProdutoController, 'list'), {
          data: [{ name: 'Lona' }],
        } as any);

        expect(warn).not.toHaveBeenCalled();
      });

      it('rota só de valores passa e registra a recusa que faria', async () => {
        const { result, response, handle } = await run(
          contextOf(ExtratoController, 'list'),
        );

        expect(handle).toHaveBeenCalled();
        expect(result).toBe(response);
        expect(warn).toHaveBeenCalledWith(
          '[observar] GET /rota seria recusada: usuário u-1, ' +
            'empresa c-1, cargo cargo-1, falta values:values:view',
        );
      });

      it('o mesmo aviso sai uma vez por janela', async () => {
        await run(contextOf(ProdutoController, 'list'));
        await run(contextOf(ProdutoController, 'list'));
        await run(contextOf(ProdutoController, 'list'), {
          data: [{ name: 'Lona', salePrice: 30, unitCost: 12 }],
        } as any);

        // O terceiro traz outro campo: é outro aviso
        expect(warn).toHaveBeenCalledTimes(2);
      });
    });

    describe('com VALUES_VISIBILITY_ENFORCE=true', () => {
      beforeEach(() => {
        process.env.VALUES_VISIBILITY_ENFORCE = 'true';
      });

      it('omite os campos de dinheiro', async () => {
        const { result, response } = await run(
          contextOf(ProdutoController, 'list'),
        );

        expect(result).toEqual({ data: [{ name: 'Lona' }] });
        expect(response).toEqual(body());
        expect(warn).not.toHaveBeenCalled();
      });

      it('recusa a rota só de valores antes de executar', async () => {
        const handle = jest.fn(() => of(body()));

        const refused = interceptor.intercept(
          contextOf(ExtratoController, 'list'),
          { handle },
        );

        await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
        await expect(refused).rejects.toMatchObject({
          response: {
            code: 'PERMISSION_DENIED',
            message: 'Você não tem permissão para esta ação.',
            permissions: ['values:values:view'],
          },
        });
        expect(handle).not.toHaveBeenCalled();
      });
    });

    it('rota sem usuário autenticado não é daqui', async () => {
      process.env.VALUES_VISIBILITY_ENFORCE = 'true';

      const { result, response } = await run(
        contextOf(ProdutoController, 'list', { user: undefined }),
      );

      expect(result).toBe(response);
      expect(hasPermission).not.toHaveBeenCalled();
    });

    it('contexto que não é HTTP passa direto', async () => {
      const handle = jest.fn(() => of('ok'));
      const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

      expect(
        await firstValueFrom(await interceptor.intercept(context, { handle })),
      ).toBe('ok');
      expect(hasPermission).not.toHaveBeenCalled();
    });
  });

  describe('canViewValues', () => {
    it('resolve a permissão uma vez por requisição', async () => {
      const hasPermission = jest.fn().mockResolvedValue(true);
      const request = { user: { userId: 'u-1' } };

      expect(await canViewValues(request, { hasPermission } as any)).toBe(true);
      expect(await canViewValues(request, { hasPermission } as any)).toBe(true);
      expect(hasPermission).toHaveBeenCalledTimes(1);
    });

    it('sem usuário, não vê valores', async () => {
      const hasPermission = jest.fn();

      expect(await canViewValues({}, { hasPermission } as any)).toBe(false);
      expect(hasPermission).not.toHaveBeenCalled();
    });
  });
});
