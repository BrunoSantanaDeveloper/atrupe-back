import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from 'nestjs-prisma';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { ObservePermissions } from '../../auth/abac/observe-permissions.decorator';
import { ValuesOnly } from '../../auth/abac/money-fields.decorator';
import { FeatureGuard } from '../../plan/guards/feature.guard';
import { RequiresFeature } from '../../plan/decorators/requires-feature.decorator';
import { actorOfUser } from '../cash-control/cash-ledger';
import { ConciliationService } from './conciliation.service';
import {
  ConciliationCreateDto,
  ConciliationFilterDto,
  ConciliationImportDto,
  ConciliationLiquidateDto,
  ConciliationMatchDto,
} from './dto/conciliation.dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * A conciliação com o extrato (CX-6, LITE): do controle de caixa. Tudo é
 * valor: sem a permissão de valores a rota é recusada (observando).
 */
@ApiTags('Conciliação')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionsGuard)
@RequiresFeature('cash_control')
@ApiBearerAuth()
// Rotas novas: a permissão já recusa
@ObservePermissions(false)
@ValuesOnly()
@Controller('financial/conciliation')
export class ConciliationController {
  constructor(
    private readonly conciliation: ConciliationService,
    private readonly prisma: PrismaService,
  ) {}

  private actor(req) {
    return actorOfUser(this.prisma, req.user);
  }

  @Get()
  @HasPermission('view', 'financial:cash_control')
  @ApiOperation({
    summary: 'As linhas do extrato e o que o sistema tem sem casar',
  })
  list(@Req() req, @Query() filter: ConciliationFilterDto) {
    return this.conciliation.list(req.user.companyId, filter);
  }

  @Post('import')
  @HasPermission('edit', 'financial:cash_control')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        bankAccountId: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Importa o OFX e casa sozinho (CX-6)' })
  async import(
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ConciliationImportDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Escolha o arquivo OFX do extrato');
    }
    // O OFX 1.x costuma vir em Latin-1; o 2.x, em UTF-8
    const raw = file.buffer.toString('utf8');
    const content = raw.includes(String.fromCharCode(0xfffd))
      ? file.buffer.toString('latin1')
      : raw;
    return this.conciliation.importOfx(
      req.user.companyId,
      dto.bankAccountId,
      content,
      file.originalname ?? null,
      await this.actor(req),
    );
  }

  @Post('line/:id/confirm')
  @HasPermission('edit', 'financial:cash_control')
  @ApiOperation({ summary: 'Confirma a sugestão de casamento' })
  async confirm(@Req() req, @Param('id', UUID) id: string) {
    return this.conciliation.confirm(
      req.user.companyId,
      id,
      await this.actor(req),
    );
  }

  @Post('line/:id/match')
  @HasPermission('edit', 'financial:cash_control')
  @ApiOperation({ summary: 'Casa a linha com um lançamento à mão' })
  async match(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: ConciliationMatchDto,
  ) {
    return this.conciliation.match(
      req.user.companyId,
      id,
      dto,
      await this.actor(req),
    );
  }

  @Post('line/:id/unmatch')
  @HasPermission('edit', 'financial:cash_control')
  @ApiOperation({ summary: 'Desfaz o casamento' })
  unmatch(@Req() req, @Param('id', UUID) id: string) {
    return this.conciliation.unmatch(req.user.companyId, id);
  }

  @Post('line/:id/ignore')
  @HasPermission('edit', 'financial:cash_control')
  @ApiOperation({ summary: 'Ignora a linha que não é lançamento' })
  async ignore(@Req() req, @Param('id', UUID) id: string) {
    return this.conciliation.ignore(
      req.user.companyId,
      id,
      await this.actor(req),
    );
  }

  @Post('line/:id/create')
  @HasPermission('edit', 'financial:cash_control')
  @ApiOperation({ summary: 'Lança a linha que só está no extrato (CX-6.6)' })
  async create(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: ConciliationCreateDto,
  ) {
    return this.conciliation.create(
      req.user.companyId,
      id,
      dto,
      await this.actor(req),
    );
  }

  @Post('line/:id/liquidate')
  @HasPermission('edit', 'financial:cash_control')
  @ApiOperation({ summary: 'Liquida o cartão pelo depósito (CX-6.7)' })
  async liquidate(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: ConciliationLiquidateDto,
  ) {
    return this.conciliation.liquidate(
      req.user.companyId,
      id,
      dto,
      await this.actor(req),
    );
  }
}
