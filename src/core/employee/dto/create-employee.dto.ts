import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { EmploymentContract } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEmployeeDto {
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
  name?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'URL do avatar do colaborador',
    example: 'https://example.com/avatar.jpg',
  })
  avatarUrl?: string;

  // @IsNotEmpty()
  // @ApiProperty({
  //   description: 'Email do colaborador',
  //   example: 'john.doe@example.com',
  // })
  email: string;

  // @IsNotEmpty()
  // @IsNumberString()
  // @ApiProperty({
  //   description: 'Salário do colaborador',
  //   example: '5000',
  // })
  sallary: string;

  signatureUrl?: string;

  // Forma de contratação e salário base (centavos): geram os encargos
  @IsOptional()
  @IsEnum(EmploymentContract, { message: 'Forma de contratação inválida' })
  contract?: EmploymentContract;

  @IsOptional()
  @IsInt({ message: 'O salário base vai em centavos' })
  @Min(0, { message: 'O salário base não pode ser negativo' })
  baseSalary?: number;
}
