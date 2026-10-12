import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Get,
  Body,
  Patch,
  Req,
  UseGuards,
  HttpStatus,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { CreditLimitService } from './credit-limit.service';
import { ApiTags, ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import { UpdateCreditLimitDefaultDto } from './dto/update-credit-limit.dto';

const RESOURCE = 'credit-limit';
const GROUP = 'financial';

@ApiTags('Limite de Credito')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(`${GROUP}/${RESOURCE}`)
export class CreditLimitController {
  constructor(private readonly creditLimitService: CreditLimitService) {}

  @Get('')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully fetched the credit limit defaults.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No credit limit defaults found for the specified company.',
  })
  async findOne(@Req() req) {
    const companyId = req.user.companyId;
    const creditLimitDefaults =
      await this.creditLimitService.findOne(companyId);

    if (!creditLimitDefaults) {
      throw new NotFoundException('Credit limit defaults not found');
    }

    return creditLimitDefaults;
  }

  // Ler o padrão é livre (o cadastro de cliente consulta); alterar é do plano.
  @Patch('')
  @HasPermission('edit', 'financial_settings:credit_limits')
  @UseGuards(FeatureGuard)
  @RequiresFeature('credit_limit_configuration')
  @ApiBody({
    type: UpdateCreditLimitDefaultDto,
    description: 'The updated credit limit defaults for the company.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully updated the credit limit defaults.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description:
      'Credit limit default for the specified company and type not found.',
  })
  async update(
    @Req() req,
    @Body() updateCreditLimitDefaultDto: UpdateCreditLimitDefaultDto,
  ) {
    updateCreditLimitDefaultDto.companyId = req.user.companyId;
    const updatedDefaults = await this.creditLimitService.update(
      updateCreditLimitDefaultDto,
    );
    return {
      message: 'Credit limit defaults updated successfully.',
      data: updatedDefaults,
    };
  }
}
