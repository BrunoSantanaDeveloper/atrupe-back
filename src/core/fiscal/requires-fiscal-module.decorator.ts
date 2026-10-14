import { UseGuards, applyDecorators } from '@nestjs/common';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { ObserveFeature } from '../plan/decorators/observe-feature.decorator';

/**
 * A emissão de nota exige o módulo Nota Fiscal do plano (`nota_fiscal`).
 *
 * Observa até a data de `FISCAL_MODULE_ENFORCE_FROM` (AAAA-MM-DD): antes dela,
 * quem emite sem o módulo continua emitindo e o log do FeatureGuard mostra a
 * empresa, para o aviso e a cobrança; a partir dela, recusa com o 403 do plano.
 * Sem a variável, só observa (decisão do PO, 14/10: avisar e recusar 30 dias
 * depois).
 *
 * Vale só para criar e emitir. Cancelar, inutilizar, corrigir e consultar
 * ficam livres: a empresa que deixa o módulo continua responsável pelas notas
 * que emitiu.
 */
export const RequiresFiscalModule = () =>
  applyDecorators(
    UseGuards(FeatureGuard),
    RequiresFeature('nota_fiscal'),
    ObserveFeature({ untilEnv: 'FISCAL_MODULE_ENFORCE_FROM' }),
  );
