import { PartialType } from '@nestjs/mapped-types';
import { CreateMaterialDto } from './create-material.dto';

/**
 * Os campos do cadastro, todos opcionais. `advanced` substitui o bloco
 * inteiro. `active`, `code`, `priceRule`, `price` e as variações têm rota
 * própria e não entram por aqui.
 */
export class UpdateMaterialDto extends PartialType(CreateMaterialDto) {}
