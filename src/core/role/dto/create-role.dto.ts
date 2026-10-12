import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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
  @IsArray()
  @IsString({ each: true })
  @ApiProperty({
    description: 'Array de permissões do cargo',
    example: '["home:create", "users:read", "users:update", "users:delete"]',
  })
  permissions?: string[];
}
