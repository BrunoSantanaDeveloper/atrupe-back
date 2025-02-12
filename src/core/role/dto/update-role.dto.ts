import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class UpdateRoleDto {
  @IsOptional()
  @ApiProperty({
    description: 'Nome atualizado da função',
    example: 'Manager',
  })
  name?: string;

  @IsOptional()
  @ApiProperty({
    description: 'ID do setor associado à função',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  sectorId?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Array de permissões do cargo',
    example: '["home:create", "users:read", "users:update", "users:delete"]',
  })
  permissions?: string[];
}
