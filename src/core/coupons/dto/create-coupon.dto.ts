import { ApiProperty } from '@nestjs/swagger';
import { DiscountType, CouponDuration } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  IsDateString,
} from 'class-validator';

export class CreateCouponDto {
  @ApiProperty({
    description: 'Código do cupom (case-insensitive no backend)',
    example: 'BEMVINDO20',
  })
  @IsString()
  code: string;

  @ApiProperty({ description: 'Descrição interna do cupom', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: DiscountType,
    description: 'Tipo do desconto: PERCENT ou VALUE',
  })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({
    description:
      'Valor do desconto. Ex: 20 para 20%, ou 5000 para R$ 50,00 (em centavos)',
    example: 20,
  })
  @IsNumber()
  @Min(0)
  discountValue: number;

  @ApiProperty({
    enum: CouponDuration,
    default: CouponDuration.ONCE,
    description: 'Duração do desconto',
  })
  @IsEnum(CouponDuration)
  @IsOptional()
  durationType?: CouponDuration = CouponDuration.ONCE;

  @ApiProperty({
    description:
      'Quantidade de meses de duração (apenas para durationType = MONTHS)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  durationMonths?: number;

  @ApiProperty({
    description:
      'Número total de usos permitidos globalmente (null = ilimitado)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @ApiProperty({
    description: 'Número de usos permitidos por empresa',
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUsesPerCompany?: number = 1;

  @ApiProperty({
    description: 'Valor mínimo do plano para aplicação (em centavos)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPlanValue?: number;

  @ApiProperty({
    description: 'Data de início da validade (default: agora)',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiProperty({
    description: 'Data de término da validade (null = sem expiração)',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiProperty({ description: 'Indica se o cupom está ativo', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  @ApiProperty({
    description: 'Lista de IDs dos planos aplicáveis (vazio = todos)',
    default: [],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  appliesToPlans?: string[] = [];

  @ApiProperty({
    description: 'Se o cupom pode ser aplicado em adição de módulos',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  appliesToModules?: boolean = true;
}
