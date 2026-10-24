import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// O serviço terceirizado avulso como item do orçamento (T-6, 24/10/2026):
// só quantidade e custo unitário, sem medida; fornecedor do cadastro

const COST = 'Informe o custo do terceirizado';
const QUANTITY = 'A quantidade precisa ser um número inteiro de 1 em diante';

export class PreviewOutsourcedItemDto {
  @Type(() => Number)
  @IsInt({ message: COST })
  @Min(1, { message: COST })
  @ApiProperty({ example: 20000, description: 'Custo unitário, em centavos' })
  cost: number;
}

export class AddOutsourcedItemDto extends PreviewOutsourcedItemDto {
  @IsString({ message: 'Informe o nome do serviço' })
  @MaxLength(200, { message: 'O nome tem até 200 letras' })
  name: string;

  @IsUUID('4', { message: 'Informe o fornecedor' })
  supplierId: string;

  @Type(() => Number)
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(1000000, { message: 'A quantidade vai até 1.000.000' })
  quantity: number;

  // Preço unitário digitado por quem vê valores; sem ele, o sugerido
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Preço inválido' })
  @Min(0, { message: 'Preço inválido' })
  @ApiProperty({ required: false, example: 29000 })
  price?: number;
}
