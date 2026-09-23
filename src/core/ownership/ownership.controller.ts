import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { loadFiscalHistoryLock } from '../fiscal/shared/fiscal-history-lock';
import { SendOwnershipTransferDto } from './dto/ownership.dto';
import { OwnershipService } from './ownership.service';

/**
 * Titularidade da conta, do lado de dentro: quem é o titular, o histórico, e a
 * transferência pendente. Enviar e cancelar são atos do titular.
 */
@ApiTags('Titularidade')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ownership')
export class OwnershipController {
  constructor(
    private readonly ownership: OwnershipService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Titular atual, titulares anteriores e transferência pendente',
  })
  async view(@Req() req) {
    return this.ownership.view(req.user.companyId, req.user.userId);
  }

  @Post('transfer')
  @ApiOperation({
    summary: 'Enviar a transferência de titularidade (só o titular)',
    description:
      'Pede só o e-mail de destino e a confirmação de que o acesso será perdido. Fica pendente por 14 dias.',
  })
  async send(@Body() dto: SendOwnershipTransferDto, @Req() req) {
    return this.ownership.send(this.userOf(req), dto);
  }

  @Delete('transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancelar a transferência pendente (só o titular)',
  })
  async cancel(@Req() req) {
    return this.ownership.cancel(this.userOf(req));
  }

  @Get('fiscal-history')
  @ApiOperation({
    summary: 'Notas do CNPJ anterior a uma transferência, só para consulta',
    description:
      'Nulo sem troca de CNPJ. Com ela, os emissores do CNPJ anterior e o motivo que a tela mostra nas notas deles.',
  })
  async fiscalHistory(@Req() req) {
    return loadFiscalHistoryLock(this.prisma, req.user.companyId);
  }

  private userOf(req) {
    return { userId: req.user.userId, companyId: req.user.companyId };
  }
}
