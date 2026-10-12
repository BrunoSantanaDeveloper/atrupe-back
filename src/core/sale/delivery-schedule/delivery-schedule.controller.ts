import {
  NotFoundException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DeliveryScheduleService } from './delivery-schedule.service';
import { CreateDeliveryScheduleDto } from './dto/create-delivery-schedule.dto';
import { UpdateDeliveryScheduleDto } from './dto/update-delivery-schedule.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PlanControlService } from 'src/core/plan/plan-control.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { DeliveryScheduleFitlerDto } from './dto/filter.dto';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';
const RESOURCE = 'delivery-schedule';

@ApiTags('Agenda de entrega')
// Todas as rotas exigem login: criar, ler, editar, excluir e finalizar um
// agendamento estavam abertas.
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class DeliveryScheduleController {
  constructor(
    private readonly deliveryScheduleService: DeliveryScheduleService,
    private readonly planControl: PlanControlService,
    private readonly prisma: PrismaService,
  ) {}

  /** O agendamento precisa ser da empresa de quem pede. */
  private async assertOwnership(id: string, companyId: string) {
    const found = await this.prisma.deliverySchedule.findFirst({
      where: {
        id,
        OR: [
          { companyId },
          { companyId: null, order: { quotation: { companyId } } },
        ],
      },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('Agendamento de entrega não encontrado.');
    }
  }

  /**
   * O pedido do corpo precisa ser da empresa: com o de outra, a agenda
   * criada (sem empresa) ou editada ficava ligada ao pedido dela, e concluir
   * a agenda concluía o pedido dela
   */
  private async assertOrderOfCompany(
    orderId: string | undefined,
    companyId: string,
  ) {
    await assertBelongsToCompany(
      this.prisma.order,
      orderId,
      { quotation: { companyId } },
      'Pedido não encontrado.',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Criar um agendamento de entrega' })
  @ApiResponse({ status: 201, description: 'Agendamento criado com sucesso.' })
  async create(
    @Req() req,
    @Body() createDeliveryScheduleDto: CreateDeliveryScheduleDto,
  ) {
    await this.assertOrderOfCompany(
      createDeliveryScheduleDto.orderId,
      req.user.companyId,
    );
    return this.deliveryScheduleService.create(
      createDeliveryScheduleDto,
      req.user.companyId,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Obtém a lista de todos os agendamentos de entrega',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de orçamentos retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() query: DeliveryScheduleFitlerDto) {
    query.companyId = req.user.companyId;
    // As abas "Produção" (IN_PRODUCTION) e "Todos" (sem status) são recurso
    // de plano; entrega, faturamento e finalizados são livres.
    if (!query.status || query.status === 'IN_PRODUCTION') {
      await this.planControl.enforceFeature(
        req.user.companyId,
        'delivery_production_tabs',
      );
    }
    return await this.deliveryScheduleService.findAll(query);
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os status de orçamentos',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de orçamentos retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.deliveryScheduleService.findAllQuantity(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar um agendamento de entrega pelo ID' })
  async findOne(@Req() req, @Param('id') id: string) {
    await this.assertOwnership(id, req.user.companyId);
    return this.deliveryScheduleService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um agendamento de entrega' })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateDeliveryScheduleDto: UpdateDeliveryScheduleDto,
  ) {
    await this.assertOwnership(id, req.user.companyId);
    await this.assertOrderOfCompany(
      updateDeliveryScheduleDto.orderId,
      req.user.companyId,
    );
    return this.deliveryScheduleService.update(id, updateDeliveryScheduleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir um agendamento de entrega' })
  async remove(@Req() req, @Param('id') id: string) {
    await this.assertOwnership(id, req.user.companyId);
    return this.deliveryScheduleService.remove(id);
  }

  @Patch('finish/:deliveryScheduleId')
  @ApiOperation({ summary: 'Finalizar um agendamento de entrega' })
  @ApiResponse({
    status: 200,
    description: 'Agendamento de entrega finalizado com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Agendamento de entrega não encontrado',
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao finalizar agendamento',
  })
  async finish(
    @Req() req,
    @Param('deliveryScheduleId') deliveryScheduleId: string,
  ) {
    await this.assertOwnership(deliveryScheduleId, req.user.companyId);
    return await this.deliveryScheduleService.finishDeliverySchedule(
      deliveryScheduleId,
    );
  }
}
