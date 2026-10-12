import {
  Controller,
  Post,
  Body,
  Patch,
  UseGuards,
  Req,
  Query,
  Get,
  Param,
} from '@nestjs/common';
import { CashControlService } from './cash-control.service';
import {
  CloseCashRegisterDto,
  CreateCashRegisterDto,
} from './dto/create-cash-control.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  EditCashRegisterDto,
  TransferDto,
} from './dto/update-cash-control.dto';
import { ListCashRegistersDto } from './dto/cash-control-filters.dto';

const RESOURCE = 'cash-control';
const GROUP = 'financial';

@ApiTags('Controle de Caixa')
// O controle de caixa inteiro é recurso de plano.
// O TenantGuard confere que o caixa da rota é da empresa da sessão: as rotas
// por id fechavam, reabriam, liam e lançavam no caixa de outra empresa
@UseGuards(JwtAuthGuard, FeatureGuard, TenantGuard)
@RequiresFeature('cash_control')
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class CashControlController {
  constructor(private readonly cashControlService: CashControlService) {}
  @Post('open')
  async openCashRegister(
    @Req() req,
    @Body() createCashRegisterDto: CreateCashRegisterDto,
  ) {
    createCashRegisterDto.companyId = req.user.companyId;
    return this.cashControlService.openCashRegister(createCashRegisterDto);
  }

  @Patch('close/:cashRegisterId')
  @TenantResource('cashRegister', 'cashRegisterId')
  async closeCashRegister(
    @Param('cashRegisterId') cashRegisterId: string,
    @Body() closeCashRegisterDto: CloseCashRegisterDto,
  ) {
    closeCashRegisterDto.cashRegisterId = cashRegisterId;
    return this.cashControlService.closeCashRegister(closeCashRegisterDto);
  }

  @Get('quantity')
  @ApiOperation({
    summary:
      'Obtém a quantidade de todos os status de caixas abertos ou fechados.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de caixas retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.cashControlService.findAllQuantity(companyId);
  }

  @Get('')
  async listCashRegisters(@Req() req, @Query() query: ListCashRegistersDto) {
    query.companyId = req.user.companyId;
    return this.cashControlService.listCashRegisters(query);
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    description: 'ID do caixa',
    example: 'cashRegisterId123',
  })
  @TenantResource('cashRegister')
  async findOneCashRegister(@Param('id') id: string) {
    return this.cashControlService.findOneCashRegister(id);
  }

  @Patch(':cashRegisterId')
  @TenantResource('cashRegister', 'cashRegisterId')
  async editCashRegister(
    @Param('cashRegisterId') cashRegisterId: string,
    @Body() editDto: EditCashRegisterDto,
  ) {
    editDto.cashRegisterId = cashRegisterId;
    return this.cashControlService.editCashRegister(editDto);
  }

  @Post('transfer')
  async transferFunds(@Req() req, @Body() transferDto: TransferDto) {
    return this.cashControlService.transferFunds(
      transferDto,
      req.user.companyId,
    );
  }

  @Post('reopen/:id')
  @TenantResource('cashRegister')
  async reopenCashRegister(@Req() req, @Param('id') id: string) {
    return this.cashControlService.reopenCashRegister(id);
  }
}
