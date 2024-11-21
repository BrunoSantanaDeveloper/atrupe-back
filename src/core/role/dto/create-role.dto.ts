import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da função',
    example: 'Admin',
    required: true,
  })
  name: string;

  companyId: string;
  @IsOptional()
  @ApiProperty({
    description: 'ID do setor associado à função',
    example: '456e7890-e12d-34a6-b789-567890123456',
    required: true,
  })
  sectorId?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Porcentagem de comissão (0 a 100)',
    example: '10.00',
    required: false,
  })
  commission: number;
  @IsOptional()
  @ApiProperty({
    description: 'Porcentagem máxima de desconto (0 a 100)',
    example: '10.00',
    required: false,
  })
  maxDiscount: number;
  @IsOptional()
  @ApiProperty({
    description: 'Valor mínimo',
    example: '150.00',
    required: false,
  })
  minValue: number;

  @IsOptional()
  @ApiProperty({
    description: 'Pode aprovar pré-cadastro',
    example: false,
    required: false,
  })
  canApprovePreRegistration: boolean;

  @IsOptional()
  @ApiProperty({
    description: 'Pode cancelar vendas',
    example: false,
    required: false,
  })
  canCancelSale: boolean;
}
