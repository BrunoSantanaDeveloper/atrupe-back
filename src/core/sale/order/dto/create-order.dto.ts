import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do orçamento associada a ordem de serviço',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  quotationId: string;
}
