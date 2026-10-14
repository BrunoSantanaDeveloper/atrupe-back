import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
} from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantResource } from '../auth/guards/tenant-resource.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FilterEmployeeDto } from './dto/filter-employee.dto';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import { EMPLOYEE_MONEY_FIELDS } from '../auth/abac/money-fields';

@ApiTags('Employees')
@UseGuards(JwtAuthGuard, PermissionsGuard, TenantGuard)
@ApiBearerAuth()
@Controller('employee')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
  @HasPermission('create', 'company_settings:users')
  @ApiOperation({ summary: 'Cria um novo colaborador' })
  @ApiBody({
    description: 'Dados do novo colaborador',
    type: CreateEmployeeDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Colaborador criado com sucesso.',
  })
  create(@Req() req, @Body() createEmployeeDto: CreateEmployeeDto) {
    createEmployeeDto.companyId = req.user.companyId;
    return this.employeeService.create(
      createEmployeeDto,
      req.user?.userId,
      undefined, // userName será buscado do relacionamento com user
    );
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os colaboradores em seus status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de colaboradores retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.employeeService.findAllQuantity(companyId);
  }

  @Get('list')
  @MoneyFields(...EMPLOYEE_MONEY_FIELDS)
  @ApiQuery({ type: FilterEmployeeDto })
  @ApiOperation({
    summary: 'Obtém a lista simples de todos os empregados sem agrupamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista simples de empregados retornada com sucesso.',
    isArray: true,
  })
  findAllFlat(@Query() filter: FilterEmployeeDto, @Req() req) {
    filter.companyId = req.user.companyId;
    return this.employeeService.findAllFlat(filter);
  }

  @Get()
  @HasPermission('view', 'company_settings:users')
  @MoneyFields(...EMPLOYEE_MONEY_FIELDS)
  @ApiQuery({ type: FilterEmployeeDto })
  @ApiOperation({ summary: 'Obtém a lista de todos os empregados' })
  @ApiResponse({
    status: 200,
    description: 'Lista de empregados retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: FilterEmployeeDto, @Req() req) {
    filter.companyId = req.user.companyId;
    return this.employeeService.findAll(filter);
  }

  @Get(':id')
  @HasPermission('view', 'company_settings:users')
  // Dados e histórico do colaborador (salário, CPF, RG): só quem vê
  // colaboradores (decisão do PO, 14/10)
  @TenantResource('employee')
  @ApiOperation({ summary: 'Obtém um colaborador pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do colaborador' })
  @ApiResponse({
    status: 200,
    description: 'Colaborador retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Colaborador não encontrado.',
  })
  findOne(@Param('id') id: string) {
    return this.employeeService.findOne(+id);
  }

  @Patch(':id')
  @TenantResource('employee')
  @HasPermission('edit', 'company_settings:users')
  @ApiOperation({ summary: 'Atualiza um colaborador pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do colaborador' })
  @ApiBody({
    description: 'Dados para atualização do colaborador',
    type: UpdateEmployeeDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Colaborador atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Colaborador não encontrado.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return await this.employeeService.update(
      id,
      updateEmployeeDto,
      req.user?.userId,
      undefined, // userName será buscado do relacionamento com user
    );
  }

  @Delete(':id')
  @TenantResource('employee')
  @HasPermission('delete', 'company_settings:users')
  @ApiOperation({ summary: 'Remove um colaborador pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do colaborador' })
  @ApiResponse({
    status: 200,
    description: 'Colaborador removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Colaborador não encontrado.',
  })
  remove(@Req() req, @Param('id') id: string) {
    return this.employeeService.remove(
      id,
      req.user?.userId,
      undefined, // userName será buscado do relacionamento com user
    );
  }

  @Get(':id/history')
  @HasPermission('view', 'company_settings:users')
  // Dados e histórico do colaborador (salário, CPF, RG): só quem vê
  // colaboradores (decisão do PO, 14/10)
  @TenantResource('employee')
  @ApiOperation({
    summary: 'Obtém o histórico de alterações de um colaborador',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do colaborador',
  })
  @ApiResponse({
    status: 200,
    description: 'Histórico do colaborador retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Colaborador não encontrado.',
  })
  getHistory(@Param('id') id: string) {
    return this.employeeService.getHistory(id);
  }
}
