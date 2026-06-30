import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateContactSourceDto {
  @ApiProperty({ description: 'Nome da origem de contato' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  companyId: string;
}
