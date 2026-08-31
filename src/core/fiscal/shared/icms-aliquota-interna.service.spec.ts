import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException } from '@nestjs/common';

import { IcmsAliquotaInternaService } from './icms-aliquota-interna.service';

describe('IcmsAliquotaInternaService', () => {
  let service: IcmsAliquotaInternaService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IcmsAliquotaInternaService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(IcmsAliquotaInternaService);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  describe('listar', () => {
    it('cobre as 27 unidades federadas', async () => {
      expect(await service.listar()).toHaveLength(27);
    });

    /**
     * Parte dos padrões não foi conferida na legislação estadual. A tela
     * precisa distinguir isso, senão o superadmin assume que tudo está aferido.
     */
    it('distingue padrão conferido de não conferido', async () => {
      const linhas = await service.listar();
      const es = linhas.find((l) => l.uf === 'ES');
      const sp = linhas.find((l) => l.uf === 'SP');

      expect(es).toMatchObject({ origem: 'padrao', revisado: true });
      expect(sp).toMatchObject({ origem: 'padrao', revisado: false });
    });

    it('marca como ajustado o que o superadmin alterou', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ value: { SP: 19 } });

      const sp = (await service.listar()).find((l) => l.uf === 'SP');
      expect(sp).toEqual({
        uf: 'SP',
        aliquota: 19,
        origem: 'ajustado',
        revisado: true,
      });
    });

    it('ignora chave inválida gravada no ajuste', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { XX: 10, SP: 'dezoito' },
      });

      const linhas = await service.listar();
      expect(linhas.find((l) => l.uf === 'SP')?.origem).toBe('padrao');
      expect(linhas.some((l) => l.uf === 'XX')).toBe(false);
    });
  });

  describe('resolver', () => {
    it('prefere o ajuste ao padrão', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ value: { SP: 19 } });
      expect(await service.resolver('sp')).toBe(19);
    });

    it('cai no padrão quando não há ajuste', async () => {
      expect(await service.resolver('ES')).toBe(17);
    });

    /** UF desconhecida não pode virar alíquota plausível e errada. */
    it('devolve null para UF desconhecida', async () => {
      expect(await service.resolver('XX')).toBeNull();
      expect(await service.resolver('')).toBeNull();
      expect(await service.resolver(null)).toBeNull();
    });

    it('avisa no log quando usa padrão não conferido', async () => {
      const warn = jest.spyOn((service as any).logger, 'warn');
      await service.resolver('SP');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SP'));
    });
  });

  describe('atualizar', () => {
    it('grava o ajuste normalizando a sigla', async () => {
      await service.atualizar({ ' sp ': 19 });
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { value: { SP: 19 } } }),
      );
    });

    it('remove o ajuste quando recebe null e volta ao padrão', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { SP: 19, RJ: 22 },
      });

      await service.atualizar({ SP: null });
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { value: { RJ: 22 } } }),
      );
    });

    it.each([
      ['UF inexistente', { XX: 10 }],
      ['percentual acima de 100', { SP: 101 }],
      ['percentual negativo', { SP: -1 }],
    ])('recusa %s', async (_caso, entrada) => {
      await expect(service.atualizar(entrada as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });
});
