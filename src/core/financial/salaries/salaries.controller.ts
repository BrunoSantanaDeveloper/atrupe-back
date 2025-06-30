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
import { CreateSalaryControlDto } from './dto/create-salary-control.dto';
import { FilterSalaryControlDto } from './dto/filter-salary-control.dto';
import { UpdateSalaryControlDto } from './dto/update-salary-control.dto';
import { DeleteFromAllResponseDto } from './dto/delete-from-all-response.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';

const RESOURCE = 'salaries';
const GROUP = 'financial';

@ApiTags('Configurações de salários')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class SalariesController {
  constructor(private readonly salariesService: SalariesService) {}

  @ApiOperation({ summary: 'Get all salary controls with filters' })
  @ApiResponse({
    status: 200,
    description:
      'Returns a list of salary controls matching the filter criteria',
  })
  @Get()
  async findAll(@Req() req, @Query() filters: FilterSalaryControlDto) {
    filters.companyId = req.user.companyId;
    return await this.salariesService.findAll(filters);
  }

  @ApiOperation({ summary: 'Get salary details by ID' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the salary control',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the salary control details',
  })
  @ApiResponse({ status: 404, description: 'Salary control not found' })
  @Get(':id')
  getSalaryDetails(@Param('id') id: string) {
    return this.salariesService.getSalaryDetails(id);
  }

  @ApiOperation({ summary: 'Create a new salary control for all employees' })
  @ApiResponse({
    status: 201,
    description:
      'The salary control has been successfully created for all employees',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @Post()
  create(@Req() req, @Body() createSalaryControlDto: CreateSalaryControlDto) {
    createSalaryControlDto.companyId = req.user.companyId;
    return this.salariesService.create(createSalaryControlDto);
  }

  @ApiOperation({ summary: 'Update salary amount' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the salary control to update',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'The salary amount has been successfully updated',
  })
  @ApiResponse({ status: 404, description: 'Salary control not found' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateSalaryControlDto: UpdateSalaryControlDto,
  ) {
    return this.salariesService.update(id, updateSalaryControlDto);
  }

  @ApiOperation({ summary: 'Delete a salary control' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the salary control to delete',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'The salary control has been successfully deleted',
  })
  @ApiResponse({ status: 404, description: 'Salary control not found' })
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.salariesService.delete(id);
  }

  @ApiOperation({ summary: 'Delete a salary control from all employees' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the salary control to delete from all employees',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description:
      'The salary control has been successfully deleted from all employees',
    type: DeleteFromAllResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Salary control not found' })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or item does not belong to your company',
  })
  @Delete(':id/all')
  deleteFromAllEmployees(@Param('id') id: string, @Req() req) {
    return this.salariesService.deleteFromAllEmployees(id, req.user.companyId);
  }
}
