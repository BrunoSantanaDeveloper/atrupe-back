import { SetMetadata } from '@nestjs/common';
import { REQUIRED_FEATURE_KEY } from '../guards/feature.guard';

/**
 * Decorator para exigir uma feature específica
 * @param feature - chave da feature (ex: 'crm', 'advanced_reports')
 */
export const RequiresFeature = (feature: string) =>
  SetMetadata(REQUIRED_FEATURE_KEY, feature);
