import { SetMetadata } from '@nestjs/common';
import { TRIAL_RESTRICTED_KEY } from '../guards/trial.guard';

/**
 * Decorator para marcar endpoints que são restritos durante trial expirado
 */
export const TrialRestricted = () => SetMetadata(TRIAL_RESTRICTED_KEY, true);
