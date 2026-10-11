import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlanService } from './plan.service';
import {
  CreatePlanDTO,
  UpdatePlanDTO,
  SetPlanAvailabilityDTO,
} from './dtos/plan';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

const RESOURCE = 'plan';

@ApiTags('Planos')
@Controller(RESOURCE)
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  // Plan endpoints
  @Post()
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cria um novo plano' })
  @ApiResponse({
    status: 201,
    description: 'Plano criado com sucesso',
  })
  createPlan(@Body() createPlanDTO: CreatePlanDTO) {
    return this.planService.createPlan(createPlanDTO);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lista todos os planos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de planos retornada com sucesso',
  })
  findAllPlans() {
    return this.planService.findAllPlans();
  }

  @Get('public/subscription')
  @ApiOperation({ summary: 'Lista planos públicos para página de contratação' })
  @ApiResponse({
    status: 200,
    description: 'Lista de planos públicos retornada com sucesso',
  })
  getPublicPlans() {
    return this.planService.getPublicPlans();
  }

  @Get('public/modules')
  @ApiOperation({ summary: 'Lista módulos disponíveis para contratação' })
  @ApiResponse({
    status: 200,
    description: 'Lista de módulos retornada com sucesso',
  })
  getPublicModules() {
    return this.planService.getPublicModules();
  }

  @Get('public/comparison')
  @ApiOperation({
    summary: 'Tabela comparativa dos planos exibida na trilha de contratação',
  })
  getPublicComparison() {
    return this.planService.getPublicComparison();
  }

  @Get('public/feature-map')
  @ApiOperation({
    summary:
      'De qual plano em diante cada recurso está disponível (mesma regra do 403 FEATURE_NOT_AVAILABLE), sem dado de empresa',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ features: [{ key, name, category, availableFrom: { planType, name, isActive } | null, module }] }',
  })
  getPublicFeatureMap() {
    return this.planService.getPublicFeatureMap();
  }

  @Get('manage')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Lista os planos gerenciáveis (disponibilidade para contratação) — apenas SystemAdmin',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de planos gerenciáveis retornada com sucesso',
  })
  getManageablePlans() {
    return this.planService.getManageablePlans();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Busca um plano pelo ID' })
  @ApiResponse({
    status: 200,
    description: 'Plano encontrado com sucesso',
  })
  findPlanById(@Param('id') id: string) {
    return this.planService.findPlanById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualiza um plano' })
  @ApiResponse({
    status: 200,
    description: 'Plano atualizado com sucesso',
  })
  updatePlan(@Param('id') id: string, @Body() updatePlanDTO: UpdatePlanDTO) {
    return this.planService.updatePlan(id, updatePlanDTO);
  }

  @Patch(':id/availability')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ativa/desativa um plano para contratação (apenas SystemAdmin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Disponibilidade do plano atualizada com sucesso',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema.',
  })
  @ApiResponse({ status: 404, description: 'Plano não encontrado' })
  setPlanAvailability(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: SetPlanAvailabilityDTO,
  ) {
    return this.planService.setPlanAvailability(id, dto.isActive, {
      userId: req.user.userId,
    });
  }

  // Keep existing subscription endpoints...
}
