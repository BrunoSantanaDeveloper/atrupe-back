import { IsOptional, IsString, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class ContactFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Texto de busca para filtrar os contatos',
    example: 'John Doe',
    required: false,
  })
  search: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente para filtrar os contatos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do fornecedor para filtrar os contatos',
    example: '123e4567-e89b-12d3-a456-426614174001',
    required: false,
  })
  supplierId: string;
}
