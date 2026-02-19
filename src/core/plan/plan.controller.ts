import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { CreatePlanDTO, UpdatePlanDTO } from './dtos/plan';
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

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove um plano' })
  @ApiResponse({
    status: 200,
    description: 'Plano removido com sucesso',
  })
  deletePlan(@Param('id') id: string) {
    return this.planService.deletePlan(id);
  }

  @Post('seed')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cria os planos padrão do sistema' })
  @ApiResponse({
    status: 201,
    description: 'Planos padrão criados com sucesso',
  })
  async seedDefaultPlans(@Query('companyId') companyId?: string) {
    return this.planService.createDefaultPlans(companyId);
  }

  // Keep existing subscription endpoints...
}
