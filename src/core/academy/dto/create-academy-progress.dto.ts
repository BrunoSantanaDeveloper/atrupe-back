import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateAcademyProgressDto {
  companyId: string;

  @IsUUID()
  @ApiProperty({
    description: 'ID do sistema de aula',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  itemId: string;
}
