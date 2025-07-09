import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
  ) {}

  /**
   * Mock temporário das features baseado no plano
   * TODO: Substituir pela implementação completa com banco de dados
   */
  private getMockedFeatures(subscriptionType: string): string[] {
    const FEATURES_MAP = {
      LITE: [
        'user_limit_5',
        'additional_cnpj',
        'sectors_management',
        'sales_orders_full',
        'quick_sale',
        'rejection_reasons_full',
        'budget_status_full',
        'delivery_schedule_full',
        'accounts_receivable',
        'accounts_payable',
        'cash_control',
        'pdv',
        'bank_accounts_full',
        'bank_tax_transfer_full',
        'credit_limit',
        'products_full',
        'production_stages_full',
        'clients_full',
        'suppliers_full',
      ],

      START: [
        'user_limit_3',
        'sales_orders_limited',
        'rejection_reasons_limited',
        'budget_status_limited',
        'delivery_schedule_limited',
        'bank_accounts_limited',
        'bank_tax_transfer_limited',
        'products_limited',
        'production_stages_limited',
        'clients_limited',
        'suppliers_limited',
      ],

      TRIAL: [
        'user_limit_3',
        'sales_orders_limited',
        'rejection_reasons_limited',
        'budget_status_limited',
        'delivery_schedule_limited',
        'bank_accounts_limited',
        'bank_tax_transfer_limited',
        'products_limited',
        'production_stages_limited',
        'clients_limited',
        'suppliers_limited',
      ],
    };

    return FEATURES_MAP[subscriptionType] || FEATURES_MAP['START'];
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);

    if (user && (await argon2.verify(user.password, pass))) {
      const { ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    try {
      const subscription =
        user.customer?.subscriptions?.[0]?.plan?.planType ?? 'TRIAL';

      const payload = {
        username: user.email,
        sub: user.id,
        companyId: user.employee[0]?.company.id,
        role: user.employee[0]?.role?.id,
        isAdmin: user.employee[0]?.role?.isAdmin,
        employeeId: user.employee[0]?.id,
        subscription: subscription,
      };

      return {
        id: user.id,
        name: user.employee[0]?.name ?? user.name,
        email: user.email,
        avatar: user.employee[0]?.avatarUrl,
        role: user.employee[0] ? user.employee[0].role?.name : null,
        employeeId: user.employee[0]?.id,
        isAdmin: user.employee[0]?.role?.isAdmin,
        permissions: user.employee[0]?.role?.permissions,
        company: user.employee[0]?.company
          ? {
              id: user.employee[0].company.id,
              name: user.employee[0].company.name,
              legalName: user.employee[0].company.legalName,
              logo: user.employee[0].company.logoUrl,
              favicon: user.employee[0].company.favIconUrl,
              subscription: subscription,
              trialEndsAt: user.employee[0].company.trialEndsAt ?? null,
              features: this.getMockedFeatures(subscription),
            }
          : null,
        access_token: this.jwtService.sign(payload),
      };
    } catch (error) {
      console.log(error);
      throw new Error('Erro ao gerar token');
    }
  }
}
