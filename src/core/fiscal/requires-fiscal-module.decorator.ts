import { UseGuards, applyDecorators } from '@nestjs/common';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { ObserveFeature } from '../plan/decorators/observe-feature.decorator';

/**
 * A emissão de nota exige o módulo Nota Fiscal do plano (`nota_fiscal`).
 *
 * Por enquanto só observa: quem emite sem o módulo continua emitindo, e o log
 * do FeatureGuard mostra a empresa. Para recusar, tirar o `ObserveFeature()`.
 *
 * Vale só para criar e emitir. Cancelar, inutilizar, corrigir e consultar
 * ficam livres: a empresa que deixa o módulo continua responsável pelas notas
 * que emitiu.
 */
export const RequiresFiscalModule = () =>
  applyDecorators(
    UseGuards(FeatureGuard),
    RequiresFeature('nota_fiscal'),
    ObserveFeature(),
  );
