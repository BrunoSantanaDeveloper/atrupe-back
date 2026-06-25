export type ReadinessCheckStatus = 'PASS' | 'FAIL' | 'PENDING';

export interface ReadinessCheck {
  check: string;
  status: ReadinessCheckStatus;
  message?: string;
}

export interface ReadinessResult {
  environment: string;
  localReady: boolean;
  ready: boolean;
  requiresProviderRegistration: boolean | null;
  /** Nomes dos checks com status FAIL — bloqueiam a ativação. */
  blocking: string[];
  checks: ReadinessCheck[];
  evaluatedAt: string;
}
