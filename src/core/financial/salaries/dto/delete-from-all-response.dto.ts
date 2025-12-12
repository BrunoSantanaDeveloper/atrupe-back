import { ApiProperty } from '@nestjs/swagger';
import { ItemType } from '@prisma/client';

export class DeleteFromAllResponseDto {
  @ApiProperty({
    description: 'Success message',
    example:
      'Successfully deleted salary control "Comissão" from all employees',
  })
  message: string;

  @ApiProperty({
    description: 'Number of employees affected by the deletion',
    example: 15,
  })
  deletedCount: number;

  @ApiProperty({
    description: 'Reference of the deleted salary control',
    example: 'Comissão',
  })
  reference: string;

  @ApiProperty({
    description: 'Type of the deleted salary control',
    enum: ItemType,
    example: ItemType.INCREASE,
  })
  type: ItemType;

  @ApiProperty({
    description: 'List of affected employees',
    example: [
      { id: '123e4567-e89b-12d3-a456-426614174000', name: 'João Silva' },
      { id: '456e7890-e89b-12d3-a456-426614174000', name: 'Maria Santos' },
    ],
  })
  affectedEmployees: Array<{
    id: string;
    name: string;
  }>;
}
