import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
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

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada à função',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  companyId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do setor associado à função',
    example: '456e7890-e12d-34a6-b789-567890123456',
    required: true,
  })
  sectorId: string;
}
