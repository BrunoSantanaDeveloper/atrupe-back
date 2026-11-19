import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from 'nestjs-prisma';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import {
  CreateReleaseNoteDto,
  PublishReleaseNoteDto,
  SeenReleaseNotesDto,
  UpdateReleaseNoteDto,
} from './dto/release-note.dto';
import { ReleaseNotesService, ReleaseReader } from './release-notes.service';

const readerOf = (req: any): ReleaseReader => ({
  userId: req.user.userId,
  companyId: req.user.companyId,
  isSystemAdmin: !!req.user.isSystemAdmin,
});

/**
 * As novidades do sistema (19/11/2026). O cliente lê (sino, aviso do painel
 * e página Novidades); o Super Admin escreve e publica (/admin/sistema/novidades).
 */
@ApiTags('Novidades')
@ApiBearerAuth()
@Controller('release-notes')
@UseGuards(JwtAuthGuard)
export class ReleaseNotesController {
  constructor(
    private readonly releaseNotes: ReleaseNotesService,
    private readonly prisma: PrismaService,
  ) {}

  // --- Super Admin (antes das rotas com :id) ---

  @Get('admin')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Todas as novidades, com os rascunhos' })
  adminList() {
    return this.releaseNotes.adminList();
  }

  @Post('admin')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Nova novidade (nasce rascunho)' })
  async create(@Req() req, @Body() dto: CreateReleaseNoteDto) {
    const author = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true },
    });
    return this.releaseNotes.create(dto, author?.name);
  }

  @Patch('admin/:id')
  @UseGuards(SystemAdminGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReleaseNoteDto,
  ) {
    return this.releaseNotes.update(id, dto);
  }

  @Post('admin/:id/publish')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Publica agora ou na data indicada' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishReleaseNoteDto,
  ) {
    return this.releaseNotes.publish(id, dto);
  }

  @Post('admin/:id/unpublish')
  @UseGuards(SystemAdminGuard)
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.releaseNotes.unpublish(id);
  }

  @Delete('admin/:id')
  @UseGuards(SystemAdminGuard)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.releaseNotes.remove(id);
  }

  // --- Cliente ---

  @Get()
  @ApiOperation({ summary: 'As novidades do plano da empresa' })
  list(@Req() req) {
    return this.releaseNotes.list(readerOf(req));
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Quantas não vistas e a atualização que o painel anuncia',
  })
  summary(@Req() req) {
    return this.releaseNotes.summary(readerOf(req));
  }

  @Post('seen')
  @ApiOperation({ summary: 'Marca como vistas (as indicadas ou todas)' })
  seen(@Req() req, @Body() dto: SeenReleaseNotesDto) {
    return this.releaseNotes.markSeen(readerOf(req), dto.ids);
  }

  @Post(':id/announced')
  @ApiOperation({ summary: 'O aviso do painel foi mostrado' })
  announced(@Req() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.releaseNotes.markAnnounced(readerOf(req), id);
  }
}
