import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AcademyService } from './academy.service';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { AcademyResponseDto } from './dto/academy-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

const RESOURCE = 'academy';

@ApiTags('Academy')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class AcademyController {
  constructor(private readonly academyService: AcademyService) {}

  @Get(':plan')
  @ApiOperation({
    summary: 'Obtém dados da Academy por plano',
    description:
      'Retorna a estrutura completa da Academy com progresso do usuário para um plano específico',
  })
  @ApiParam({
    name: 'plan',
    required: true,
    description: 'Tipo do plano (start, lite, pro, elite, full)',
    example: 'start',
  })
  @ApiResponse({
    status: 200,
    description: 'Dados da Academy retornados com sucesso',
    type: AcademyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Plano inválido',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado - plano superior ao contratado',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa sem plano ativo',
  })
  async getAcademyByPlan(@Param('plan') plan: string, @Req() req) {
    try {
      const { userId, companyId } = req.user;
      return await this.academyService.getAcademyByPlan(
        plan,
        userId,
        companyId,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof ForbiddenException) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof NotFoundException) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Post(':plan/progress')
  @ApiOperation({
    summary: 'Atualiza progresso do usuário na Academy',
    description: 'Marca ou desmarca um item da Academy como concluído',
  })
  @ApiParam({
    name: 'plan',
    required: true,
    description: 'Tipo do plano (start, lite, pro, elite, full)',
    example: 'start',
  })
  @ApiBody({
    description: 'Dados para atualização do progresso',
    type: UpdateProgressDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Progresso atualizado com sucesso',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Item marcado como concluído' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou erro na atualização',
  })
  @ApiResponse({
    status: 404,
    description: 'Item não encontrado no plano especificado',
  })
  async updateProgress(
    @Param('plan') plan: string,
    @Body() updateProgressDto: UpdateProgressDto,
    @Req() req,
  ) {
    try {
      const { userId, companyId } = req.user;
      return await this.academyService.updateProgress(
        userId,
        companyId,
        plan,
        updateProgressDto,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof NotFoundException) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Get(':plan/progress')
  @ApiOperation({
    summary: 'Obtém apenas o progresso do usuário para um plano',
    description:
      'Retorna uma versão simplificada com apenas os itens marcados como concluídos',
  })
  @ApiParam({
    name: 'plan',
    required: true,
    description: 'Tipo do plano (start, lite, pro, elite, full)',
    example: 'start',
  })
  @ApiResponse({
    status: 200,
    description: 'Progresso do usuário retornado com sucesso',
    schema: {
      type: 'object',
      properties: {
        plan: { type: 'string', example: 'start' },
        completedItems: {
          type: 'array',
          items: { type: 'string' },
          example: ['cadastro-empresa', 'configuracao-setores'],
        },
        totalItems: { type: 'number', example: 10 },
        completionPercentage: { type: 'number', example: 20 },
      },
    },
  })
  async getProgressSummary(@Param('plan') plan: string, @Req() req) {
    try {
      const { userId, companyId } = req.user;
      const academyData = await this.academyService.getAcademyByPlan(
        plan,
        userId,
        companyId,
      );

      const allItems = academyData.sections.flatMap((section) => section.items);
      const completedItems = allItems
        .filter((item) => item.checked)
        .map((item) => item.id);
      const totalItems = allItems.length;
      const completionPercentage =
        totalItems > 0
          ? Math.round((completedItems.length / totalItems) * 100)
          : 0;

      return {
        plan: academyData.plan,
        completedItems,
        totalItems,
        completionPercentage,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof ForbiddenException) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof NotFoundException) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
