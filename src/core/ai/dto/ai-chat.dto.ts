import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AiChatContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  currentPath?: string;

  // O que a tela tem aberto, para os botões "Escrever descritivo" (item e
  // produto) e "Sugerir categoria" (lançamento) do agente (28/10/2026)
  @IsOptional()
  @IsUUID()
  quotationId?: string;

  @IsOptional()
  @IsUUID()
  quotationItemId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  payableId?: string;
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
