import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { AccountResetService } from './account-reset.service';

export class ResetCompanyDataDto {
  @ApiProperty({ description: 'Senha do superadmin' })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({ description: 'O nome da empresa, digitado para confirmar' })
  @IsString()
  @MinLength(1)
  confirmation: string;

  @ApiPropertyOptional({
    description:
      'Apaga também as notas fiscais. Sem isso elas ficam, só sem o vínculo com orçamento e O.S.',
  })
  @IsOptional()
  @IsBoolean()
  includeFiscalDocuments?: boolean;

  @ApiPropertyOptional({
    description:
      'Apaga as configurações (categorias, condições, séries, contas bancárias) e recria o padrão de conta nova.',
  })
  @IsOptional()
  @IsBoolean()
  restoreDefaults?: boolean;
}

const flag = (value?: string) => value === 'true';

@ApiTags('Admin — Zerar dados da conta')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/companies')
export class AccountResetController {
  constructor(private readonly service: AccountResetService) {}

  @Get(':companyId/data-reset/preview')
  @ApiOperation({ summary: 'O que "zerar dados" apagaria e o que fica' })
  preview(
    @Param('companyId') companyId: string,
    @Query('includeFiscalDocuments') includeFiscalDocuments?: string,
    @Query('restoreDefaults') restoreDefaults?: string,
  ) {
    return this.service.preview(companyId, {
      includeFiscalDocuments: flag(includeFiscalDocuments),
      restoreDefaults: flag(restoreDefaults),
    });
  }

  @Post(':companyId/data-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Zera documentos, cadastros e lançamentos; mantém conta, usuários, assinatura e fiscal',
  })
  reset(
    @Param('companyId') companyId: string,
    @Body() dto: ResetCompanyDataDto,
    @Req() req,
  ) {
    return this.service.reset(companyId, dto, req.user.userId);
  }

  @Get(':companyId/data-resets')
  @ApiOperation({ summary: 'Execuções anteriores de "zerar dados"' })
  list(@Param('companyId') companyId: string) {
    return this.service.list(companyId);
  }

  @Get('data-resets/:resetId/backup')
  @ApiOperation({ summary: 'Cópia do que foi apagado (JSON compactado)' })
  async backup(@Param('resetId') resetId: string, @Res() res: Response) {
    const file = await this.service.backupFile(resetId);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.send(file.content);
  }
}
