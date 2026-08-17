import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { SalaryTemplatesService } from './salary-templates.service';
import { UpdatePayrollTemplateDto } from './dto/update-payroll-template.dto';

const RESOURCE = 'payroll-templates';
const GROUP = 'financial';

@ApiTags('Itens de custo da folha de pagamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class PayrollTemplatesController {
  constructor(
    private readonly salaryTemplatesService: SalaryTemplatesService,
  ) {}

  @ApiOperation({
    summary:
      'List the company cost items with how many employees still use each one',
  })
  @ApiResponse({ status: 200, description: 'Returns the cost items' })
  @Get()
  findAll(@Req() req) {
    return this.salaryTemplatesService.getCompanyTemplatesWithUsage(
      req.user.companyId,
    );
  }

  @ApiOperation({
    summary: 'Rename a cost item (propagates to every employee)',
  })
  @ApiParam({ name: 'id', description: 'UUID of the cost item' })
  @ApiResponse({ status: 200, description: 'The cost item has been updated' })
  @ApiResponse({ status: 404, description: 'Cost item not found' })
  @ApiResponse({ status: 409, description: 'Another cost item has this name' })
  @Patch(':id')
  update(
    @Req() req,
    @Param('id') id: string,
    @Body() updatePayrollTemplateDto: UpdatePayrollTemplateDto,
  ) {
    return this.salaryTemplatesService.updateTemplate(
      req.user.companyId,
      id,
      updatePayrollTemplateDto,
    );
  }

  @ApiOperation({
    summary: 'Delete a cost item when no employee is linked to it anymore',
  })
  @ApiParam({ name: 'id', description: 'UUID of the cost item' })
  @ApiResponse({ status: 200, description: 'The cost item has been deleted' })
  @ApiResponse({ status: 404, description: 'Cost item not found' })
  @ApiResponse({
    status: 409,
    description: 'The cost item is still linked to employees',
  })
  @Delete(':id')
  remove(@Req() req, @Param('id') id: string) {
    return this.salaryTemplatesService.removeTemplate(req.user.companyId, id);
  }
}
