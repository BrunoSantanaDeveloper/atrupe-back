import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { asaasConfig } from 'src/config/configuration';
import * as argon2 from 'argon2';

export interface AsaasConfigState {
  environment: 'sandbox' | 'production';
  sandbox: { url: string; token: string };
  production: { url: string; token: string };
}

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(private prisma: PrismaService) {}

  async getAsaasConfig(): Promise<AsaasConfigState> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'asaas_config' },
    });

    if (setting && setting.value) {
      return setting.value as unknown as AsaasConfigState;
    }

    // Default or Fallback from .env
    return {
      environment: 'sandbox',
      sandbox: {
        url: asaasConfig.apiUrl || 'https://api-sandbox.asaas.com/v3',
        token: asaasConfig.token || '',
      },
      production: {
        url: 'https://api.asaas.com/v3',
        token: '',
      },
    };
  }

  async getActiveAsaasConfig(): Promise<{ url: string; token: string }> {
    const config = await this.getAsaasConfig();
    return config[config.environment];
  }

  async updateAsaasConfig(
    data: AsaasConfigState,
    password?: string,
    userId?: string,
  ) {
    if (!password || !userId) {
      throw new UnauthorizedException('Senha do administrador é obrigatória.');
    }

    const adminUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário administrador não encontrado.');
    }

    const isPasswordValid = await argon2.verify(adminUser.password, password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    const existing = await this.getAsaasConfig();

    if (data.sandbox.token === '********') {
      data.sandbox.token = existing.sandbox.token;
    }
    if (data.production.token === '********') {
      data.production.token = existing.production.token;
    }

    const setting = await this.prisma.systemSetting.upsert({
      where: { key: 'asaas_config' },
      update: { value: data as any },
      create: {
        key: 'asaas_config',
        value: data as any,
      },
    });
    return setting.value;
  }
}
