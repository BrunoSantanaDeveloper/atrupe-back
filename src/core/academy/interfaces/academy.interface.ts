export interface AcademyFile {
  title: string;
  type: string;
  src: string;
}

export interface AcademyItem {
  id: string;
  description: string;
  checked: boolean;
  files?: AcademyFile[];
  video?: string;
  page?: string;
  modal?: string;
  buttonTitle?: string;
}

export interface AcademySection {
  id: string;
  title: string;
  items: AcademyItem[];
}

export interface AcademyResponse {
  plan: string;
  sections: AcademySection[];
}

export interface AcademyProgress {
  userId: string;
  companyId: string;
  plan: string;
  itemId: string;
  checked: boolean;
  completedAt?: Date;
}

export enum PlanType {
  START = 'start',
  LITE = 'lite',
  PRO = 'pro',
  ELITE = 'elite',
  FULL = 'full',
}

export const PLAN_HIERARCHY = {
  [PlanType.START]: 1,
  [PlanType.LITE]: 2,
  [PlanType.PRO]: 3,
  [PlanType.ELITE]: 4,
  [PlanType.FULL]: 5,
};
