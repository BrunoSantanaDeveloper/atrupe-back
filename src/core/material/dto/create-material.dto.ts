import {
  Allow,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { MaterialShape, MaterialUnit, SheetFormat } from '@prisma/client';

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

  // Obrigatório na tela completa (o service confere); no papel do LITE,
  // vazio vale o primeiro setor ativo da empresa
  @IsOptional()
  @IsUUID(undefined, { message: 'Informe o setor do material' })
  @ApiProperty({ description: 'Setor da empresa (/sector)' })
  sectorId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @ApiProperty({
    description: 'Texto livre; a lista agrupa por setor e subcategoria',
    example: 'Perfis',
    required: false,
  })
  subcategory?: string;

  // Obrigatória na tela completa (o service confere); o papel é por folha (UN)
  @IsOptional()
  @IsEnum(MaterialUnit, {
    message: 'Unidade inválida: use HR, M2, M, KM, UN, KG ou LT.',
  })
  @ApiProperty({ enum: MaterialUnit })
  unit?: MaterialUnit;

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

  // Não entra por aqui: o preço tem rota própria (PATCH /material/:id/price)
  // e o papel do LITE não tem preço. Declarado só para a recusa dizer o porquê
  @IsOptional()
  @Allow()
  @ApiProperty({
    description:
      'Sempre recusado: o preço tem rota própria, e o papel do LITE não tem preço',
    required: false,
  })
  price?: unknown;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    required: false,
    default: true,
    description: 'Inativar ou reativar, como o toggle-status',
  })
  active?: boolean;

  // O papel (forma SHEET; Papéis no LITE, 13/10/2026). Medidas em mm
  @IsOptional()
  @IsInt({ message: 'A gramatura vai em g/m², número inteiro.' })
  @Min(1, { message: 'A gramatura vai em g/m², maior que zero.' })
  @ApiProperty({ description: 'Papel: g/m²', example: 300, required: false })
  grammage?: number | null;

  @IsOptional()
  @IsEnum(SheetFormat, {
    message: 'Formato da folha inválido: use A4, A3, SRA3, A3_PLUS ou CUSTOM.',
  })
  @ApiProperty({
    enum: SheetFormat,
    required: false,
    description:
      'Papel: o padrão preenche a folha (A4 210 × 297, A3 297 × 420, SRA3 320 × 450, A3+ 329 × 483 mm); CUSTOM exige largura e altura',
  })
  sheetFormat?: SheetFormat | null;

  @IsOptional()
  @IsNumber({}, { message: 'A largura da folha vai em mm.' })
  @IsPositive({ message: 'A largura da folha vai em mm, maior que zero.' })
  @ApiProperty({
    description:
      'Papel: largura da folha, em mm (a mesma coluna de advanced.width)',
    required: false,
  })
  sheetWidth?: number | null;

  @IsOptional()
  @IsNumber({}, { message: 'A altura da folha vai em mm.' })
  @IsPositive({ message: 'A altura da folha vai em mm, maior que zero.' })
  @ApiProperty({
    description:
      'Papel: altura da folha, em mm (a mesma coluna de advanced.height)',
    required: false,
  })
  sheetHeight?: number | null;

  @IsOptional()
  @IsNumber({}, { message: 'A largura da área útil vai em mm.' })
  @IsPositive({ message: 'A largura da área útil vai em mm, maior que zero.' })
  @ApiProperty({
    description: 'Papel: área útil, em mm; vazia = a folha inteira',
    required: false,
  })
  usableWidth?: number | null;

  @IsOptional()
  @IsNumber({}, { message: 'A altura da área útil vai em mm.' })
  @IsPositive({ message: 'A altura da área útil vai em mm, maior que zero.' })
  @ApiProperty({
    description: 'Papel: área útil, em mm; vazia = a folha inteira',
    required: false,
  })
  usableHeight?: number | null;

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
