export type PlanKind = 'budget' | 'goal' | 'bill';
export type PlanFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';

export interface FinancePlan {
  id: string;
  organisationId: string;
  entityId: string | null;
  kind: PlanKind;
  name: string;
  amountCents: number;
  savedCents: number;
  categoryId: string | null;
  accountId: string | null;
  dueDate: string | null;
  frequency: PlanFrequency | null;
}

export type PlanInput = Omit<FinancePlan, 'id' | 'organisationId'> & { id?: string };
