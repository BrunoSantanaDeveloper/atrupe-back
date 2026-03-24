import {
  Controller,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  NotFoundException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryInfoDto } from './dto/create-delivery.dto';
import { UpdateDeliveryInfoDto } from './dto/update-delivery.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from 'src/core/auth/abac/abac.service';
const RESOURCE = 'delivery';
const GROUP = 'quotation';

@ApiTags('Informações de entrega de orçamentos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class DeliveryController {
  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
  ) {}

  private async validateOwnership(quotationId: string, user: any) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
    });
    if (!quotation) {
      throw new NotFoundException('Orçamento não encontrado');
    }
    if (quotation.companyId !== user.companyId) {
      throw new ForbiddenException('Orçamento pertence a outra empresa');
    }

    const canAccessOtherQuotations = await this.abacService.hasPermission(
      { userId: user.userId, username: user.username },
      'edit',
      'sale:other_quotation',
    );

    if (
      !canAccessOtherQuotations &&
      !user.isAdmin &&
      user.employeeId &&
      quotation.sellerId !== user.employeeId
    ) {
      throw new ForbiddenException(
        'Você não tem permissão para editar informações de entrega de orçamentos de outros vendedores',
      );
    }
  }

  @ApiOperation({
    summary: 'Criação de informações de entrega para um orçamento',
  })
  @ApiResponse({
    status: 201,
    description: 'Entrega criada com sucesso.',
  })
  @Post(':quotationId')
  async createDeliveryInfo(
    @Param('quotationId') quotationId: string,
    @Body() createDeliveryInfoDto: CreateDeliveryInfoDto,
    @Req() req,
  ) {
    await this.validateOwnership(quotationId, req.user);
    return this.deliveryService.createDeliveryInfo(
      quotationId,
      createDeliveryInfoDto,
    );
  }

  @ApiOperation({
    summary: 'Edição das informações de entrega de um orçamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Entrega atualizada com sucesso.',
  })
  @Patch(':id')
  async updateDeliveryInfo(
    @Param('id') id: string,
    @Body() updateDeliveryInfoDto: UpdateDeliveryInfoDto,
    @Req() req,
  ) {
    const deliveryInfo = await this.prisma.deliveryInfo.findUnique({
      where: { id },
      select: { quotationId: true },
    });
    if (!deliveryInfo) {
      throw new NotFoundException('Informações de entrega não encontradas');
    }
    await this.validateOwnership(deliveryInfo.quotationId, req.user);

    return this.deliveryService.updateDeliveryInfo(id, updateDeliveryInfoDto);
  }
}
