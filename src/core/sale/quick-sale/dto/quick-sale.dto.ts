import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuickSalePayment } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** A configuração da venda rápida (VR-4, VR-5, FC-17): o objeto inteiro. */
export class QuickSaleSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  // Sem efeito desde 26/10/2026 (o recebimento é da série, VR-5); aceitos
  // para as telas antigas que ainda os enviam
  @ApiPropertyOptional({ enum: QuickSalePayment })
  @IsOptional()
  @IsEnum(QuickSalePayment)
  payment?: QuickSalePayment;

  @ApiPropertyOptional({ type: [String], example: ['dinheiro', 'pix', 'cartao'] })
  @IsOptional()
  @IsArray()
  @IsIn(['dinheiro', 'pix', 'cartao'], {
    each: true,
    message: 'As formas da venda rápida são dinheiro, PIX e cartão',
  })
  cashMethods?: string[];

  @ApiProperty()
  @IsBoolean()
  downPaymentRequired: boolean;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  downPaymentPercent: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  clientId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  seriesId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'O atendimento' })
  @IsOptional()
  @IsString()
  serviceTypeId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'O responsável do cliente padrão (contato), ou nenhum',
  })
  @IsOptional()
  @IsUUID()
  responsibleId?: string | null;
}
