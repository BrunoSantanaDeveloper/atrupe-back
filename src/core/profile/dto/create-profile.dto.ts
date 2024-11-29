import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProfileDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da função',
    example: 'Admin',
    required: true,
  })
  name: string;

  companyId: string;
}

export class AddEmployeeOnProfileDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do funcionário',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  employeeId: string;
}
