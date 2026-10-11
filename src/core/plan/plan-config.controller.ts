import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { PlanConfigService } from './plan-config.service';
import {
  PlanConfigHistoryQueryDto,
  PlanFeaturePreviewQueryDto,
  RestorePlanDefaultsDto,
  SetCompanyFeatureDto,
  SetPlanComparisonDto,
  SetPlanFeatureDto,
  SetPlanLimitDto,
  SetPlanPresentationDto,
  SetPlanPricingDto,
} from './dtos/plan-config.dto';

/**
 * Configuração dos planos pelo superadmin (Super Admin › Sistema › Planos):
 * a matriz recurso × plano, os limites, o padrão de fábrica, o histórico e
 * as cortesias por empresa. Todas as rotas têm dois segmentos ou mais, então
 * não colidem com `GET /plan/:id`.
 */
@ApiTags('Planos — configuração')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('plan/config')
export class PlanConfigController {
  constructor(private readonly planConfig: PlanConfigService) {}

  @Get('matrix')
  @ApiOperation({
    summary: 'Matriz recurso × plano, limites e catálogo configurável',
  })
  getMatrix() {
    return this.planConfig.getMatrix();
  }

  @Get('preview')
  @ApiOperation({
    summary:
      'Efeito de incluir ou retirar um recurso de um plano (dependências e assinaturas atingidas), sem alterar nada',
  })
  preview(@Query() query: PlanFeaturePreviewQueryDto) {
    return this.planConfig.previewFeature(
      query.planId,
      query.featureKey,
      query.enabled,
    );
  }

  @Patch(':planId/features')
  @ApiOperation({ summary: 'Inclui ou retira um recurso de um plano' })
  @ApiResponse({
    status: 401,
    description:
      'Senha gerencial ausente ou incorreta (quando há assinaturas atingidas)',
  })
  @ApiResponse({
    status: 409,
    description: 'O número de assinaturas atingidas mudou desde a prévia',
  })
  @ApiResponse({
    status: 422,
    description:
      'Falta a escolha sobre as assinaturas atuais (CHOICE_REQUIRED), a confirmação da cascata — dependências ou planos de cima pela regra cumulativa (DEPENDENCY_REQUIRED, com `plans`) — ou a retirada exige tirar antes dos planos de baixo (LOWER_PLAN_HAS_FEATURE)',
  })
  setFeature(
    @Req() req,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: SetPlanFeatureDto,
  ) {
    return this.planConfig.setFeature({ userId: req.user.userId }, planId, dto);
  }

  @Patch(':planId/limits')
  @ApiOperation({ summary: 'Altera o valor de um limite do plano' })
  setLimit(
    @Req() req,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: SetPlanLimitDto,
  ) {
    return this.planConfig.setLimit({ userId: req.user.userId }, planId, dto);
  }

  @Patch(':planId/pricing')
  @ApiOperation({
    summary:
      'Altera a mensalidade e o preço do usuário adicional (vale para contratações novas)',
  })
  setPricing(
    @Req() req,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: SetPlanPricingDto,
  ) {
    return this.planConfig.setPricing({ userId: req.user.userId }, planId, dto);
  }

  @Patch(':planId/presentation')
  @ApiOperation({ summary: 'Altera os textos do card do plano na trilha' })
  setPresentation(
    @Req() req,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: SetPlanPresentationDto,
  ) {
    return this.planConfig.setPresentation(
      { userId: req.user.userId },
      planId,
      dto,
    );
  }

  @Get('comparison')
  @ApiOperation({ summary: 'Tabela comparativa da trilha (salva e padrão)' })
  getComparison() {
    return this.planConfig.getComparison();
  }

  @Put('comparison')
  @ApiOperation({ summary: 'Salva a tabela comparativa da trilha' })
  setComparison(@Req() req, @Body() dto: SetPlanComparisonDto) {
    return this.planConfig.setComparison({ userId: req.user.userId }, dto);
  }

  @Get(':planId/defaults-diff')
  @ApiOperation({
    summary: 'O que difere do padrão de fábrica (código) neste plano',
  })
  defaultsDiff(@Param('planId', ParseUUIDPipe) planId: string) {
    return this.planConfig.defaultsDiff(planId);
  }

  @Post(':planId/restore-default')
  @ApiOperation({ summary: 'Restaura a composição padrão do plano' })
  @ApiResponse({
    status: 422,
    description:
      'O padrão deixaria a matriz fora da regra cumulativa (NOT_CUMULATIVE, com `violations`); nada é gravado',
  })
  restoreDefault(
    @Req() req,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: RestorePlanDefaultsDto,
  ) {
    return this.planConfig.restoreDefaults(
      { userId: req.user.userId },
      planId,
      dto,
    );
  }

  @Get('history/list')
  @ApiOperation({ summary: 'Histórico da configuração dos planos' })
  history(@Query() query: PlanConfigHistoryQueryDto) {
    return this.planConfig.history(query);
  }

  @Get('companies/:companyId/features')
  @ApiOperation({
    summary:
      'Recursos de uma empresa: do plano, mantidos ao sair do plano e cortesias',
  })
  companyFeatures(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.planConfig.companyFeatures(companyId);
  }

  @Patch('companies/:companyId/features')
  @ApiOperation({
    summary: 'Concede ou retira um recurso (cortesia) de uma empresa',
  })
  setCompanyFeature(
    @Req() req,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SetCompanyFeatureDto,
  ) {
    return this.planConfig.setCompanyFeature(
      { userId: req.user.userId },
      companyId,
      dto,
    );
  }
}
