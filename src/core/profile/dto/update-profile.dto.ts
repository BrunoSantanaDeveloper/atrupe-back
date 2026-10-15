import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Nome da função',
    example: 'Admin',
    required: true,
  })
  name?: string;

  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description: 'Porcentagem de comissão (0 a 100)',
    example: '10.00',
    required: true,
  })
  commission?: number;

  @IsOptional()
  @ApiProperty({
    description: 'Porcentagem máxima de desconto (0 a 100)',
    example: '10.00',
    required: false,
  })
  @IsNumber()
  maxDiscount?: number;

  @IsOptional()
  @ApiProperty({
    description: 'Valor mínimo',
    example: '150.00',
    required: false,
  })
  @IsNumber()
  minValue?: number;

  @IsOptional()
  @ApiProperty({
    description: 'Pode aprovar pré-cadastro',
    example: false,
    required: false,
  })
  @IsBoolean()
  canApprovePreRegistration?: boolean;

  @IsOptional()
  @ApiProperty({
    description: 'Pode cancelar vendas',
    example: false,
    required: false,
  })
  @IsBoolean()
  canCancelSale?: boolean;

  @IsOptional()
  @ApiProperty({
    description:
      'Somente enviar ao caixa (FC-12.1): o vendedor só envia a venda rápida à frente de caixa',
    example: false,
    required: false,
  })
  @IsBoolean()
  onlySendToCash?: boolean;
}
