import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProductDto, CreateProductItemDto } from './create-product.dto';
import { ProductStatus } from '@prisma/client';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductItemDto extends PartialType(CreateProductItemDto) {}

/**
 * Campos que o CreateProductDto inicia com um padrão. O PartialType e o
 * OmitType copiam esses inicializadores, então um PATCH sem o campo chegava
 * ao service com o padrão da criação: salvar pela tela de produtos (que não
 * manda isActive, isService nem isStandard) reativava produto inativo e
 * tirava o "serviço" e o "padrão" do produto.
 */
const PADROES_DA_CRIACAO = [
  'isActive',
  'isStandard',
  'isService',
  'allowEditValues',
  'allowEditDescription',
] as const;

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['items'] as const),
) {
  constructor() {
    super();
    // Na atualização, campo ausente é "não mexer".
    for (const campo of PADROES_DA_CRIACAO) {
      delete (this as Record<string, unknown>)[campo];
    }
  }

  status?: ProductStatus;

  /** Sobrescreve items com versão parcial para permitir updates sem name/unitKind */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductItemDto)
  @IsOptional()
  items?: UpdateProductItemDto[];
}
