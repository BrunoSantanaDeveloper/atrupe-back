import { SetMetadata } from '@nestjs/common';
import { REQUIRED_FEATURE_KEY } from '../guards/feature.guard';

/**
 * Exige que o plano da empresa inclua o recurso. Com uma lista, basta um
 * deles. Usar junto com `@UseGuards(FeatureGuard)`, depois do JwtAuthGuard.
 * @param feature - chave do recurso (ex.: 'cash_control'), ou lista de chaves
 */
export const RequiresFeature = (feature: string | string[]) =>
  SetMetadata(REQUIRED_FEATURE_KEY, feature);
