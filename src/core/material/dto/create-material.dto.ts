import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { MaterialShape, MaterialUnit } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Configuração avançada (MT-10.1): as medidas que as fórmulas, o
 * aproveitamento e o plano de corte leem. Medidas em milímetros; peso em
 * quilos por unidade de venda do material.
 */
export class MaterialAdvancedDto {
  @IsEnum(MaterialShape, {
    message: 'Formato inválido: use PROFILE, SHEET ou OTHER.',
  })
  @ApiProperty({ enum: MaterialShape })
  shape: MaterialShape;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Perfil: lado X, em mm', required: false })
  x?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Perfil: lado Y, em mm', required: false })
  y?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Perfil: comprimento da barra, em mm',
    required: false,
  })
  barLength?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Chapa: largura, em mm', required: false })
  width?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Chapa: altura, em mm', required: false })
  height?: number | null;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description:
      'Chapa: cobrar a folha inteira (padrão) ou só a fração aproveitada',
    required: false,
  })
  wholeSheets?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Quilos por unidade de venda do material',
    required: false,
  })
  weight?: number | null;
}

export class CreateMaterialDto {
  @Transform(trim)
  @IsString({ message: 'Informe o nome do material' })
  @IsNotEmpty({ message: 'Informe o nome do material' })
  @ApiProperty({ example: 'Metalon 50 × 30' })
  name: string;

  @IsUUID(undefined, { message: 'Informe o setor do material' })
  @ApiProperty({ description: 'Setor da empresa (/sector)' })
  sectorId: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @ApiProperty({
    description: 'Texto livre; a lista agrupa por setor e subcategoria',
    example: 'Perfis',
    required: false,
  })
  subcategory?: string;

  @IsEnum(MaterialUnit, {
    message: 'Unidade inválida: use HR, M2, M, KM, UN, KG ou LT.',
  })
  @ApiProperty({ enum: MaterialUnit })
  unit: MaterialUnit;

  @IsOptional()
  @IsInt({ message: 'O custo vai em centavos, sem casas decimais.' })
  @Min(0)
  @ApiProperty({
    description:
      'Centavos por unidade. Só é aceito de quem tem values:values:view',
    example: 1850,
    required: false,
  })
  cost?: number | null;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  directSale?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: true })
  productionMaterial?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => MaterialAdvancedDto)
  @ApiProperty({ type: MaterialAdvancedDto, required: false, nullable: true })
  advanced?: MaterialAdvancedDto | null;
}
