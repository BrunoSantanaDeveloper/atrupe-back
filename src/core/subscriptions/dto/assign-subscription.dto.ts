import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignSubscriptionDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'ID da empresa que receberá a subscription',
    example: 'uuid-da-empresa',
    required: true,
  })
  companyId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description:
      'ID do plano a ser atribuído. Se omitido, mantém o comportamento padrão e usa o plano START.',
    example: 'uuid-do-plano',
    required: false,
  })
  planId?: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Senha do administrador do sistema para autorizar a operação',
    example: 'senha123',
    required: true,
  })
  password: string;
}
