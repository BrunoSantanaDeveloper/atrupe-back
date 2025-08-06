import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { CreatePlanDTO, UpdatePlanDTO } from './dtos/plan';

const RESOURCE = 'plan';

@ApiTags('Planos')
// @UseGuards(JwtAuthGuard)
// @ApiBearerAuth()
@Controller(RESOURCE)
export class PlanController {
  constructor(private readonly planService: PlanService) {}


  // Plan endpoints
  @Post()
  @ApiOperation({ summary: 'Cria um novo plano' })
  @ApiResponse({
    status: 201,
    description: 'Plano criado com sucesso',
  })
  createPlan(@Body() createPlanDTO: CreatePlanDTO) {
    return this.planService.createPlan(createPlanDTO);
  }

  @Get()
  @ApiOperation({ summary: 'Lista todos os planos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de planos retornada com sucesso',
  })
  findAllPlans() {
    return this.planService.findAllPlans();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um plano pelo ID' })
  @ApiResponse({
    status: 200,
    description: 'Plano encontrado com sucesso',
  })
  findPlanById(@Param('id') id: string) {
    return this.planService.findPlanById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um plano' })
  @ApiResponse({
    status: 200,
    description: 'Plano atualizado com sucesso',
  })
  updatePlan(@Param('id') id: string, @Body() updatePlanDTO: UpdatePlanDTO) {
    return this.planService.updatePlan(id, updatePlanDTO);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um plano' })
  @ApiResponse({
    status: 200,
    description: 'Plano removido com sucesso',
  })
  deletePlan(@Param('id') id: string) {
    return this.planService.deletePlan(id);
  }

  @Post('seed')
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
