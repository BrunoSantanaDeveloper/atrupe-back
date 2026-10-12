import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { SectorNature, SectorSaleUnit } from '@prisma/client';
import {
  SECTOR_COLOR_MESSAGE,
  SECTOR_COLOR_PATTERN,
  normalizeSectorColor,
} from './create-sector.dto';

export class UpdateSectorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsBoolean()
  isProductionStage?: boolean;

  @ApiProperty({
    description: 'Indica se o setor está ativo',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(SectorSaleUnit)
  @ApiProperty({
    description:
      'Como o setor vende: por hora ou pela unidade do equipamento (a composição lê)',
    enum: SectorSaleUnit,
    required: false,
  })
  saleUnit?: SectorSaleUnit;

  @IsOptional()
  @Transform(normalizeSectorColor)
  @Matches(SECTOR_COLOR_PATTERN, { message: SECTOR_COLOR_MESSAGE })
  @ApiProperty({
    description:
      'Cor do setor (#RRGGBB). Nulo volta ao padrão do ícone, que a tela resolve',
    example: '#1D4ED8',
    nullable: true,
    required: false,
  })
  color?: string | null;

  // O critério do rateio não entra aqui: muda só pela base de custos
  // (PUT /cost-base/sector/:id/allocation)
  @IsOptional()
  @IsEnum(SectorNature)
  @ApiProperty({
    description: 'Natureza do setor na base de custos',
    enum: SectorNature,
    required: false,
  })
  nature?: SectorNature;

  // Custo e venda da hora: a composição custeia a mão de obra e o preparo
  // por eles. Informados até a base de custos calcular (módulo 4); só
  // quem vê valores lê e grava
  @IsOptional()
  @IsInt({ message: 'O custo da hora vai em centavos' })
  @Min(0, { message: 'O custo da hora não pode ser negativo' })
  @ApiProperty({
    description: 'Custo da hora de mão de obra do setor, em centavos',
    example: 4500,
    nullable: true,
    required: false,
  })
  hourCost?: number | null;

  @IsOptional()
  @IsInt({ message: 'A hora vendida vai em centavos' })
  @Min(0, { message: 'A hora vendida não pode ser negativa' })
  @ApiProperty({
    description: 'A hora vendida do setor, em centavos (IP-25)',
    example: 12000,
    nullable: true,
    required: false,
  })
  hourSale?: number | null;
}
