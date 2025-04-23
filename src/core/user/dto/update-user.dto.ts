import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ApiProperty({
    description: 'Senha do usuário',
    example: 'StrongPassword123!',
  })
  password?: string;
}
