import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateQuotationDto } from './update-quotation.dto';

/**
 * O formulário de edição reenvia o cabeçalho inteiro, e manda `''` nos
 * vínculos que o documento não tem. `@IsOptional` só ignora null e undefined,
 * então o `''` caía no `@IsUUID` e o documento migrado — que não tem fonte de
 * contato — não salvava nem a descrição.
 */
describe('UpdateQuotationDto', () => {
  // O que a tela manda ao editar um documento migrado, que não tem
  // responsável nem atendimento.
  const edicaoDeMigrado = {
    companyId: '3e42b83c-fc05-4bdf-9a8c-fb05f65d85a6',
    clientId: '1c6bae96-7230-4c2b-8049-25633a1cbd5f',
    contactId: '',
    description: 'GERSON - 17/09',
    contactSourceId: '',
    seriesId: 'c8a89fe1-495a-4bfc-8caf-27ab6954521b',
    sellerId: 'c8bcf088-b3cc-43a8-9829-da6154a2bd73',
    quickSale: false,
  };

  it('aceita o vínculo vazio do documento sem fonte de contato', async () => {
    const dto = plainToInstance(UpdateQuotationDto, edicaoDeMigrado);
    const erros = await validate(dto, { whitelist: true });

    expect(erros).toEqual([]);
    // Vazio vira nulo, como o responsável: documento sem atendimento. Se
    // virasse ausente, o histórico registraria "contactSourceId" como campo
    // alterado em toda edição, porque undefined !== null.
    expect(dto.contactSourceId).toBeNull();
    expect(dto.contactId).toBeUndefined();
  });

  it('continua recusando fonte de contato que não é um id', async () => {
    const dto = plainToInstance(UpdateQuotationDto, {
      ...edicaoDeMigrado,
      contactSourceId: 'venda-direta',
    });
    const erros = await validate(dto, { whitelist: true });

    expect(erros.map((e) => e.property)).toEqual(['contactSourceId']);
  });

  it('mantém a fonte de contato informada', async () => {
    const id = '6f1d2c3b-4a5e-4f60-8b71-92c3d4e5f6a7';
    const dto = plainToInstance(UpdateQuotationDto, {
      ...edicaoDeMigrado,
      contactSourceId: id,
    });

    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto.contactSourceId).toBe(id);
  });
});
