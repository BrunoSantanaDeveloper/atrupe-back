import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import {
  AttachmentDto,
  CleanupAutoDto,
  CleanupDto,
  CurrentVersionDto,
  DirectAttachmentDto,
  DirectFileDto,
  PendencyDto,
  TaskCommentDto,
  ReleaseNextDto,
  TaskActionDto,
  TaskScheduleDto,
  TimeEntryDto,
  TaskSlotDto,
  SplitTaskDto,
  UpdateTaskDto,
  UploadLinkDto,
  WorkStartDto,
  WorkStopDto,
} from './dto/production-task.dto';
import {
  PRODUCTION,
  ProductionAccessService,
} from './production-access.service';
import {
  ATTACHMENT_MAX_BYTES,
  ProductionTaskService,
} from './production-task.service';
import { ProductionCleanupService } from './storage/production-cleanup.service';
import { StockLotService } from '../stock/purchasing/stock-lot.service';
import { TaskLotUseDto } from '../stock/purchasing/purchasing.dto';

// O teto do multer fica acima dos 20 MB: o serviço recusa com a mensagem
const attachmentUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_BYTES + 5 * 1024 * 1024, files: 1 },
});

/**
 * A tarefa no chão de fábrica (GP-28, GP-43, GP-44, GP-25). O operador age
 * com `production:production:view` sobre a tarefa que ele vê (GP-11);
 * corrigir e lançar tempo é do gerente (o serviço confere).
 */
@ApiTags('Produção')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
// Concluir, pendência, liberar a próxima e anexos valem na tela por setor do
// PRO (sector_board); agenda com hora, relógio e apontamento são do ELITE
@RequiresFeature(['production_manager', 'sector_board'])
@Controller('production/task')
export class ProductionTaskController {
  constructor(
    private readonly access: ProductionAccessService,
    private readonly tasks: ProductionTaskService,
    private readonly cleanup: ProductionCleanupService,
    private readonly lots_: StockLotService,
  ) {}

  @Get('storage')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({
    summary: 'O espaço dos arquivos de produção da empresa (GP-48 item 27)',
  })
  async storage(@Req() req) {
    return this.tasks.storageSummary(await this.access.viewer(req.user));
  }

  @Get('storage/cleanup')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({
    summary: 'A prévia da limpeza do espaço (GP-49): o que sairia, sem apagar',
  })
  async cleanupPreview(@Req() req, @Query('percent') percent?: string) {
    this.cleanup.assertAdmin(req.user);
    const viewer = await this.access.viewer(req.user);
    const value = Math.min(Math.max(Math.round(Number(percent) || 50), 1), 100);
    const [preview, history, auto] = await Promise.all([
      this.cleanup.preview(viewer.companyId, value),
      this.cleanup.history(viewer.companyId),
      this.cleanup.auto(viewer.companyId),
    ]);
    return { ...preview, history, auto };
  }

  @Post('storage/cleanup')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({
    summary:
      'Apaga os arquivos mais antigos das O.S. entregues até liberar a porcentagem (GP-49)',
  })
  async cleanupRun(@Req() req, @Body() dto: CleanupDto) {
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

  @Put('storage/cleanup/auto')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Liga ou desliga a limpeza automática (GP-49)' })
  async cleanupAuto(@Req() req, @Body() dto: CleanupAutoDto) {
    this.cleanup.assertAdmin(req.user);
    const viewer = await this.access.viewer(req.user);
    return this.cleanup.saveAuto(viewer.companyId, dto);
  }

  @Post(':id/action')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Aplica uma ação de estado (GP-28)' })
  async action(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: TaskActionDto,
  ) {
    return this.tasks.action(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/pendency')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Registra uma pendência' })
  async pendency(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: PendencyDto,
  ) {
    return this.tasks.pendency(
      await this.access.viewer(req.user),
      id,
      dto.text,
    );
  }

  // O comentário da equipe (VS-5; GP-47, item 3), no histórico da tarefa
  /**
   * Os rolos abertos no setor da tarefa, o material vendido e as baixas já
   * dadas (ES-16, FULL: chave purchasing).
   */
  @Get(':id/lots')
  @HasPermission('view', PRODUCTION)
  @RequiresFeature('purchasing')
  // O custo do lote, como na lista de Lotes: sai para quem não vê valores
  @MoneyFields('cost', 'unitCost', 'currentValue')
  @ApiOperation({ summary: 'Os lotes abertos no setor da tarefa' })
  async lots(@Req() req, @Param('id') id: string) {
    const viewer = await this.access.viewer(req.user);
    const task = await this.tasks.lotTask(viewer, id);
    return this.lots_.forTask(viewer.companyId, task);
  }

  /**
   * A baixa do impressor no rolo (ES-16): o comprimento (a largura é a do
   * rolo) ou a quantidade; vale para o estoque e fica no histórico.
   */
  @Post(':id/lot-use')
  @HasPermission('view', PRODUCTION)
  @RequiresFeature('purchasing')
  @ApiOperation({ summary: 'Dá baixa no lote pela tarefa' })
  async lotUse(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: TaskLotUseDto,
  ) {
    const viewer = await this.access.viewer(req.user);
    const task = await this.tasks.lotTask(viewer, id);
    // Quem age no estoque é o usuário (createdById), como nas outras baixas
    const { text } = await this.lots_.useForTask(viewer.companyId, task, dto, {
      id: viewer.userId,
      name: viewer.name,
    });
    return this.tasks.lotUsed(viewer, id, text);
  }

  @Post(':id/comment')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Comenta a tarefa para a equipe' })
  async comment(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: TaskCommentDto,
  ) {
    return this.tasks.comment(await this.access.viewer(req.user), id, dto.text);
  }

  @Post(':id/release-next')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Libera a próxima etapa antes de concluir (FL-13)' })
  async releaseNext(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: ReleaseNextDto,
  ) {
    return this.tasks.releaseNext(await this.access.viewer(req.user), id, dto);
  }

  @Put(':id/schedule')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Agenda ou tira da agenda (GP-35)' })
  async schedule(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: TaskScheduleDto,
  ) {
    return this.tasks.schedule(await this.access.viewer(req.user), id, dto);
  }

  // Os blocos de agenda (GP-52, ELITE): dividir em dois dias e acrescentar
  @Post(':id/slot')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Acrescenta um bloco de agenda (GP-52)' })
  async addSlot(@Req() req, @Param('id') id: string, @Body() dto: TaskSlotDto) {
    return this.tasks.addSlot(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/split')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Divide a tarefa em dois dias (GP-52)' })
  async split(@Req() req, @Param('id') id: string, @Body() dto: SplitTaskDto) {
    return this.tasks.split(await this.access.viewer(req.user), id, dto);
  }

  @Delete(':id/slot/:slotId')
  @RequiresFeature('production_manager')
  // Linha de dentro da tarefa: aceita edit (regra delete × edit)
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTION },
    { action: 'edit', resource: PRODUCTION },
  )
  @ApiOperation({ summary: 'Tira um bloco de agenda (GP-52)' })
  async removeSlot(
    @Req() req,
    @Param('id') id: string,
    @Param('slotId') slotId: string,
  ) {
    return this.tasks.removeSlot(
      await this.access.viewer(req.user),
      id,
      slotId,
    );
  }

  @Patch(':id')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Quem faz, veículo, km e prioridade' })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/work/start')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Liga o relógio de um colaborador (GP-43)' })
  async workStart(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: WorkStartDto,
  ) {
    return this.tasks.workStart(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/work/stop')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Para o relógio de um colaborador' })
  async workStop(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: WorkStopDto,
  ) {
    return this.tasks.workStop(
      await this.access.viewer(req.user),
      id,
      dto.collaboratorId,
    );
  }

  @Put(':id/time-entry/:entryId')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Corrige um trecho de tempo (GP-44)' })
  async correctEntry(
    @Req() req,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: TimeEntryDto,
  ) {
    return this.tasks.correctEntry(
      await this.access.viewer(req.user),
      id,
      entryId,
      dto,
    );
  }

  @Post(':id/time-entry')
  @RequiresFeature('production_manager')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Lança tempo à mão (GP-44)' })
  async addEntry(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: TimeEntryDto,
  ) {
    return this.tasks.addEntry(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/attachment')
  @HasPermission('view', PRODUCTION)
  @UseInterceptors(attachmentUpload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cria um anexo com a primeira versão (GP-25)' })
  async addAttachment(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: AttachmentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.tasks.addAttachment(
      await this.access.viewer(req.user),
      id,
      dto,
      file,
    );
  }

  @Post(':id/attachment/:attachmentId/version')
  @HasPermission('view', PRODUCTION)
  @UseInterceptors(attachmentUpload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sobe uma nova versão (GP-26)' })
  async addVersion(
    @Req() req,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.tasks.addVersion(
      await this.access.viewer(req.user),
      id,
      attachmentId,
      file,
    );
  }

  @Post(':id/attachment/upload-link')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({
    summary:
      'O link para o navegador enviar o arquivo direto ao armazenamento (GP-48 item 27)',
  })
  async uploadLink(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UploadLinkDto,
  ) {
    return this.tasks.uploadLink(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/attachment/direct')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({
    summary: 'Cria o anexo com o arquivo já enviado ao armazenamento',
  })
  async addAttachmentDirect(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: DirectAttachmentDto,
  ) {
    return this.tasks.addAttachmentDirect(
      await this.access.viewer(req.user),
      id,
      dto,
    );
  }

  @Post(':id/attachment/:attachmentId/version/direct')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({
    summary: 'Nova versão com o arquivo já enviado ao armazenamento',
  })
  async addVersionDirect(
    @Req() req,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: DirectFileDto,
  ) {
    return this.tasks.addVersionDirect(
      await this.access.viewer(req.user),
      id,
      attachmentId,
      dto,
    );
  }

  @Delete(':id/attachment/:attachmentId')
  // Linha de dentro da tarefa: aceita edit (regra delete × edit); o
  // operador com view apaga só o que ele enviou (o serviço confere)
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTION },
    { action: 'edit', resource: PRODUCTION },
  )
  @ApiOperation({ summary: 'Apaga o anexo e libera o espaço' })
  async deleteAttachment(
    @Req() req,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.tasks.deleteAttachment(
      await this.access.viewer(req.user),
      id,
      attachmentId,
    );
  }

  @Delete(':id/attachment/:attachmentId/version/:version')
  // Linha de dentro da tarefa: aceita edit (regra delete × edit); o
  // operador com view apaga só o que ele enviou (o serviço confere)
  @HasAnyPermission(
    { action: 'view', resource: PRODUCTION },
    { action: 'edit', resource: PRODUCTION },
  )
  @ApiOperation({ summary: 'Apaga uma versão e libera o espaço' })
  async deleteVersion(
    @Req() req,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.tasks.deleteVersion(
      await this.access.viewer(req.user),
      id,
      attachmentId,
      version,
    );
  }

  @Put(':id/attachment/:attachmentId/current')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Escolhe a versão válida (GP-26)' })
  async setCurrent(
    @Req() req,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: CurrentVersionDto,
  ) {
    return this.tasks.setCurrentVersion(
      await this.access.viewer(req.user),
      id,
      attachmentId,
      dto.version,
    );
  }
}
