import {
  IsEmail,
  IsNotEmpty,
  IsNumberString,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEmployeeDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao colaborador',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do setor associado ao colaborador',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  sectorId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cargo associado ao colaborador',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  roleId: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do colaborador',
    example: 'John Doe',
  })
  name: string;

  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    description: 'Email do colaborador',
    example: 'john.doe@example.com',
  })
  email: string;

  @IsNotEmpty()
  @IsNumberString()
  @ApiProperty({
    description: 'Salário do colaborador',
    example: '5000',
  })
  sallary: string;
}
