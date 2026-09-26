import {
  IsBoolean,
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CancelSubscriptionDto {
  @ApiProperty({
    description: 'Motivo do cancelamento',
    example: 'Preço muito alto',
  })
  @IsString()
  @MinLength(3, { message: 'O motivo deve ter pelo menos 3 caracteres' })
  @MaxLength(200, { message: 'O motivo deve ter no máximo 200 caracteres' })
  reason: string;

  @ApiPropertyOptional({
    description: 'Feedback adicional do cliente',
    example: 'O sistema não atendeu minhas necessidades de relatório.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'O feedback deve ter no máximo 1000 caracteres' })
  feedback?: string;

  @ApiPropertyOptional({
    description:
      'Confirma que as exportações necessárias foram feitas e que os dados deixam de estar disponíveis após o cancelamento (contrato 1.1, 5.10 e 9.2).',
  })
  @IsBoolean()
  @IsOptional()
  exportsConfirmed?: boolean;
}
