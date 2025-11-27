import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyHistoryDto {
  @ApiProperty({
    description: 'Ação realizada',
    example: 'UPDATE',
  })
  @IsString()
  action: string;

  @ApiProperty({
    description: 'Descrição da ação',
    example: 'Atualização do nome da empresa',
  })
  @IsString()
  description: string;

  @ApiPropertyOptional({
    description: 'Alterações realizadas (antes e depois)',
    example: {
      before: { name: 'Empresa Antiga' },
      after: { name: 'Empresa Nova' },
    },
  })
  @IsOptional()
  @IsObject()
  changes?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };

  @ApiPropertyOptional({
    description: 'Metadados adicionais',
    example: { ip: '192.168.1.1', userAgent: 'Mozilla/5.0...' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
