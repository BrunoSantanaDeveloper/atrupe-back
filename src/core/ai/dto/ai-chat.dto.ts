import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AiChatContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  currentPath?: string;
}

export class AiChatRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsObject()
  context?: AiChatContextDto;
}
