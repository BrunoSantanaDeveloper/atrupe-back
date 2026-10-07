import { ImportService } from './import.service';
import { CLIENT_IMPORT_SCHEMA } from './schemas/client-import.schema';
import { QUOTATION_IMPORT_SCHEMA } from './schemas/quotation-import.schema';

/**
 * Migração para uma conta que já estava em uso.
 *
 * A migração foi desenhada para conta vazia: casa cliente e colaborador só pelo
 * código do legado, casa produto pelo código do produto e grava o número de
 * documento que veio do legado. Numa conta em uso isso duplicaria cadastros,
 * sobrescreveria produto do cliente e repetiria número de orçamento. Estes
 * testes cobrem o que impede cada um desses casos.
 */
describe('ImportService — conta já em uso', () => {
  const build = (prisma: any) =>
    new ImportService(prisma as any, {} as any, {} as any);

  describe('buildAdoptionIndex', () => {
    it('indexa por dígitos e só quem não tem código do legado', async () => {
      const prisma = {
        client: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'c1', cpf: null, cnpj: '11.222.333/0001-81' },
            { id: 'c2', cpf: '12345678901', cnpj: null },
          ]),
        },
      };

      const index = await build(prisma).buildAdoptionIndex(
        'client',
        'company-1',
      );

      expect(index.get('11222333000181')).toBe('c1');
      expect(index.get('12345678901')).toBe('c2');
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', legacyId: null },
        }),
      );
    });

    it('o colaborador é procurado por CPF', async () => {
      const prisma = {
        employee: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'e1', cpf: '123.456.789-01' }]),
        },
      };

      const index = await build(prisma).buildAdoptionIndex(
        'employee',
        'company-1',
      );

      expect(index.get('12345678901')).toBe('e1');
    });
  });

  describe('findProductAdoptions', () => {
    const linhas = [
      { codigo: '10', nome: 'Banner' },
      { codigo: '20', nome: 'Adesivo' },
      { codigo: '30', nome: 'Placa' },
    ];

    const prisma = (produtos: any[]) => ({
      product: { findMany: jest.fn().mockResolvedValue(produtos) },
    });

    it('lista o produto da conta que tem o mesmo código e não é da migração', async () => {
      const db = prisma([
        // Do cliente: mesmo código, outro produto.
        { code: '10', legacyId: null, items: [{ id: 'i1' }] },
        // Criado por uma carga anterior: será atualizado, não adotado.
        { code: '20', legacyId: '20', items: [{ id: 'i2' }] },
      ]);

      const resultado = await build(db).findProductAdoptions(
        linhas,
        'company-1',
      );

      expect(resultado.adopted).toEqual(['10']);
      expect(resultado.withoutItem).toEqual([]);
    });

    it('separa o produto adotado que não tem item cadastrado', async () => {
      // A venda migrada tira a unidade e as medidas do primeiro item do
      // produto; sem item, ela falha.
      const db = prisma([{ code: '30', legacyId: null, items: [] }]);

      const resultado = await build(db).findProductAdoptions(
        linhas,
        'company-1',
      );

      expect(resultado.adopted).toEqual(['30']);
      expect(resultado.withoutItem).toEqual(['30']);
    });
  });

  describe('findProductToAdoptByName', () => {
    const prisma = (produtos: any[]) => ({
      product: { findMany: jest.fn().mockResolvedValue(produtos) },
    });

    it('adota o único produto de mesmo nome, ignorando acento e caixa', async () => {
      const db = prisma([
        { id: 'p1', name: 'FACHADA ACRILICO' },
        { id: 'p2', name: 'Banner' },
      ]);

      const achado = await build(db).findProductToAdoptByName(
        'Fachada Acrílico',
        'company-1',
      );

      expect(achado).toEqual({ id: 'p1' });
    });

    it('só considera produto ainda sem vínculo com o legado', async () => {
      const db = prisma([]);

      await build(db).findProductToAdoptByName('Banner', 'company-1');

      expect(db.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', legacyId: null },
        }),
      );
    });

    it('não adota quando o nome não identifica um só produto', async () => {
      // O cliente mantém dois cadastros de mesmo nome de propósito — um para
      // locação e outro para venda. Adotar no escuro juntaria os dois.
      const db = prisma([
        { id: 'p1', name: 'BALCAO ILHA' },
        { id: 'p2', name: 'Balcão Ilha' },
      ]);

      expect(
        await build(db).findProductToAdoptByName('BALCAO ILHA', 'company-1'),
      ).toBeNull();
    });

    it('não consulta o banco com nome vazio', async () => {
      const db = prisma([]);

      expect(
        await build(db).findProductToAdoptByName('   ', 'company-1'),
      ).toBeNull();
      expect(db.product.findMany).not.toHaveBeenCalled();
    });

    it('a carga grava o vínculo no adotado em vez de criar outro produto', async () => {
      const db = {
        product: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null) // não achou por legacyId
            .mockResolvedValueOnce(null), // nem por código
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'p1', name: 'Fachada ACM' }]),
          update: jest.fn().mockResolvedValue({ id: 'p1' }),
          create: jest.fn(),
        },
      };

      await (build(db) as any).importProduct(
        { codigo: 'ACM-34', nome: 'FACHADA ACM', setor: 'Producao' },
        'company-1',
        { legacy: true },
      );

      expect(db.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { legacyId: 'ACM-34' },
      });
      expect(db.product.create).not.toHaveBeenCalled();
    });
  });

  describe('firstNonImportedActivity', () => {
    const prisma = (quotation: any, receivable: any) => ({
      quotation: { findFirst: jest.fn().mockResolvedValue(quotation) },
      receivable: { findFirst: jest.fn().mockResolvedValue(receivable) },
    });

    it('devolve a data mais antiga entre documento e financeiro próprios', async () => {
      const db = prisma(
        { createdAt: new Date('2026-03-10T12:00:00Z') },
        { createdAt: new Date('2026-02-01T09:00:00Z') },
      );

      await expect(
        build(db).firstNonImportedActivity('company-1'),
      ).resolves.toEqual(new Date('2026-02-01T09:00:00Z'));
    });

    it('devolve nulo na conta que ainda não foi usada', async () => {
      await expect(
        build(prisma(null, null)).firstNonImportedActivity('company-1'),
      ).resolves.toBeNull();
    });

    it('não conta o financeiro que veio de documento migrado', async () => {
      // A entrada da venda, o frete e a comissão nasciam sem a marca de
      // importado: a data da migração anterior virava a data de corte, e o
      // período que a nova carga precisa trazer ficava de fora.
      const db = prisma(null, null);

      await build(db).firstNonImportedActivity('company-1');

      expect(db.receivable.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: 'company-1',
            isImported: false,
            OR: [{ quotationId: null }, { quotation: { isImported: false } }],
          },
        }),
      );
    });
  });

  describe('resolveImportSeries', () => {
    const serieDoCliente = {
      id: 's1',
      code: '1',
      proposalValidity: 15,
      textBeforeItems: 'Obrigado pela preferência',
      deliveryDeadline: 5,
      textAfterItems: null,
      billing: 'ON_ORDER',
      productionStatus: 'MANAGE_PRODUCTION',
      sendToProduction: 'DIRECT',
    };

    const prisma = (series: any[]) => ({
      saleSeries: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              series.find(
                (s) =>
                  (where.code === undefined || s.code === where.code) &&
                  (where.isDefault === undefined ||
                    s.isDefault === where.isDefault),
              ) ?? null,
            ),
          ),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 's-nova', ...data }),
          ),
      },
    });

    const resolve = (db: any, history?: boolean) =>
      (build(db) as any).resolveImportSeries('company-1', '1', history);

    it('sem conta em uso, grava na série que o legado indica', async () => {
      const db = prisma([serieDoCliente]);

      await expect(resolve(db)).resolves.toMatchObject({ id: 's1' });
      expect(db.saleSeries.create).not.toHaveBeenCalled();
    });

    it('cria a série do legado que a conta não tem, mantendo o código', async () => {
      // Recusar a venda por causa disso travava a migração inteira; o número
      // do documento antigo precisa continuar valendo.
      const db = prisma([{ id: 's-padrao', code: 'A', isDefault: true }]);

      await expect(resolve(db)).resolves.toMatchObject({ code: '1' });
      expect(db.saleSeries.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ code: '1', title: 'Série 1' }),
      });
    });

    it('lista as séries que a carga vai criar', async () => {
      const db = prisma([serieDoCliente]);
      const linhas = [{ Serie: '1' }, { Serie: '2' }, { Serie: '1' }];

      await expect(
        build(db).findMissingImportSeries(linhas, 'company-1', true),
      ).resolves.toEqual(['LEG-1', 'LEG-2']);
    });

    it('com conta em uso, cria a série do histórico herdando a apresentação', async () => {
      // O número vem do legado: na série do cliente ele colidiria com os
      // documentos que ele já emitiu.
      const db = prisma([serieDoCliente]);

      await expect(resolve(db, true)).resolves.toMatchObject({
        code: 'LEG-1',
      });
      expect(db.saleSeries.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          code: 'LEG-1',
          title: 'Histórico do legado 1',
          proposalValidity: 15,
          textBeforeItems: 'Obrigado pela preferência',
        }),
      });
    });

    it('reaproveita a série do histórico numa segunda carga', async () => {
      const db = prisma([serieDoCliente, { id: 's-leg', code: 'LEG-1' }]);

      await expect(resolve(db, true)).resolves.toMatchObject({ id: 's-leg' });
      expect(db.saleSeries.create).not.toHaveBeenCalled();
    });
  });

  /**
   * A simulação roda os mesmos validadores do CSV, que pressupõem conta vazia.
   * Na migração, o que eles recusavam é justamente o que a carga resolve.
   */
  describe('validação na migração', () => {
    const campo = (schema: any, name: string) =>
      schema.fields.find((f: any) => f.name === name);

    const cnpj = campo(CLIENT_IMPORT_SCHEMA, 'cnpj');
    const serie = campo(QUOTATION_IMPORT_SCHEMA, 'Serie');

    it('documento repetido é aviso na migração e erro no CSV', async () => {
      const db = {
        client: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ name: 'MARCOS HENRIQUE', legacyId: null }),
        },
      };

      await expect(
        cnpj.validate(
          '11222333000181',
          'company-1',
          db,
          { codigoLegado: '1566' },
          true,
        ),
      ).resolves.toMatchObject({ severity: 'warning' });

      await expect(
        cnpj.validate('11222333000181', 'company-1', db, {}, false),
      ).resolves.toMatch(/já existe para o cliente/);
    });

    it('ficha que já pertence a outro registro do legado continua erro', async () => {
      // Aí a carga criaria mesmo uma segunda ficha: o aviso esconderia isso.
      const db = {
        client: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ name: 'OUTRO CLIENTE', legacyId: '99' }),
        },
      };

      await expect(
        cnpj.validate(
          '11222333000181',
          'company-1',
          db,
          { codigoLegado: '1566' },
          true,
        ),
      ).resolves.toMatch(/já existe para o cliente/);
    });

    it('série ausente é aviso na migração, porque a carga cria', async () => {
      const db = {
        saleSeries: { findFirst: jest.fn().mockResolvedValue(null) },
      };

      await expect(
        serie.validate('1', 'company-1', db, {}, true),
      ).resolves.toMatchObject({ severity: 'warning' });

      await expect(
        serie.validate('1', 'company-1', db, {}, false),
      ).resolves.toMatch(/Cadastre a série/);
    });
  });
});
