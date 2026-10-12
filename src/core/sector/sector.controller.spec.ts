import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { SectorController } from './sector.controller';

const S = '7d7f2f8e-4c1b-4d7e-9a43-0f5b1a9c2e10';

/**
 * Custo e venda da hora do setor: a composição custeia a mão de obra e o
 * preparo por eles. São campos novos, então a regra de valores vale já: sem
 * `values:values:view`, não aparecem e não podem ser gravados.
 */
describe('SectorController: custo e venda da hora', () => {
  let granted: Set<string>;
  let service: Record<string, jest.Mock>;
  let controller: SectorController;
  const sector = {
    id: S,
    name: 'Impressão',
    saleUnit: 'HOUR',
    hourCost: 4500,
    hourSale: 12000,
  };
  const request = () => ({ user: { userId: 'u-1', companyId: 'c-1' } });

  beforeEach(() => {
    granted = new Set(['values:values:view']);
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [sector], total: 1 }),
      findOne: jest.fn().mockResolvedValue(sector),
      update: jest.fn().mockResolvedValue(sector),
      create: jest.fn().mockResolvedValue(sector),
    };
    controller = new SectorController(
      service as any,
      { enforceFeature: jest.fn() } as any,
      { companySector: { findUnique: jest.fn() } } as any,
      {
        hasPermission: jest.fn(async (_user, action, resource) =>
          granted.has(`${resource}:${action}`),
        ),
      } as any,
    );
  });

  it('quem vê valores recebe os dois campos', async () => {
    expect(await controller.findOne(request(), S)).toEqual(sector);
    expect((await controller.findAll(request(), {} as any)).data[0]).toEqual(
      sector,
    );
  });

  it('sem a permissão de valores, os campos saem das leituras', async () => {
    granted.clear();
    const { hourCost, hourSale, ...rest } = sector;
    expect(hourCost && hourSale).toBeTruthy();

    expect(await controller.findOne(request(), S)).toEqual(rest);
    expect((await controller.findAll(request(), {} as any)).data[0]).toEqual(
      rest,
    );
    expect(
      await controller.update(request(), S, { name: 'Impressão' }),
    ).toEqual(rest);
  });

  it('gravar custo ou venda da hora pede a permissão de valores', async () => {
    granted.clear();
    await expect(
      controller.update(request(), S, { hourCost: 5000 }),
    ).rejects.toMatchObject({
      response: {
        code: 'PERMISSION_DENIED',
        permissions: ['values:values:view'],
      },
    });
    expect(service.update).not.toHaveBeenCalled();

    granted.add('values:values:view');
    await controller.update(request(), S, { hourCost: 5000, hourSale: null });
    expect(service.update).toHaveBeenCalledWith(S, {
      hourCost: 5000,
      hourSale: null,
    });
  });

  it('o valor vai em centavos inteiros, sem negativo; nulo apaga', async () => {
    const errors = async (body: Record<string, unknown>) =>
      (
        await validate(plainToInstance(UpdateSectorDto, body), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).map((error) => error.property);

    expect(await errors({ hourCost: 45.5 })).toEqual(['hourCost']);
    expect(await errors({ hourSale: -1 })).toEqual(['hourSale']);
    expect(await errors({ hourCost: 4500, hourSale: null })).toEqual([]);
  });
});
