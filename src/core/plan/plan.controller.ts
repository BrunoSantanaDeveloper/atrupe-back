import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { SubscriptionDTO } from './dtos/plan';

const RESOURCE = 'plan';

@Controller(RESOURCE)
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos os planos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de planos retornada com sucesso',
    isArray: true,
  })
  async findAll(@Query() companyId: string) {
    return await this.planService.findAll(companyId);
  }

  @Post('default/:companyId')
  @ApiOperation({ summary: 'Cria os planos padrões' })
  @ApiResponse({
    status: 201,
    description: 'Planos padrões criados com sucesso',
  })
  createDefaultPlans(@Param('companyId') companyId: string) {
    return this.planService.createDefaultPlans(companyId);
  }

  @Post('subscription/:planId/:companyId')
  @ApiOperation({ summary: 'Cria uma assinatura de plano' })
  @ApiResponse({
    status: 201,
    description: 'Assinatura de plano criada com sucesso',
  })
  createSubscription(@Body() subscription: SubscriptionDTO) {
    return this.planService.planSubscription(subscription);
  }
}
