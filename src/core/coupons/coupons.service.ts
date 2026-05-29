import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { Coupon, DiscountType } from '@prisma/client';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Valida se um cupom é elegível para uso e calcula o desconto correspondente.
   */
  async validateCoupon(
    code: string,
    companyId: string,
    planId?: string,
    isModuleAddition?: boolean,
  ) {
    if (!code) {
      throw new BadRequestException('Código do cupom é obrigatório.');
    }

    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    if (!coupon) {
      throw new NotFoundException('Cupom de desconto não encontrado.');
    }

    if (!coupon.isActive) {
      throw new BadRequestException('Este cupom não está mais ativo.');
    }

    const now = new Date();
    if (coupon.validFrom && now < new Date(coupon.validFrom)) {
      throw new BadRequestException('Este cupom ainda não é válido.');
    }

    if (coupon.validUntil && now > new Date(coupon.validUntil)) {
      throw new BadRequestException('Este cupom expirou.');
    }

    // Validar limite de usos global
    if (coupon.maxUses !== null && coupon.maxUses !== undefined) {
      if (coupon.currentUses >= coupon.maxUses) {
        throw new BadRequestException('Este cupom atingiu o limite de usos.');
      }
    }

    // Validar limite de usos por empresa
    const companyUsages = await this.prisma.couponUsage.count({
      where: {
        couponId: coupon.id,
        companyId: companyId,
      },
    });

    if (companyUsages >= coupon.maxUsesPerCompany) {
      throw new BadRequestException(
        `Este cupom já foi utilizado o limite de ${coupon.maxUsesPerCompany} vez(es) pela sua empresa.`,
      );
    }

    // Validar aplicabilidade ao contexto de módulo
    if (isModuleAddition && !coupon.appliesToModules) {
      throw new BadRequestException(
        'Este cupom não pode ser aplicado na contratação de módulos.',
      );
    }

    // Validar aplicabilidade ao plano selecionado
    if (
      planId &&
      coupon.appliesToPlans &&
      coupon.appliesToPlans.length > 0 &&
      !isModuleAddition
    ) {
      if (!coupon.appliesToPlans.includes(planId)) {
        throw new BadRequestException(
          'Este cupom não se aplica ao plano selecionado.',
        );
      }
    }

    return coupon;
  }

  /**
   * Calcula o valor de desconto a ser aplicado sobre um valor base (em centavos).
   */
  calculateDiscount(coupon: Coupon, baseValue: number) {
    if (coupon.minPlanValue && baseValue < coupon.minPlanValue) {
      throw new BadRequestException(
        `O valor mínimo da contratação para este cupom é de R$ ${(
          coupon.minPlanValue / 100
        ).toFixed(2)}.`,
      );
    }

    let discountAmount = 0;

    if (coupon.discountType === DiscountType.PERCENT) {
      discountAmount = Math.round(baseValue * (coupon.discountValue / 100));
    } else if (coupon.discountType === DiscountType.VALUE) {
      discountAmount = Math.round(coupon.discountValue);
    }

    // O desconto nunca pode ser maior do que o valor base
    discountAmount = Math.min(discountAmount, baseValue);
    const finalValue = baseValue - discountAmount;

    return {
      discountAmount,
      finalValue,
    };
  }

  /**
   * Registra a utilização de um cupom e incrementa seus contadores.
   */
  async applyCoupon(
    couponId: string,
    companyId: string,
    subscriptionId: string | null,
    originalValue: number,
    finalValue: number,
  ) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
    });

    if (!coupon) {
      throw new NotFoundException('Cupom não encontrado.');
    }

    const discountApplied = originalValue - finalValue;

    // Criar o registro de uso
    const usage = await this.prisma.couponUsage.create({
      data: {
        couponId,
        companyId,
        subscriptionId,
        discountApplied,
        originalValue,
        finalValue,
      },
    });

    // Incrementar contagem de usos
    await this.prisma.coupon.update({
      where: { id: couponId },
      data: {
        currentUses: {
          increment: 1,
        },
      },
    });

    return usage;
  }

  // --- CRUD Admin ---

  async create(createCouponDto: CreateCouponDto, createdBy?: string) {
    const code = createCouponDto.code.trim().toUpperCase();

    // Validar se código já existe
    const exists = await this.prisma.coupon.findUnique({
      where: { code },
    });

    if (exists) {
      throw new BadRequestException(
        `Já existe um cupom cadastrado com o código ${code}.`,
      );
    }

    try {
      return await this.prisma.coupon.create({
        data: {
          ...createCouponDto,
          code,
          createdBy,
          validFrom: createCouponDto.validFrom
            ? new Date(createCouponDto.validFrom)
            : undefined,
          validUntil: createCouponDto.validUntil
            ? new Date(createCouponDto.validUntil)
            : null,
        },
      });
    } catch (error) {
      throw new BadRequestException('Erro ao criar cupom: ' + error.message);
    }
  }

  async findAll(filters?: { isActive?: boolean; search?: string }) {
    const where: any = {};

    if (filters) {
      if (filters.isActive !== undefined) {
        where.isActive = filters.isActive;
      }
      if (filters.search) {
        where.OR = [
          { code: { contains: filters.search.toUpperCase() } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ];
      }
    }

    try {
      return await this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new BadRequestException('Erro ao buscar cupons: ' + error.message);
    }
  }

  async findOne(id: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id },
      include: {
        usages: true,
      },
    });

    if (!coupon) {
      throw new NotFoundException('Cupom não encontrado.');
    }

    return coupon;
  }

  async update(id: string, updateCouponDto: UpdateCouponDto) {
    // Garantir que não mude o ID e tratar o código se fornecido
    const data: any = { ...updateCouponDto };

    if (data.code) {
      data.code = data.code.trim().toUpperCase();
      // Validar duplicidade
      const exists = await this.prisma.coupon.findFirst({
        where: {
          code: data.code,
          id: { not: id },
        },
      });
      if (exists) {
        throw new BadRequestException(
          `Já existe outro cupom ativo com o código ${data.code}.`,
        );
      }
    }

    if (data.validFrom) {
      data.validFrom = new Date(data.validFrom);
    }
    if (data.validUntil !== undefined) {
      data.validUntil = data.validUntil ? new Date(data.validUntil) : null;
    }

    try {
      return await this.prisma.coupon.update({
        where: { id },
        data,
      });
    } catch (error) {
      throw new BadRequestException(
        'Erro ao atualizar cupom: ' + error.message,
      );
    }
  }

  async deactivate(id: string) {
    try {
      return await this.prisma.coupon.update({
        where: { id },
        data: { isActive: false },
      });
    } catch (error) {
      throw new BadRequestException(
        'Erro ao desativar cupom: ' + error.message,
      );
    }
  }

  async getUsages(couponId: string) {
    try {
      return await this.prisma.couponUsage.findMany({
        where: { couponId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new BadRequestException(
        'Erro ao carregar usos do cupom: ' + error.message,
      );
    }
  }
}
