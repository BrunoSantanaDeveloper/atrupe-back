import { TestPlanType } from '../options';
import { ELITE } from './elite';
import { FULL } from './full';
import { LITE } from './lite';
import { PRO } from './pro';
import { START } from './start';
import { TRIAL } from './trial';
import { PlanFixture } from './types';

export { FIXTURES_VERSION } from './types';
export type {
  PartyFixture,
  PlanFixture,
  QuotationFixture,
  RoleFixture,
} from './types';

/** A fixture de cada plano (cumulativa: cada uma parte da anterior). */
export const PLAN_FIXTURES: Record<TestPlanType, PlanFixture> = {
  TRIAL,
  START,
  LITE,
  PRO,
  ELITE,
  FULL,
};
