import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContactChannel, ContactOutcome } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Registrar contato (CRM-1, 27/10/2026): um gesto só grava o contato e, no
 * mesmo corpo, o próximo contato, o lembrete e o marcador do orçamento.
 */
export class RegisterContactDto {
  @ApiPropertyOptional({ enum: ContactChannel, default: 'WHATSAPP' })
  @IsOptional()
  @IsEnum(ContactChannel)
  channel?: ContactChannel;

  @ApiProperty({ enum: ContactOutcome })
  @IsEnum(ContactOutcome)
  outcome: ContactOutcome;

  @ApiPropertyOptional({ description: 'Observação livre do contato' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ description: 'Quando aconteceu; padrão agora' })
  @IsOptional()
  @IsISO8601()
  at?: string;

  // Próximo contato: ausente = não mexe; null = limpa
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.nextContactAt !== null)
  @IsISO8601()
  nextContactAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.nextContactNote !== null)
  @IsString()
  @MaxLength(500)
  nextContactNote?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Marcador do orçamento' })
  @IsOptional()
  @ValidateIf((o) => o.tagId !== null)
  @IsUUID('4')
  tagId?: string | null;
}

/** Configuração do acompanhamento (CRM-3, CRM-5): o objeto inteiro. */
export class FollowUpSettingsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.templateProposalSent !== null)
  @IsString()
  @MaxLength(2000)
  templateProposalSent?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.templateValidity !== null)
  @IsString()
  @MaxLength(2000)
  templateValidity?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.templateResume !== null)
  @IsString()
  @MaxLength(2000)
  templateResume?: string | null;

  @ApiProperty()
  @IsBoolean()
  dailyEmail: boolean;

  @ApiProperty({ minimum: 0, maximum: 23 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  dailyEmailHour: number;

  @ApiProperty({ minimum: 7, maximum: 730 })
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(730)
  inactiveDays: number;
}
