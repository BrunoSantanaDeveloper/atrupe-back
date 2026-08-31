import { Body, Controller, Get, Put, UseGuards, Req } from '@nestjs/common';
import {
  SystemSettingsService,
  AsaasConfigState,
} from './system-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { UpdateAiAccessConfigDto } from './dto/update-ai-access-config.dto';
import { UpdateIcmsAliquotasDto } from './dto/update-icms-aliquotas.dto';
import { IcmsAliquotaInternaService } from '../fiscal/shared/icms-aliquota-interna.service';

@Controller('system-settings')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class SystemSettingsController {
  constructor(
    private readonly settingsService: SystemSettingsService,
    private readonly icmsAliquotas: IcmsAliquotaInternaService,
  ) {}

  /**
   * Alíquota interna do ICMS por UF. Parte dos padrões não foi conferida na
   * legislação estadual, por isso cada linha informa a procedência — a tela
   * mostra o que ainda precisa de validação em vez de sugerir que tudo está
   * aferido.
   */
  @Get('icms-aliquotas-internas')
  async listIcmsAliquotas() {
    return this.icmsAliquotas.listar();
  }

  @Put('icms-aliquotas-internas')
  async updateIcmsAliquotas(@Body() dto: UpdateIcmsAliquotasDto) {
    return this.icmsAliquotas.atualizar(dto.aliquotas);
  }

  @Get('asaas')
  async getAsaasConfig() {
    const config = await this.settingsService.getAsaasConfig();
    return {
      ...config,
      sandbox: {
        ...config.sandbox,
        token: config.sandbox.token ? '********' : '',
      },
      production: {
        ...config.production,
        token: config.production.token ? '********' : '',
      },
    };
  }

  @Put('asaas')
  async updateAsaasConfig(
    @Body() payload: { config: AsaasConfigState; password?: string },
    @Req() req: any,
  ) {
    return this.settingsService.updateAsaasConfig(
      payload.config,
      payload.password,
      req.user.userId,
    );
  }

  @Get('ai-access')
  getAiAccessConfig() {
    return this.settingsService.getAiAccessConfig();
  }

  @Put('ai-access')
  updateAiAccessConfig(@Body() payload: UpdateAiAccessConfigDto) {
    return this.settingsService.updateAiAccessConfig(payload.enabled);
  }
}
