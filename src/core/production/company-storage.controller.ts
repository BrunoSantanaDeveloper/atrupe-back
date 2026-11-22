import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CleanupAutoDto, CleanupDto } from './dto/production-task.dto';
import { ProductionAccessService } from './production-access.service';
import { CompanyStorageService } from './storage/company-storage.service';
import { ProductionCleanupService } from './storage/production-cleanup.service';

/**
 * O armazenamento da empresa (GP-49), em todos os planos e só para o
 * administrador: o espaço, o que ocupa e a limpeza. As rotas da limpeza na
 * produção continuam para quem já as usa.
 */
@ApiTags('Armazenamento')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('company/storage')
export class CompanyStorageController {
  constructor(
    private readonly overviewService: CompanyStorageService,
    private readonly cleanup: ProductionCleanupService,
    private readonly access: ProductionAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'O espaço usado, o que ocupa e a limpeza' })
  overview(@Req() req) {
    this.cleanup.assertAdmin(req.user);
    return this.overviewService.overview(req.user.companyId);
  }

  @Get('cleanup')
  @ApiOperation({ summary: 'A prévia da limpeza, sem apagar' })
  preview(@Req() req, @Query('percent') percent?: string) {
    this.cleanup.assertAdmin(req.user);
    const value = Math.min(Math.max(Math.round(Number(percent) || 50), 1), 100);
    return this.cleanup.preview(req.user.companyId, value);
  }

  @Post('cleanup')
  @ApiOperation({
    summary: 'Apaga os arquivos mais antigos das O.S. concluídas',
  })
  async run(@Req() req, @Body() dto: CleanupDto) {
    this.cleanup.assertAdmin(req.user);
    if (dto.confirm?.trim().toUpperCase() !== 'APAGAR') {
      throw new BadRequestException('Digite APAGAR para confirmar');
    }
    const viewer = await this.access.viewer(req.user);
    return this.cleanup.run(
      { companyId: viewer.companyId, userId: viewer.userId, name: viewer.name },
      dto.percent,
    );
  }

  @Put('cleanup/auto')
  @ApiOperation({ summary: 'Liga ou desliga a limpeza automática' })
  saveAuto(@Req() req, @Body() dto: CleanupAutoDto) {
    this.cleanup.assertAdmin(req.user);
    return this.cleanup.saveAuto(req.user.companyId, dto);
  }
}
