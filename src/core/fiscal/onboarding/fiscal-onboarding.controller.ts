import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { FiscalOnboardingService } from './fiscal-onboarding.service';
import { FiscalOnboardingDto } from './fiscal-onboarding.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../../auth/guards/system-admin.guard';

@ApiTags('fiscal-onboarding')
@Controller('fiscal/onboarding')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FiscalOnboardingController {
  constructor(
    private readonly fiscalOnboardingService: FiscalOnboardingService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Submeter dados fiscais para ativação do módulo NF',
    description:
      'Coleta dados fiscais do cliente e tenta auto-provisioning no Invoicy. Se bem-sucedido, o módulo é ativado imediatamente. Caso contrário, fica pendente para revisão.',
  })
  @ApiResponse({ status: 201, description: 'Onboarding submitted' })
  @ApiResponse({ status: 400, description: 'Module already active' })
  async submit(@Body() dto: FiscalOnboardingDto, @Req() req) {
    return this.fiscalOnboardingService.submitOnboarding(
      req.user.companyId,
      dto,
    );
  }

  @Get('status')
  @ApiOperation({
    summary: 'Consultar status do onboarding fiscal',
    description:
      'Retorna o status atual: NOT_STARTED, PENDING, PROVISIONING, ACTIVE, PENDING_REVIEW, REJECTED',
  })
  @ApiResponse({ status: 200, description: 'Status returned' })
  async getStatus(@Req() req) {
    return this.fiscalOnboardingService.getStatus(req.user.companyId);
  }

  // ============== Admin Endpoints ==============

  @Get('pending')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({
    summary: 'Listar onboardings pendentes de revisão (SystemAdmin)',
  })
  @ApiResponse({ status: 200, description: 'List of pending requests' })
  async listPending() {
    return this.fiscalOnboardingService.listPending();
  }

  @Post(':id/approve')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({
    summary: 'Aprovar onboarding manualmente (SystemAdmin)',
    description:
      'Admin fornece a accessKey obtida manualmente do painel Invoicy.',
  })
  @ApiParam({ name: 'id', description: 'Onboarding Request ID' })
  @ApiResponse({ status: 200, description: 'Approved successfully' })
  async approve(
    @Param('id') id: string,
    @Body() body: { accessKey: string },
    @Req() req,
  ) {
    return this.fiscalOnboardingService.adminApprove(
      id,
      req.user.userId,
      body.accessKey,
    );
  }

  @Post(':id/retry')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({
    summary: 'Re-tentar auto-provisioning (SystemAdmin)',
  })
  @ApiParam({ name: 'id', description: 'Onboarding Request ID' })
  @ApiResponse({ status: 200, description: 'Retry successful' })
  async retry(@Param('id') id: string) {
    return this.fiscalOnboardingService.adminRetry(id);
  }

  @Post('company/:companyId/seed-defaults')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({
    summary:
      'Aplicar CFOPs e dados fiscais padrão a empresa já ativa (SystemAdmin)',
    description:
      'Útil para empresas que foram ativadas antes do seed automático existir. Idempotente — não sobrescreve dados já existentes.',
  })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Seed applied' })
  async seedDefaults(@Param('companyId') companyId: string) {
    return this.fiscalOnboardingService.seedFiscalDataForCompany(companyId);
  }
}
