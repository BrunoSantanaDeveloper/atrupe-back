import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Put,
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
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import {
  AttachmentDto,
  CurrentVersionDto,
  PendencyDto,
  ReleaseNextDto,
  TaskActionDto,
  TaskScheduleDto,
  TimeEntryDto,
  UpdateTaskDto,
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
@RequiresFeature('production_manager')
@Controller('production/task')
export class ProductionTaskController {
  constructor(
    private readonly access: ProductionAccessService,
    private readonly tasks: ProductionTaskService,
  ) {}

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
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Agenda ou tira da agenda (GP-35)' })
  async schedule(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: TaskScheduleDto,
  ) {
    return this.tasks.schedule(await this.access.viewer(req.user), id, dto);
  }

  @Patch(':id')
  @HasPermission('view', PRODUCTION)
  @ApiOperation({ summary: 'Quem faz, veículo e km' })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(await this.access.viewer(req.user), id, dto);
  }

  @Post(':id/work/start')
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
