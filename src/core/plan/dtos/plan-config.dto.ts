import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

/** O que vale para toda alteração que pode atingir assinaturas. */
class GuardedChangeDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiProperty({
    description:
      'Quantas assinaturas a tela mostrou como atingidas. Se o servidor contar outro número, a alteração é recusada (409) e a prévia volta atualizada.',
    required: false,
  })
  expectedAffected?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @ApiProperty({
    description:
      'Senha gerencial do superadmin. Obrigatória só quando a alteração atinge assinaturas.',
    required: false,
  })
  password?: string;

  @IsOptional()
  @IsIn(['PANEL', 'REVERT'])
  @ApiProperty({ required: false, enum: ['PANEL', 'REVERT'] })
  source?: 'PANEL' | 'REVERT';

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'Registro do histórico que está sendo revertido',
    required: false,
  })
  revertOf?: string;
}

export class PlanFeaturePreviewQueryDto {
  @IsUUID()
  @ApiProperty({ description: 'ID do plano' })
  planId: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Chave do recurso', example: 'cash_control' })
  featureKey: string;

  @Transform(toBoolean)
  @IsBoolean()
  @ApiProperty({ description: 'true para incluir, false para retirar' })
  enabled: boolean;
}

export class SetPlanFeatureDto extends GuardedChangeDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Chave do recurso', example: 'cash_control' })
  featureKey: string;

  @IsBoolean()
  @ApiProperty({ description: 'true para incluir, false para retirar' })
  enabled: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description:
      'Ao retirar: true mantém o recurso nas assinaturas atuais do plano (só as novas contratações ficam sem); false retira de todas. Obrigatório quando o plano tem assinaturas.',
    required: false,
  })
  keepCurrentSubscriptions?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description:
      'Aplica junto as dependências (ligar o que o recurso exige, ou desligar o que depende dele).',
    required: false,
  })
  cascade?: boolean;
}

export class SetPlanLimitDto extends GuardedChangeDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Chave do limite', example: 'max_users' })
  limitKey: string;

  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(100000)
  @ApiProperty({ description: 'Novo valor; -1 = ilimitado' })
  value: number;
}

export class RestorePlanDefaultsDto extends GuardedChangeDto {
  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description:
      'Se o padrão retira recursos: true mantém nas assinaturas atuais; false retira de todas.',
    required: false,
  })
  keepCurrentSubscriptions?: boolean;
}

export class PlanConfigHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsOptional()
  @IsString()
  featureKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SetCompanyFeatureDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Chave do recurso', example: 'cash_control' })
  featureKey: string;

  @IsBoolean()
  @ApiProperty({
    description: 'true concede a cortesia; false retira o recurso concedido',
  })
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @ApiProperty({
    description: 'Motivo da cortesia (obrigatório ao conceder)',
    required: false,
  })
  reason?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Validade da cortesia (AAAA-MM-DD); vazio = sem prazo',
    required: false,
  })
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @ApiProperty({
    description: 'Senha gerencial (obrigatória com assinatura ativa)',
    required: false,
  })
  password?: string;
}
