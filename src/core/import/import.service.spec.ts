import { ImportService } from './import.service';

describe('ImportService CSV parsing', () => {
  let service: ImportService;

  beforeEach(() => {
    service = new ImportService({} as any, {} as any);
  });

  it('parses Excel CSV files with sep directive and semicolon delimiter', async () => {
    const content =
      '\ufeffsep=;\r\nnome;email;valor\r\nCliente Teste;cliente@example.com;40,50';

    const rows = await service.parseCsv(Buffer.from(content, 'utf-8'));

    expect(rows).toEqual([
      {
        nome: 'Cliente Teste',
        email: 'cliente@example.com',
        valor: '40,50',
      },
    ]);
  });

  it('parses legacy comma-delimited CSV files', async () => {
    const content = 'nome,email,valor\nCliente Teste,cliente@example.com,40.50';

    const rows = await service.parseCsv(Buffer.from(content, 'utf-8'));

    expect(rows).toEqual([
      {
        nome: 'Cliente Teste',
        email: 'cliente@example.com',
        valor: '40.50',
      },
    ]);
  });

  it('normalizes Brazilian decimal values when converting money to cents', () => {
    expect((service as any).toCents('1.234,56')).toBe(123456);
    expect((service as any).toCents('1234.56')).toBe(123456);
  });
});
