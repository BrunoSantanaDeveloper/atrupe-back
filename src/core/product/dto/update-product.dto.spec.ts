import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';

/**
 * PATCH /product/:id. O DTO herdava os padrões da criação, e salvar pela tela
 * de produtos reativava o produto inativo.
 */
describe('UpdateProductDto', () => {
  const opcoes = { whitelist: true, forbidNonWhitelisted: true };

  it('campo ausente chega ausente, e não com o padrão da criação', async () => {
    const dto = plainToInstance(UpdateProductDto, { name: 'Placa PS 2mm' });

    expect(await validate(dto, opcoes)).toEqual([]);
    expect(dto.isActive).toBeUndefined();
    expect(dto.isService).toBeUndefined();
    expect(dto.isStandard).toBeUndefined();
    expect(dto.allowEditValues).toBeUndefined();
    expect(dto.allowEditDescription).toBeUndefined();
  });

  it('campo enviado vale, inclusive false', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      isActive: false,
      isService: true,
      allowEditValues: false,
    });

    expect(await validate(dto, opcoes)).toEqual([]);
    expect(dto).toMatchObject({
      isActive: false,
      isService: true,
      allowEditValues: false,
    });
  });
});
