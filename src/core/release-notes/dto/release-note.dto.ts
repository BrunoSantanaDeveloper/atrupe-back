import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const RELEASE_ITEM_KINDS = ['NEW', 'IMPROVEMENT', 'FIX'] as const;
export type ReleaseItemKind = (typeof RELEASE_ITEM_KINDS)[number];

/** Uma mudança da novidade: novo recurso, melhoria ou correção. */
export class ReleaseNoteItemDto {
  @ApiProperty({ enum: RELEASE_ITEM_KINDS })
  @IsIn(RELEASE_ITEM_KINDS as unknown as string[])
  kind: ReleaseItemKind;

  @ApiProperty({ example: 'O orçamento agora pede a condição de pagamento' })
  @IsString()
  @IsNotEmpty({ message: 'Escreva a mudança' })
  @MaxLength(400)
  text: string;
}

export class CreateReleaseNoteDto {
  @ApiProperty({ example: 'Orçamento mais rápido e folha refeita' })
  @IsString()
  @IsNotEmpty({ message: 'Dê um título à novidade' })
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'O que muda no Start nesta atualização' })
  @IsString()
  @IsNotEmpty({ message: 'Escreva o resumo' })
  @MaxLength(300)
  summary: string;

  @ApiPropertyOptional({ example: 'Novembro de 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  version?: string | null;

  @ApiProperty({ type: [ReleaseNoteItemDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ReleaseNoteItemDto)
  items: ReleaseNoteItemDto[];

  /** Vazio = todos os planos */
  @ApiPropertyOptional({ enum: PlanType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(PlanType, { each: true })
  plans?: PlanType[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  highlight?: boolean;
}

export class UpdateReleaseNoteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Dê um título à novidade' })
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Escreva o resumo' })
  @MaxLength(300)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  version?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ReleaseNoteItemDto)
  items?: ReleaseNoteItemDto[];

  @IsOptional()
  @IsArray()
  @IsEnum(PlanType, { each: true })
  plans?: PlanType[];

  @IsOptional()
  @IsBoolean()
  highlight?: boolean;
}

/** Publicar agora, ou numa data (a do lançamento). */
export class PublishReleaseNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}

/** Marcar como vistas no sino: as indicadas ou todas as não vistas. */
export class SeenReleaseNotesDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids?: string[];
}
