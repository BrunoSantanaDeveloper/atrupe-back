import { Logger } from '@nestjs/common';
import { PAGE_LIMIT_MAX, PageLimitMiddleware } from './page-limit.middleware';

function run(
  middleware: PageLimitMiddleware,
  url: string,
  query: Record<string, unknown>,
) {
  const req: any = { method: 'GET', originalUrl: url, url, query };
  const next = jest.fn();
  middleware.use(req, {} as any, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req.query;
}

describe('PageLimitMiddleware', () => {
  let warn: jest.SpyInstance;
  const original = process.env.PAGE_LIMIT_ENFORCE;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
    if (original === undefined) delete process.env.PAGE_LIMIT_ENFORCE;
    else process.env.PAGE_LIMIT_ENFORCE = original;
  });

  it('por padrão só observa: não muda o pedido e avisa uma vez por rota', () => {
    delete process.env.PAGE_LIMIT_ENFORCE;
    const middleware = new PageLimitMiddleware();

    const query = run(middleware, '/role?perPage=9999', { limit: '9999' });
    run(middleware, '/role?perPage=9999', { limit: '9999' });

    expect(query.limit).toBe('9999');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('GET /role pede limit=9999');
  });

  it('ligado, troca pelo teto em limit, pageSize e perPage', () => {
    process.env.PAGE_LIMIT_ENFORCE = 'true';
    const middleware = new PageLimitMiddleware();

    const query = run(middleware, '/client', {
      limit: '500',
      pageSize: '101',
      perPage: '9999',
      page: '2',
    });

    expect(query).toEqual({
      limit: String(PAGE_LIMIT_MAX),
      pageSize: String(PAGE_LIMIT_MAX),
      perPage: String(PAGE_LIMIT_MAX),
      page: '2',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('até o teto, e valores que não são número, passam como vieram', () => {
    process.env.PAGE_LIMIT_ENFORCE = 'true';
    const middleware = new PageLimitMiddleware();

    expect(
      run(middleware, '/client', { limit: '100', perPage: 'abc' }),
    ).toEqual({ limit: '100', perPage: 'abc' });
  });

  it('as rotas do superadmin que listam a base inteira ficam de fora', () => {
    process.env.PAGE_LIMIT_ENFORCE = 'true';
    const middleware = new PageLimitMiddleware();

    expect(
      run(middleware, '/migration/companies', { limit: '5000' }).limit,
    ).toBe('5000');
    expect(
      run(middleware, '/activity-monitor/access-sessions', { limit: '500' })
        .limit,
    ).toBe('500');
  });
});
