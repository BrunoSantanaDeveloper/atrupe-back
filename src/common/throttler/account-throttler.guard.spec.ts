import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, Logger } from '@nestjs/common';
import { ThrottlerException, ThrottlerModule } from '@nestjs/throttler';
import {
  ACCOUNT_LIMIT_MESSAGE,
  ACCOUNT_LIMIT_PER_MINUTE,
  AccountThrottlerGuard,
  accountOf,
} from './account-throttler.guard';

class Clientes {
  listar() {}
}
class Orcamentos {
  listar() {}
}

const tokenOf = (claims: Record<string, unknown>) =>
  `Bearer h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

function contextFor(
  authorization: string | undefined,
  klass: any = Clientes,
): ExecutionContext {
  const req = {
    headers: authorization ? { authorization } : {},
    ip: '10.0.0.1',
  };
  const res = { header: jest.fn(), setHeader: jest.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => klass.prototype.listar,
    getClass: () => klass,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('AccountThrottlerGuard', () => {
  let guard: AccountThrottlerGuard;
  let module: TestingModule;
  let warn: jest.SpyInstance;
  const original = process.env.ACCOUNT_RATE_LIMIT_ENFORCE;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([])],
      providers: [AccountThrottlerGuard],
    }).compile();
    await module.init();
    guard = module.get(AccountThrottlerGuard);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  // O armazenamento do throttler agenda um timer por janela: sem fechar o
  // módulo, o jest não termina
  afterEach(async () => {
    warn.mockRestore();
    await module.close();
    if (original === undefined) delete process.env.ACCOUNT_RATE_LIMIT_ENFORCE;
    else process.env.ACCOUNT_RATE_LIMIT_ENFORCE = original;
  });

  async function hit(times: number, authorization: string, klass?: any) {
    for (let i = 0; i < times; i++) {
      await guard.canActivate(contextFor(authorization, klass));
    }
  }

  it('lê a conta do token sem conferir a assinatura, e ignora o que não é token', () => {
    expect(
      accountOf({ headers: { authorization: tokenOf({ sub: 'u-1' }) } }),
    ).toBe('u-1');
    expect(accountOf({ headers: {} })).toBeNull();
    expect(accountOf({ headers: { authorization: 'Bearer lixo' } })).toBeNull();
    expect(
      accountOf({ headers: { authorization: tokenOf({ nome: 'x' }) } }),
    ).toBeNull();
  });

  it('por padrão só observa: passa do limite, avisa uma vez e não recusa', async () => {
    delete process.env.ACCOUNT_RATE_LIMIT_ENFORCE;
    const token = tokenOf({ sub: 'u-1' });

    await hit(ACCOUNT_LIMIT_PER_MINUTE + 5, token);
    await expect(guard.canActivate(contextFor(token))).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('conta u-1 passou de 300');
  });

  it('ligado, recusa a partir do limite com 429 em português', async () => {
    process.env.ACCOUNT_RATE_LIMIT_ENFORCE = 'true';
    const token = tokenOf({ sub: 'u-1' });

    await hit(ACCOUNT_LIMIT_PER_MINUTE, token);
    const error = await guard.canActivate(contextFor(token)).then(
      () => undefined,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ThrottlerException);
    expect(error.message).toBe(ACCOUNT_LIMIT_MESSAGE);
  });

  it('a conta soma todas as rotas, e cada conta tem a sua', async () => {
    process.env.ACCOUNT_RATE_LIMIT_ENFORCE = 'true';
    const token = tokenOf({ sub: 'u-1' });

    await hit(ACCOUNT_LIMIT_PER_MINUTE / 2, token, Clientes);
    await hit(ACCOUNT_LIMIT_PER_MINUTE / 2, token, Orcamentos);
    await expect(
      guard.canActivate(contextFor(token, Clientes)),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      guard.canActivate(contextFor(tokenOf({ sub: 'u-2' }))),
    ).resolves.toBe(true);
  });

  it('pedido sem token não conta (login, cadastro e webhooks têm limites próprios)', async () => {
    process.env.ACCOUNT_RATE_LIMIT_ENFORCE = 'true';

    for (let i = 0; i < ACCOUNT_LIMIT_PER_MINUTE + 5; i++) {
      await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(
        true,
      );
    }
  });
});
