import { Test, TestingModule } from '@nestjs/testing';
import { PlanService } from './plan.service';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('PlanService', () => {
  let service: PlanService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      plan: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      feature: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<PlanService>(PlanService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPlan', () => {
    it('deve criar um plano com sucesso', async () => {
      const dto = { name: 'New Plan', planType: 'LITE' } as any;
      prismaMock.plan.create.mockResolvedValue({ id: 'p1', ...dto });

      const result = await service.createPlan(dto);

      expect(prismaMock.plan.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual({ id: 'p1', ...dto });
    });

    it('deve lançar BadRequestException em caso de erro', async () => {
      prismaMock.plan.create.mockRejectedValue(new Error('DB Error'));

      await expect(service.createPlan({} as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAllPlans', () => {
    it('deve retornar todos os planos', async () => {
      prismaMock.plan.findMany.mockResolvedValue([{ id: 'p1' }]);

      const result = await service.findAllPlans();

      expect(prismaMock.plan.findMany).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'p1' }]);
    });
  });

  describe('getPublicPlans', () => {
    it('deve retornar planos formatados para a página pública', async () => {
      const mockPlans = [
        {
          id: 'p1',
          name: 'LITE',
          basePrice: 50,
          isActive: true,
          badge: 'Popular',
          concept: 'Basic plan',
          features: { limit: 10 },
          videoUrl: 'http://video.com',
        },
      ];
      prismaMock.plan.findMany.mockResolvedValue(mockPlans);

      const result = await service.getPublicPlans();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'p1',
        name: 'LITE',
        basePrice: 50,
        isActive: true,
        badge: 'Popular',
        videoUrl: 'http://video.com',
        sections: { concept: 'Basic plan', features: { limit: 10 } },
      });
    });
  });

  describe('getPublicModules', () => {
    it('deve retornar modulos publicos', async () => {
      prismaMock.feature.findMany.mockResolvedValue([{ id: 'm1' }]);

      const result = await service.getPublicModules();

      expect(prismaMock.feature.findMany).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'm1' }]);
    });
  });

  describe('findPlanById', () => {
    it('deve retornar plano se encontrado', async () => {
      prismaMock.plan.findUnique.mockResolvedValue({ id: 'p1' });

      const result = await service.findPlanById('p1');

      expect(result).toEqual({ id: 'p1' });
    });

    it('deve lançar NotFoundException se não encontrado', async () => {
      prismaMock.plan.findUnique.mockResolvedValue(null);

      await expect(service.findPlanById('p1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updatePlan', () => {
    it('deve atualizar plano com sucesso', async () => {
      prismaMock.plan.findUnique.mockResolvedValue({ id: 'p1' });
      prismaMock.plan.update.mockResolvedValue({ id: 'p1', name: 'Updated' });

      const result = await service.updatePlan('p1', { name: 'Updated' } as any);

      expect(prismaMock.plan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Updated' },
      });
      expect(result).toEqual({ id: 'p1', name: 'Updated' });
    });
  });

  describe('deletePlan', () => {
    it('deve deletar plano com sucesso', async () => {
      prismaMock.plan.delete.mockResolvedValue({ id: 'p1' });

      const result = await service.deletePlan('p1');

      expect(prismaMock.plan.delete).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
      expect(result).toEqual({ id: 'p1' });
    });
  });
});
