import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSaleSeriesDto } from './create-series.dto';
import { UpdateSaleSeriesDto } from './update-serie.dto';

/**
 * Textos da proposta comercial por série de venda, como no legado. A série sem
 * texto usa o da empresa, então em branco precisa chegar como null.
 */
describe('Textos da proposta na série de venda', () => {
  const opcoes = { whitelist: true, forbidNonWhitelisted: true };

  it('PATCH aceita os textos e guarda como foram digitados', async () => {
    const dto = plainToInstance(UpdateSaleSeriesDto, {
      textBeforeItems: 'Proposta de locação:',
      textAfterItems: '1) Locação mínima de 30 dias;\n2) Frete à parte.',
    });

    expect(await validate(dto, opcoes)).toEqual([]);
    expect(dto.textBeforeItems).toBe('Proposta de locação:');
    expect(dto.textAfterItems).toBe(
      '1) Locação mínima de 30 dias;\n2) Frete à parte.',
    );
  });

  it('texto em branco vira null e a série volta a usar o da empresa', async () => {
    const dto = plainToInstance(UpdateSaleSeriesDto, {
      textBeforeItems: '',
      textAfterItems: '  \n ',
    });

    expect(await validate(dto, opcoes)).toEqual([]);
    expect(dto.textBeforeItems).toBeNull();
    expect(dto.textAfterItems).toBeNull();
  });

  it('PATCH sem os textos não mexe neles (ativar/inativar pela lista)', async () => {
    const dto = plainToInstance(UpdateSaleSeriesDto, { isActive: false });

    expect(await validate(dto, opcoes)).toEqual([]);
    expect(dto.textBeforeItems).toBeUndefined();
    expect(dto.textAfterItems).toBeUndefined();
  });

  it('recusa texto que não é string', async () => {
    const dto = plainToInstance(UpdateSaleSeriesDto, { textBeforeItems: 123 });

    const erros = await validate(dto, opcoes);
    expect(erros.map((erro) => erro.property)).toEqual(['textBeforeItems']);
  });

  it('a série nova já pode nascer com os seus textos', async () => {
    const dto = plainToInstance(CreateSaleSeriesDto, {
      code: 'L1',
      title: 'Orçamento',
      textBeforeItems: 'Proposta de locação:',
      textAfterItems: '',
    });

    expect(await validate(dto, opcoes)).toEqual([]);
    expect(dto.textBeforeItems).toBe('Proposta de locação:');
    expect(dto.textAfterItems).toBeNull();
  });
});
