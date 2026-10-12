import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SalariesService } from './salaries.service';
import { CreatePayrollSetupDto } from './dto/create-payroll-setup.dto';
import { FilterPayrollSetupDto } from './dto/filter-payroll-setup.dto';
import { UpdatePayrollSetupDto } from './dto/update-payroll-setup.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';

const RESOURCE = 'payroll-setup';
const GROUP = 'financial';

/**
 * Configurações > Financeiro > Folha de pagamento. Os valores são salários:
 * sem permissão, qualquer usuário logado lia os de todos os colaboradores.
 * A tela real só tem trava na página (ver a folha e ver valores) e libera
 * criar e editar a quem vê; exigir edit aqui recusaria quem a tela
 * autoriza. Fica view em todas as rotas até a tela ganhar as travas por
 * ação.
 */
export const PAYROLL_SETTINGS_PERMISSION = 'financial_settings:payroll';

@ApiTags('Configurações de Folha de Pagamento')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class SalariesController {
  constructor(private readonly salariesService: SalariesService) {}

  @ApiOperation({ summary: 'Get all payroll setups with filters' })
  @ApiResponse({
    status: 200,
    description:
      'Returns a list of payroll setups matching the filter criteria',
  })
  @Get()
  @HasPermission('view', PAYROLL_SETTINGS_PERMISSION)
  async findAll(@Req() req, @Query() filters: FilterPayrollSetupDto) {
    filters.companyId = req.user.companyId;
    return await this.salariesService.findAll(filters);
  }

  @ApiOperation({ summary: 'Get salary details by ID' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the payroll setup',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the payroll setup details',
  })
  @ApiResponse({ status: 404, description: 'Payroll setup not found' })
  @Get(':id')
  @HasPermission('view', PAYROLL_SETTINGS_PERMISSION)
  getSalaryDetails(@Req() req, @Param('id') id: string) {
    return this.salariesService.getSalaryDetails(id, req.user.companyId);
  }

  @ApiOperation({ summary: 'Create a new payroll setup for all employees' })
  @ApiResponse({
    status: 201,
    description:
      'The payroll setup has been successfully created for all employees',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @Post()
  @HasPermission('view', PAYROLL_SETTINGS_PERMISSION)
  create(@Req() req, @Body() createPayrollSetupDto: CreatePayrollSetupDto) {
    createPayrollSetupDto.companyId = req.user.companyId;
    return this.salariesService.create(createPayrollSetupDto);
  }

  @ApiOperation({ summary: 'Update salary amount' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the payroll setup to update',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'The salary amount has been successfully updated',
  })
  @ApiResponse({ status: 404, description: 'Payroll setup not found' })
  @Patch(':id')
  @HasPermission('view', PAYROLL_SETTINGS_PERMISSION)
  update(
    @Req() req,
    @Param('id') id: string,
    @Body() updatePayrollSetupDto: UpdatePayrollSetupDto,
  ) {
    return this.salariesService.update(
      id,
      req.user.companyId,
      updatePayrollSetupDto,
    );
  }

  @ApiOperation({ summary: 'Delete a payroll setup' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the payroll setup to delete',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'The payroll setup has been successfully deleted',
  })
  @ApiResponse({ status: 404, description: 'Payroll setup not found' })
  @Delete(':id')
  @HasPermission('view', PAYROLL_SETTINGS_PERMISSION)
  delete(@Req() req, @Param('id') id: string) {
    return this.salariesService.delete(id, req.user.companyId);
  }
}
