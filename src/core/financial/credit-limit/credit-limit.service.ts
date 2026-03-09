import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  UpdateCreditLimitDefaultDto,
  UpdateCreditLimitTypeDto,
} from './dto/update-credit-limit.dto';

@Injectable()
export class CreditLimitService {
  constructor(private prisma: PrismaService) {}

  async findOne(companyId: string) {
    const creditLimits = await this.prisma.creditLimitDefault.findMany({
      where: { companyId },
      include: {
        paymentConditions: {
          include: {
            paymentCondition: true,
          },
        },
      },
    });

    if (creditLimits.length === 0) {
      return null;
    }

    const allPaymentConditions = await this.prisma.paymentCondition.findMany({
      where: {
        companyId: companyId,
      },
      select: { id: true, name: true },
    });

    const formatCreditLimit = (type: string) => {
      const creditLimit = creditLimits.find((cl) => cl.type === type);
      if (!creditLimit) {
        return {
          minValue: 0,
          maxValue: 0,
          paymentMethods: [],
        };
      }

      const paymentMethodsMap = new Map();
      const associatedConditionIds = new Set(
        creditLimit.paymentConditions.map((pc) => pc.paymentCondition.id),
      );

      // Mapear as condições associadas
      creditLimit.paymentConditions.forEach((pc) => {
        const method = pc.paymentCondition;
        if (!paymentMethodsMap.has(method.id)) {
          paymentMethodsMap.set(method.id, {
            id: method.id,
            name: method.name,
            conditions: [],
          });
        }
        paymentMethodsMap.get(method.id).conditions.push({
          id: pc.paymentCondition.id,
          name: pc.paymentCondition.name,
          isActive: pc.isActive,
        });
      });
      // Adicionar condições não associadas
      allPaymentConditions.forEach((condition) => {
        if (!associatedConditionIds.has(condition.id)) {
          if (!paymentMethodsMap.has(condition.id)) {
            paymentMethodsMap.set(condition.id, {
              id: condition.id,
              name: condition.name,
              conditions: [],
            });
          }
          paymentMethodsMap.get(condition.id).conditions.push({
            id: condition.id,
            name: condition.name,
            isActive: false,
          });
        }
      });

      return {
        minValue: creditLimit.minValue || 0,
        maxValue: creditLimit.maxValue || 0,
        paymentMethods: Array.from(paymentMethodsMap.values()),
      };
    };

    // Retornar os dados de `person` e `company`
    return {
      person: formatCreditLimit('PERSON'),
      company: formatCreditLimit('COMPANY'),
    };
  }

  async update(dto: UpdateCreditLimitDefaultDto) {
    const { person, company, companyId } = dto;

    const result: Record<string, unknown> = {};

    if (person) {
      result.person = await this.updateCreditLimitByType(
        companyId,
        'PERSON',
        person,
      );

      await this.applyGlobalChanges(companyId, 'PERSON', person);
    }

    if (company) {
      result.company = await this.updateCreditLimitByType(
        companyId,
        'COMPANY',
        company,
      );

      await this.applyGlobalChanges(companyId, 'COMPANY', company);
    }

    return result;
  }

  private async applyGlobalChanges(
    companyId: string,
    type: 'PERSON' | 'COMPANY',
    data: UpdateCreditLimitTypeDto,
  ) {
    const { applyMinValueToAll, applyMaxValueToAll, applyPaymentMethodsToAll } =
      data;

    // Atualizar minValue em todos os clientes do tipo
    if (applyMinValueToAll) {
      await this.prisma.client.updateMany({
        where: { companyId, type },
        data: { minValue: data.minValue },
      });
    }

    // Atualizar maxValue em todos os clientes do tipo
    if (applyMaxValueToAll) {
      await this.prisma.client.updateMany({
        where: { companyId, type },
        data: { maxValue: data.maxValue },
      });
    }

    // Atualizar métodos de pagamento em todos os clientes do tipo
    if (applyPaymentMethodsToAll) {
      const clients = await this.prisma.client.findMany({
        where: { companyId, type },
        include: { paymentConditions: true },
      });

      await Promise.all(
        clients.map(async (client) => {
          // Remover condições existentes
          await this.prisma.clientPaymentCondition.deleteMany({
            where: { clientId: client.id },
          });

          // Inserir as novas condições de pagamento
          if (data.conditions) {
            await this.prisma.clientPaymentCondition.createMany({
              data: data.conditions.map((condition) => ({
                clientId: client.id,
                paymentConditionId: condition.id,
                isActive: condition.isActive,
              })),
            });
          }
        }),
      );
    }
  }

  private async updateCreditLimitByType(
    companyId: string,
    type: 'PERSON' | 'COMPANY',
    data: UpdateCreditLimitTypeDto,
  ) {
    const existingDefault = await this.prisma.creditLimitDefault.findFirst({
      where: { companyId, type },
      include: { paymentConditions: true },
    });

    if (!existingDefault) {
      throw new NotFoundException(`CreditLimitDefault for ${type} not found`);
    }

    const updateData: { minValue?: number | null; maxValue?: number | null } = {};
    if (data.minValue !== undefined) updateData.minValue = data.minValue;
    if (data.maxValue !== undefined) updateData.maxValue = data.maxValue;

    const updatedDefault = await this.prisma.creditLimitDefault.update({
      where: { id: existingDefault.id },
      data: updateData,
    });

    if (data.conditions) {
      await Promise.all(
        data.conditions.map(async (condition) => {
          const existingCondition = existingDefault.paymentConditions.find(
            (pc) => pc.paymentConditionId === condition.id,
          );

          if (existingCondition) {
            await this.prisma.creditLimitPaymentCondition.update({
              where: { id: existingCondition.id },
              data: { isActive: condition.isActive },
            });
          } else {
            await this.prisma.creditLimitPaymentCondition.create({
              data: {
                creditLimitDefaultId: existingDefault.id,
                paymentConditionId: condition.id,
                isActive: condition.isActive,
              },
            });
          }
        }),
      );
    }

    return updatedDefault;
  }

  remove(id: number) {
    return `This action removes a #${id} creditLimit`;
  }
}
