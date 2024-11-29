import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProfileDto {
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

export class AddEmployeeOnProfileDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'ID do funcionário',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  employeeId: string;
}
