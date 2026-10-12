import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Linhas por envio da importação de lista. */
export const IMPORT_MAX_ROWS = 500;
const TOO_MANY = 'A lista tem mais de 500 linhas; divida em partes';

/** A linha como a planilha traz: a tela lê o arquivo e manda o texto. */
export class ImportRowDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'Metalon 50x30' })
  name?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'ml' })
  unit?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, example: 'Serralheria' })
  sector?: string;

  @IsOptional()
  @IsInt({ message: 'O custo vai em centavos, sem casas decimais.' })
  @Min(0)
  @ApiProperty({ required: false, nullable: true, example: 1900 })
  cost?: number | null;
}

export class ImportPreviewDto {
  @IsArray()
  @ArrayMaxSize(IMPORT_MAX_ROWS, { message: TOO_MANY })
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  @ApiProperty({ type: [ImportRowDto] })
  rows: ImportRowDto[];
}

/** A linha já conciliada: `materialId` é a decisão da pessoa; nulo cadastra. */
export class ImportDecidedRowDto extends ImportRowDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false, nullable: true })
  materialId?: string | null;
}

export class ImportMaterialsDto {
  @IsArray()
  @ArrayMaxSize(IMPORT_MAX_ROWS, { message: TOO_MANY })
  @ValidateNested({ each: true })
  @Type(() => ImportDecidedRowDto)
  @ApiProperty({ type: [ImportDecidedRowDto] })
  rows: ImportDecidedRowDto[];
}
