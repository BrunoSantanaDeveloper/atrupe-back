import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NfeItemDto, UpdateNfeDraftDto } from './nfe.dto';

/** As opções do ValidationPipe global (app.module.ts). */
const opcoes = { whitelist: true, forbidNonWhitelisted: true };

/** Item como a tela de emissão guarda no rascunho (PATCH /draft/:id). */
const itemDaTela = {
  itemNumber: 1,
  productId: 'produto-1',
  productCode: 'PS2',
  description: 'Placa PS2mm 250x100cm',
  ncm: '49111010',
  cfop: 5102,
  cstIcms: '102',
  cstIpi: '',
  cstPis: '99',
  cstCofins: '99',
  unit: 'UN',
  uCom: 'UN',
  ean: '',
  ceantrib: '',
  quantity: 1,
  unitValue: 530,
  discount: 0,
  freight: 0,
  insurance: 0,
  totalValue: 530,
  isService: false,
  needsConfiguration: false,
};

const errosDoRascunho = (corpo: object) =>
  validate(plainToInstance(UpdateNfeDraftDto, corpo), opcoes);

describe('UpdateNfeDraftDto', () => {
  it('aceita o item como a tela guarda no rascunho', async () => {
    expect(await errosDoRascunho({ items: [itemDaTela] })).toEqual([]);
  });

  it('aceita a O.S. de origem do item da nota consolidada', async () => {
    const consolidado = {
      ...itemDaTela,
      sourceOrderId: 'ordem-1',
      sourceOrderCode: 'Vendas-147',
    };

    expect(await errosDoRascunho({ items: [consolidado] })).toEqual([]);
  });

  it('aceita as quantidades de conversão e a impressão da O.S.', async () => {
    const comConversao = {
      ...itemDaTela,
      pieceQuantity: 1,
      measureQuantity: 2.5,
      measureUnit: 'M2',
    };

    expect(
      await errosDoRascunho({
        items: [comConversao],
        origemItens: 'a'.repeat(40),
      }),
    ).toEqual([]);
  });

  it('recusa campo que o rascunho não conhece', async () => {
    const erros = await errosDoRascunho({
      items: [{ ...itemDaTela, isEditing: true }],
    });

    expect(erros).not.toEqual([]);
  });
});

describe('NfeItemDto', () => {
  it('recusa desconto negativo, que o schema da nota recusaria', async () => {
    const erros = await validate(
      plainToInstance(NfeItemDto, {
        productId: 'produto-1',
        quantity: 1,
        unitValue: 100,
        discount: -10,
      }),
      opcoes,
    );

    expect(erros.map((erro) => erro.property)).toEqual(['discount']);
    expect(Object.values(erros[0].constraints || {})[0]).toMatch(
      /não pode ser negativo/,
    );
  });
});
