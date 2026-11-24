import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrismaService } from 'nestjs-prisma';

import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { OrderRedoService, RedoActor } from './order-redo.service';

export class RedoOrderDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;

  @ApiProperty({ enum: ['CLIENT', 'COMPANY'] })
  @IsIn(['CLIENT', 'COMPANY'])
  excess: 'CLIENT' | 'COMPANY';

  /** Quem causou a refação: a pessoa (colaborador) ou o setor */
  @ApiPropertyOptional({ enum: ['PERSON', 'SECTOR'] })
  @IsOptional()
  @IsIn(['PERSON', 'SECTOR'])
  responsibleKind?: 'PERSON' | 'SECTOR';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  responsibleId?: string;
}

export class RejectRedoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Aprovar o pedido de refazer a O.S. com produção já feita (GP-51) */
const APPROVE = 'sale:order_redo_approve';

/**
 * Refazer a O.S. (GP-51; Maicol, 23/11/2026): pedir, aprovar ou recusar.
 */
@ApiTags('Vendas - Refazer a O.S.')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sale/order-redo')
export class OrderRedoController {
  constructor(
    private readonly redo: OrderRedoService,
    private readonly prisma: PrismaService,
  ) {}

  private async actor(req): Promise<RedoActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true },
    });
    return {
      companyId: req.user.companyId,
      userId: req.user.userId,
      name: user?.name || '',
    };
  }

  @Get('pending')
  @HasPermission('edit', APPROVE)
  @ApiOperation({ summary: 'Os pedidos de refazer esperando aprovação' })
  pending(@Req() req) {
    return this.redo.pending(req.user.companyId);
  }

  @Get('order/:orderId')
  @HasPermission('view', 'sale:order')
  @ApiOperation({ summary: 'Os pedidos de refazer desta O.S.' })
  list(@Req() req, @Param('orderId') orderId: string) {
    return this.redo.list(req.user.companyId, orderId);
  }

  @Post('order/:orderId')
  @HasPermission('edit', 'sale:order')
  @ApiOperation({ summary: 'Pede para refazer a O.S.' })
  async request(
    @Req() req,
    @Param('orderId') orderId: string,
    @Body() dto: RedoOrderDto,
  ) {
    return this.redo.request(await this.actor(req), orderId, dto);
  }

  @Post(':id/approve')
  @HasPermission('edit', APPROVE)
  @ApiOperation({ summary: 'Aprova: cria a O.S. nova e cancela a antiga' })
  async approve(@Req() req, @Param('id') id: string) {
    return this.redo.approve(await this.actor(req), id);
  }

  @Post(':id/reject')
  @HasPermission('edit', APPROVE)
  @ApiOperation({ summary: 'Recusa o pedido de refazer' })
  async reject(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: RejectRedoDto,
  ) {
    return this.redo.reject(await this.actor(req), id, dto.reason ?? '');
  }
}
