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
import { UpdateCreditLimitDefaultDto } from './dto/update-credit-limit.dto';

const RESOURCE = 'credit-limit';
const GROUP = 'financial';

@ApiTags('Limite de Credito')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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

  @Patch('')
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
