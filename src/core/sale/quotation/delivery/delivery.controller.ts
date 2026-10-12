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
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';
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

    const canAccessOtherQuotations =
      await this.abacService.canAccessOtherSellers(user, 'edit');

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
  /**
   * A transportadora e o endereço vêm no corpo: precisam ser da empresa do
   * orçamento (a da sessão, já conferida). O endereço vale se for o atual da
   * própria entrega (o personalizado não tem dono) ou de um cliente da
   * empresa; antes, o personalizado de outra empresa era sobrescrito ou
   * apagado pela edição seguinte.
   */
  private async assertRefsOfCompany(
    companyId: string,
    dto: { supplierId?: string | null; clientAddressId?: string | null },
    currentAddressId?: string | null,
  ) {
    await assertBelongsToCompany(
      this.prisma.supplier,
      dto.supplierId,
      { companyId },
      'Fornecedor não encontrado.',
    );

    const addressId = dto.clientAddressId;
    if (
      !addressId ||
      addressId === 'custom' ||
      addressId === currentAddressId
    ) {
      return;
    }
    await assertBelongsToCompany(
      this.prisma.address,
      addressId,
      { client: { companyId } },
      'Endereço não encontrado.',
    );
  }

  @Post(':quotationId')
  async createDeliveryInfo(
    @Param('quotationId') quotationId: string,
    @Body() createDeliveryInfoDto: CreateDeliveryInfoDto,
    @Req() req,
  ) {
    await this.validateOwnership(quotationId, req.user);
    await this.assertRefsOfCompany(req.user.companyId, createDeliveryInfoDto);
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
      select: { quotationId: true, clientAddressId: true },
    });
    if (!deliveryInfo) {
      throw new NotFoundException('Informações de entrega não encontradas');
    }
    await this.validateOwnership(deliveryInfo.quotationId, req.user);
    await this.assertRefsOfCompany(
      req.user.companyId,
      updateDeliveryInfoDto,
      deliveryInfo.clientAddressId,
    );

    return this.deliveryService.updateDeliveryInfo(id, updateDeliveryInfoDto);
  }
}
