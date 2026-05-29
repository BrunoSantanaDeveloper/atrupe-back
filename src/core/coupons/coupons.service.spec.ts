import { Test, TestingModule } from '@nestjs/testing';
import { CouponsService } from './coupons.service';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscountType } from '@prisma/client';

describe('CouponsService', () => {
  let service: CouponsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      coupon: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      couponUsage: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<CouponsService>(CouponsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateCoupon', () => {
    it('deve lançar NotFoundException se o cupom não existir', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(null);

      await expect(
        service.validateCoupon('INVALIDCODE', 'company1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException se o cupom estiver inativo', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        code: 'INACTIVE',
        isActive: false,
      });

      await expect(
        service.validateCoupon('INACTIVE', 'company1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se o cupom expirou', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 2);

      prismaMock.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        code: 'EXPIRED',
        isActive: true,
        validUntil: pastDate,
      });

      await expect(
        service.validateCoupon('EXPIRED', 'company1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se atingiu limite global de usos', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        code: 'LIMIT',
        isActive: true,
        maxUses: 5,
        currentUses: 5,
        maxUsesPerCompany: 1,
      });

      await expect(service.validateCoupon('LIMIT', 'company1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar BadRequestException se a empresa já atingiu limite de usos', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        code: 'COMPANY_LIMIT',
        isActive: true,
        maxUses: 10,
        currentUses: 2,
        maxUsesPerCompany: 1,
      });

      prismaMock.couponUsage.count.mockResolvedValue(1);

      await expect(
        service.validateCoupon('COMPANY_LIMIT', 'company1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se o cupom for restrito a planos específicos e o plano atual não constar', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        code: 'PLAN_RESTRICTED',
        isActive: true,
        maxUses: 10,
        currentUses: 0,
        maxUsesPerCompany: 1,
        appliesToPlans: ['plan-lite'],
      });

      prismaMock.couponUsage.count.mockResolvedValue(0);

      await expect(
        service.validateCoupon('PLAN_RESTRICTED', 'company1', 'plan-pro'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve retornar o cupom se todas as validações passarem', async () => {
      const mockCoupon = {
        id: 'c1',
        code: 'VALID',
        isActive: true,
        maxUses: null,
        currentUses: 0,
        maxUsesPerCompany: 1,
        appliesToPlans: [],
      };

      prismaMock.coupon.findUnique.mockResolvedValue(mockCoupon);
      prismaMock.couponUsage.count.mockResolvedValue(0);

      const result = await service.validateCoupon('VALID', 'company1');
      expect(result).toEqual(mockCoupon);
    });
  });

  describe('calculateDiscount', () => {
    it('deve lançar BadRequestException se o valor do plano for inferior ao mínimo exigido', () => {
      const coupon = {
        minPlanValue: 10000, // R$ 100
      } as any;

      expect(() => service.calculateDiscount(coupon, 5000)).toThrow(
        BadRequestException,
      );
    });

    it('deve calcular desconto percentual corretamente', () => {
      const coupon = {
        discountType: DiscountType.PERCENT,
        discountValue: 20, // 20%
        minPlanValue: null,
      } as any;

      const result = service.calculateDiscount(coupon, 10000); // R$ 100
      expect(result).toEqual({
        discountAmount: 2000, // R$ 20
        finalValue: 8000, // R$ 80
      });
    });

    it('deve calcular desconto fixo em valor corretamente', () => {
      const coupon = {
        discountType: DiscountType.VALUE,
        discountValue: 1500, // R$ 15
        minPlanValue: null,
      } as any;

      const result = service.calculateDiscount(coupon, 10000); // R$ 100
      expect(result).toEqual({
        discountAmount: 1500,
        finalValue: 8500,
      });
    });

    it('deve limitar o valor do desconto ao valor total', () => {
      const coupon = {
        discountType: DiscountType.VALUE,
        discountValue: 5000, // R$ 50
        minPlanValue: null,
      } as any;

      const result = service.calculateDiscount(coupon, 3000); // R$ 30
      expect(result).toEqual({
        discountAmount: 3000,
        finalValue: 0,
      });
    });
  });

  describe('applyCoupon', () => {
    it('deve criar registro de uso e incrementar contador de usos do cupom', async () => {
      const mockCoupon = { id: 'c1', code: 'PROMO' };
      prismaMock.coupon.findUnique.mockResolvedValue(mockCoupon);
      prismaMock.couponUsage.create.mockResolvedValue({ id: 'u1' });
      prismaMock.coupon.update.mockResolvedValue(mockCoupon);

      const result = await service.applyCoupon(
        'c1',
        'company1',
        'sub1',
        10000,
        8000,
      );

      expect(prismaMock.couponUsage.create).toHaveBeenCalledWith({
        data: {
          couponId: 'c1',
          companyId: 'company1',
          subscriptionId: 'sub1',
          discountApplied: 2000,
          originalValue: 10000,
          finalValue: 8000,
        },
      });

      expect(prismaMock.coupon.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { currentUses: { increment: 1 } },
      });

      expect(result).toEqual({ id: 'u1' });
    });
  });
});
