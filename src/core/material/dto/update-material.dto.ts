import { PartialType } from '@nestjs/mapped-types';
import { CreateMaterialDto } from './create-material.dto';

/**
 * Os campos do cadastro, todos opcionais. `advanced` substitui o bloco
 * inteiro; os campos do papel (gramatura, formato, folha e área útil) só
 * mexem no que vier. `active` inativa ou reativa como o toggle-status.
 * `code`, `priceRule`, `price` e as variações têm rota própria e não entram
 * por aqui.
 */
export class UpdateMaterialDto extends PartialType(CreateMaterialDto) {}
