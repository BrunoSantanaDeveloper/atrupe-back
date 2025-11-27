import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignSubscriptionDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'ID da empresa que receberá a subscription do plano START',
    example: 'uuid-da-empresa',
    required: true,
  })
  companyId: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Senha do administrador do sistema para autorizar a operação',
    example: 'senha123',
    required: true,
  })
  password: string;
}
