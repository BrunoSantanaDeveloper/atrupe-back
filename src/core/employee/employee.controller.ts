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

@ApiTags('Employees')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('employee')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
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
    return this.employeeService.create(createEmployeeDto);
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
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return await this.employeeService.update(id, updateEmployeeDto);
  }

  @Delete(':id')
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
  remove(@Param('id') id: string) {
    return this.employeeService.remove(id);
  }
}
