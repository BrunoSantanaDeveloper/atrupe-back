import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { SectorNature, SectorSaleUnit } from '@prisma/client';
import { PRODUCTIONS } from '../productions';

export const SECTOR_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const SECTOR_COLOR_MESSAGE = 'Cor inválida: use o formato #RRGGBB.';

/**
 * A cor é gravada em maiúsculas. Vazio vale como "sem cor": o setor volta ao
 * padrão do ícone, que a tela resolve.
 */
export const normalizeSectorColor = ({ value }: { value: unknown }) => {
  if (value === '') return null;
  return typeof value === 'string' ? value.toUpperCase() : value;
};

export class CreateSectorDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do setor',
    example: 'Tecnologia',
    required: true,
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Ícone representativo do setor',
    example: 'tech-icon.png',
    required: true,
  })
  icon: string;

  @IsOptional()
  @IsEnum(SectorSaleUnit)
  @ApiProperty({
    description:
      'Como o setor vende: por hora ou pela unidade do equipamento (a composição lê)',
    enum: SectorSaleUnit,
    default: SectorSaleUnit.HOUR,
    required: false,
  })
  saleUnit?: SectorSaleUnit;

  @IsOptional()
  @Transform(normalizeSectorColor)
  @Matches(SECTOR_COLOR_PATTERN, { message: SECTOR_COLOR_MESSAGE })
  @ApiProperty({
    description: 'Cor do setor (#RRGGBB). Sem cor, vale o padrão do ícone',
    example: '#2563EB',
    nullable: true,
    required: false,
  })
  color?: string | null;

  @IsOptional()
  @IsEnum(SectorNature)
  @ApiProperty({
    description: 'Natureza do setor na base de custos',
    enum: SectorNature,
    default: SectorNature.PRODUCTIVE,
    required: false,
  })
  nature?: SectorNature;

  // O que o setor produz (PS-1; Maicol, 23/11/2026): as produções da lista
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCTIONS.length)
  @IsIn(PRODUCTIONS, { each: true, message: 'Produção desconhecida' })
  @ApiProperty({
    description: 'O que o setor produz (impressao_solvente, serralheria…)',
    type: [String],
    required: false,
  })
  productions?: string[];

  companyId: string;
}
