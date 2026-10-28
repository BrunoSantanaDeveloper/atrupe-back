/** Os recursos de plano ligados na empresa (chaves de `features`). */
export type AiPlanFeatures = ReadonlySet<string>;

/** As chaves ligadas do plano (`features` do getCompanyPlanInfo). */
export const enabledFeatures = (
  features: Record<string, boolean> | undefined,
): AiPlanFeatures =>
  new Set(
    Object.entries(features ?? {})
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
  );

export const AI_PLAN_DENIED_REASON = 'Este recurso não faz parte do seu plano.';
