import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Prisma,
  SectorAllocationCriterion,
  SectorNature,
  SectorSaleUnit,
} from '@prisma/client';
import { SectorService } from './sector.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';

/**
 * O setor ganhou de uma vez os campos que três módulos pedem: como vende
 * (composição), a cor (agenda e produção) e a natureza com o rateio (base de
 * custos).
 */
describe('Setor: unidade de venda, cor, natureza e rateio', () => {
  describe('corpo', () => {
    // O mesmo rigor do ValidationPipe global
    const rejected = async (dto: any, body: Record<string, unknown>) =>
      (
        await validate(plainToInstance(dto, body) as object, {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).map((error) => error.property);

    it('a cor é gravada em maiúsculas', () => {
      expect(plainToInstance(UpdateSectorDto, { color: '#1d4ed8' }).color).toBe(
        '#1D4ED8',
      );
    });

    it.each(['azul', '#12345', '1D4ED8', '#1D4ED8FF', '#GGGGGG'])(
      'a cor %p é recusada',
      async (color) => {
        expect(await rejected(UpdateSectorDto, { color })).toEqual(['color']);
      },
    );

    it('nulo e vazio voltam ao padrão do ícone', async () => {
      expect(await rejected(UpdateSectorDto, { color: null })).toEqual([]);
      expect(await rejected(UpdateSectorDto, { color: '' })).toEqual([]);
      expect(plainToInstance(UpdateSectorDto, { color: '' }).color).toBeNull();
    });

    it('unidade de venda e natureza só aceitam os valores do contrato', async () => {
      expect(
        await rejected(UpdateSectorDto, {
          saleUnit: 'KG',
          nature: 'OPERATIONAL',
        }),
      ).toEqual(['saleUnit', 'nature']);
      expect(
        await rejected(UpdateSectorDto, {
          saleUnit: 'M2',
          nature: 'PRODUCTIVE',
        }),
      ).toEqual([]);
    });

    it('o critério do rateio não é editável pelo setor', async () => {
      expect(
        await rejected(UpdateSectorDto, { allocationCriterion: 'MANUAL' }),
      ).toEqual(['allocationCriterion']);
    });

    it('criar aceita os mesmos campos, todos opcionais', async () => {
      expect(
        await rejected(CreateSectorDto, { name: 'Impressão', icon: 'printer' }),
      ).toEqual([]);
      expect(
        await rejected(CreateSectorDto, {
          name: 'Impressão',
          icon: 'printer',
          saleUnit: 'M2',
          color: '#2563eb',
          nature: 'PRODUCTIVE',
        }),
      ).toEqual([]);
    });
  });

  describe('service', () => {
    let prisma: any;
    let service: SectorService;

    beforeEach(() => {
      prisma = {
        company: { findUnique: jest.fn().mockResolvedValue({ id: 'c-1' }) },
        companySector: {
          create: jest.fn(async ({ data }) => data),
          update: jest.fn(async ({ data }) => data),
          findMany: jest.fn().mockResolvedValue([]),
        },
        category: { updateMany: jest.fn() },
        product: { updateMany: jest.fn() },
      };
      service = new SectorService(prisma);
    });

    it('criar grava a unidade, a cor e a natureza do corpo', async () => {
      await service.create({
        name: 'Impressão',
        icon: 'printer',
        companyId: 'c-1',
        saleUnit: SectorSaleUnit.M2,
        color: '#2563EB',
        nature: SectorNature.PRODUCTIVE,
      });

      expect(prisma.companySector.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          saleUnit: 'M2',
          color: '#2563EB',
          nature: 'PRODUCTIVE',
          companyId: 'c-1',
        }),
      });
    });

    it('passar para administrativo devolve o rateio ao padrão', async () => {
      await service.update('setor-1', { nature: SectorNature.ADMINISTRATIVE });

      expect(prisma.companySector.update).toHaveBeenCalledWith({
        where: { id: 'setor-1' },
        data: {
          nature: 'ADMINISTRATIVE',
          allocationCriterion: SectorAllocationCriterion.ACQUISITION_VALUE,
          allocationPercentages: Prisma.DbNull,
          allocationPreviousCriterion: null,
          allocationOutdated: false,
        },
      });
    });

    it('trocar a cor ou a unidade não mexe no rateio', async () => {
      await service.update('setor-1', {
        color: null,
        saleUnit: SectorSaleUnit.HOUR,
      });

      expect(prisma.companySector.update).toHaveBeenCalledWith({
        where: { id: 'setor-1' },
        data: { color: null, saleUnit: 'HOUR' },
      });
    });

    it('os setores com produto vêm com a cor', async () => {
      await service.findAllWithProducts('c-1');

      expect(prisma.companySector.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, name: true, icon: true, color: true },
        }),
      );
    });
  });
});
