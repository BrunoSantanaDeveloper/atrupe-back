import { Controller, Get, UseGuards, Query, Req } from '@nestjs/common';
import { FlowService } from './flow.service';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FinancialFlowFilterDTO } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'flow';
const GROUP = 'financial';

@ApiTags('Fluxo Financeiro')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class FlowController {
  constructor(private readonly flowService: FlowService) {}

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os fluxos financeiros' })
  @ApiResponse({
    status: 200,
    description: 'Lista de fluxos financeiros retornada com sucesso.',
    isArray: true,
  })
  findAll(@Req() req, @Query() filter: FinancialFlowFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.flowService.findAll(filter);
  }

  @Get('totals')
  @ApiOperation({ summary: 'Obtém os totais de todos os fluxos financeiros' })
  @ApiResponse({
    status: 200,
    description: 'Valores totais de fluxos financeiros retornada com sucesso.',
    isArray: true,
  })
  findAllTotals(@Req() req, @Query() filter: FinancialFlowFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.flowService.findAllTotals(filter);
  }
}
