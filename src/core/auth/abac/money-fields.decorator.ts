import { SetMetadata } from '@nestjs/common';

export const MONEY_FIELDS_KEY = 'money_fields';
export const VALUES_ONLY_KEY = 'values_only';

/**
 * Rota que devolve dinheiro junto com outros dados: quem não tem
 * `values:values:view` recebe a resposta sem os campos listados. É a regra do
 * contrato: o servidor omite custo e preço, não basta a tela esconder.
 *
 * Só sai o campo que guarda um número. Objeto ou lista com o mesmo nome fica e
 * é percorrido: `discount` é o desconto do item do orçamento e também o bloco
 * `{ discountType, discountValue }` das condições de pagamento.
 *
 * Por padrão só observa (ver ValuesVisibilityInterceptor).
 */
export const MoneyFields = (...fields: string[]) =>
  SetMetadata(MONEY_FIELDS_KEY, fields);

/**
 * Rota em que tudo é valor (relatório, extrato, folha): sem
 * `values:values:view` a rota inteira é recusada, com o mesmo 403 do
 * PermissionsGuard. Vale na classe ou na rota; na rota, `@ValuesOnly(false)`
 * abre exceção num controller marcado, e `@MoneyFields` troca a recusa pela
 * omissão dos campos.
 *
 * Por padrão só observa (ver ValuesVisibilityInterceptor).
 */
export const ValuesOnly = (enabled = true) =>
  SetMetadata(VALUES_ONLY_KEY, enabled);
