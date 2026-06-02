import { Body, Controller, Get, Put, UseGuards, Req } from '@nestjs/common';
import {
  SystemSettingsService,
  AsaasConfigState,
} from './system-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { UpdateAiAccessConfigDto } from './dto/update-ai-access-config.dto';

@Controller('system-settings')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class SystemSettingsController {
  constructor(private readonly settingsService: SystemSettingsService) {}

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
