import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { MigrationService } from './migration.service';

export class StartMigrationDto {
  @IsString()
  companyId: string;

  @IsString()
  @Matches(/^acn_\d+$/, {
    message: 'Nome de base inválido. Esperado o formato acn_000000.',
  })
  legacyBase: string;

  /** Simulação não grava nada; é o passo obrigatório antes da carga. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /**
   * Conta criada só para receber a migração e nunca usada pelo cliente: o
   * financeiro entra inteiro, sem o corte na data em que a conta começou a ser
   * usada.
   */
  @IsOptional()
  @IsBoolean()
  fullHistory?: boolean;
}

/**
 * Migração de clientes do sistema legado, operada pelo suporte.
 *
 * Existe para que a migração não dependa de alguém com acesso ao servidor: o
 * suporte procura o cliente pelo CNPJ, roda a simulação, confere o relatório e
 * só então grava.
 */
@ApiTags('Admin — Migração')
@Controller('admin/migration')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  @Get('bases')
  @ApiOperation({
    summary:
      'Procura no legado a base do cliente pelo CNPJ, com a conta correspondente',
  })
  async bases(@Query('cnpj') cnpj?: string) {
    return this.migrationService.findLegacyBases(cnpj);
  }

  @Post('runs')
  @ApiOperation({ summary: 'Dispara uma migração (simulação ou carga)' })
  async start(@Body() dto: StartMigrationDto, @Req() req: any) {
    return this.migrationService.start({
      companyId: dto.companyId,
      legacyBase: dto.legacyBase,
      // A simulação é o padrão: gravar precisa ser escolha explícita.
      dryRun: dto.dryRun ?? true,
      startedById: req.user.userId,
      fullHistory: dto.fullHistory ?? false,
    });
  }

  @Get('runs')
  @ApiOperation({ summary: 'Histórico de execuções' })
  async list(@Query('limit') limit?: string) {
    return this.migrationService.list(limit ? Number(limit) : undefined);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Andamento e relatório de uma execução' })
  async findOne(@Param('id') id: string) {
    return this.migrationService.findOne(id);
  }
}
