import type { FinanceDataset } from '../types/domain';
import type { FinancePlan, PlanInput } from '../types/planning';
import { calculateCategoryBreakdown } from '../domain/analytics';
import { dateValue, shiftDate } from '../domain/dates';
import { CSV_ORGANISATION_ID } from '../domain/csv-import';
import { isMock, supabase } from './supabase';

const storageKey = (organisationId: string) => `clinic-finance.plans.v1.${organisationId}`;
const kinds = ['budget', 'goal', 'bill'];
const frequencies = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const isLocal = (organisationId: string) => isMock || organisationId === CSV_ORGANISATION_ID;

export function validatePlan(input: PlanInput, data: FinanceDataset): void {
  if (!kinds.includes(input.kind) || !input.name.trim() || input.name.trim().length > 120)
    throw new Error('Enter a plan name of up to 120 characters.');
  if (
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    !Number.isSafeInteger(input.savedCents) ||
    input.savedCents < 0
  )
    throw new Error('Use a positive amount and a non-negative saved balance.');
  if (input.entityId && !data.entities.some((entity) => entity.id === input.entityId))
    throw new Error('Choose an entity in this workspace.');
  if (input.categoryId && !data.categories.some((category) => category.id === input.categoryId))
    throw new Error('Choose a category in this workspace.');
  const account = input.accountId ? data.accounts.find((row) => row.id === input.accountId) : null;
  if (input.accountId && (!account || (input.entityId && account.entityId !== input.entityId)))
    throw new Error('Choose an account belonging to the selected entity.');
  if (input.dueDate && !Number.isFinite(dateValue(input.dueDate)))
    throw new Error('Choose a valid date.');
  if (input.frequency && !frequencies.includes(input.frequency))
    throw new Error('Choose a supported recurrence.');
  if (
    input.kind === 'budget' &&
    (input.accountId || input.dueDate || input.frequency || input.savedCents)
  )
    throw new Error('Monthly budgets use categories and entity scope.');
  if (input.kind === 'goal' && (input.categoryId || input.frequency))
    throw new Error('Savings goals use an account or a manually tracked balance.');
  if (input.kind === 'bill' && (!input.dueDate || !input.frequency || input.savedCents))
    throw new Error('Bills require a due date and recurrence.');
}

function demoPlans(data: FinanceDataset): FinancePlan[] {
  const rows = calculateCategoryBreakdown(data)
    .filter((row) => row.categoryId)
    .slice(0, 3);
  const to = data.transactions
    .map((row) => row.postedAt)
    .sort()
    .at(-1);
  return [
    ...rows.map((row) => ({
      id: crypto.randomUUID(),
      organisationId: data.organisation.id,
      entityId: null,
      kind: 'budget' as const,
      name: row.name,
      amountCents: Math.max(10000, Math.ceil(((row.amountCents / 3) * 1.15) / 100) * 100),
      savedCents: 0,
      categoryId: row.categoryId,
      accountId: null,
      dueDate: null,
      frequency: null,
    })),
    {
      id: crypto.randomUUID(),
      organisationId: data.organisation.id,
      entityId: null,
      kind: 'goal',
      name: 'Practice emergency fund',
      amountCents: 5000000,
      savedCents: 1250000,
      categoryId: null,
      accountId: null,
      dueDate: to ? shiftDate(to, 365) : null,
      frequency: null,
    },
  ];
}

function fromRow(row: Record<string, unknown>): FinancePlan {
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    entityId: row.entity_id as string | null,
    kind: row.kind as FinancePlan['kind'],
    name: String(row.name),
    amountCents: Number(row.amount_cents),
    savedCents: Number(row.saved_cents),
    categoryId: row.category_id as string | null,
    accountId: row.account_id as string | null,
    dueDate: row.due_date as string | null,
    frequency: row.frequency as FinancePlan['frequency'],
  };
}

export async function loadPlans(data: FinanceDataset): Promise<FinancePlan[]> {
  if (isLocal(data.organisation.id)) {
    const raw = localStorage.getItem(storageKey(data.organisation.id));
    if (!raw) return data.organisation.id === CSV_ORGANISATION_ID ? [] : demoPlans(data);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('Saved plans could not be read.');
    }
    if (!Array.isArray(value)) throw new Error('Saved plans could not be read.');
    return value.filter((row): row is FinancePlan => {
      if (
        !row ||
        typeof row !== 'object' ||
        row.organisationId !== data.organisation.id ||
        typeof row.id !== 'string'
      )
        return false;
      try {
        validatePlan(row, data);
        return true;
      } catch {
        return false;
      }
    });
  }
  if (!supabase) throw new Error('The workspace is unavailable.');
  const items: FinancePlan[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: rows, error } = await supabase
      .from('finance_plans')
      .select('*')
      .eq('organisation_id', data.organisation.id)
      .order('id')
      .range(offset, offset + 999);
    if (error) throw new Error('Plans could not be loaded. Please try again.');
    items.push(...rows.map(fromRow));
    if (rows.length < 1000) return items;
  }
}

export async function persistPlan(data: FinanceDataset, input: PlanInput): Promise<FinancePlan> {
  validatePlan(input, data);
  const item: FinancePlan = {
    ...input,
    id: input.id || crypto.randomUUID(),
    organisationId: data.organisation.id,
    name: input.name.trim(),
  };
  if (isLocal(data.organisation.id)) return item;
  if (!supabase) throw new Error('The workspace is unavailable.');
  const row = {
    id: item.id,
    organisation_id: item.organisationId,
    entity_id: item.entityId,
    kind: item.kind,
    name: item.name,
    amount_cents: item.amountCents,
    saved_cents: item.savedCents,
    category_id: item.categoryId,
    account_id: item.accountId,
    due_date: item.dueDate,
    frequency: item.frequency,
  };
  const { error } = await supabase.from('finance_plans').upsert(row);
  if (error) throw new Error('The plan was not saved. Owner or administrator access is required.');
  return item;
}

export async function deletePlan(organisationId: string, id: string): Promise<void> {
  if (isLocal(organisationId)) return;
  if (!supabase) throw new Error('The workspace is unavailable.');
  const { data, error } = await supabase
    .from('finance_plans')
    .delete()
    .eq('organisation_id', organisationId)
    .eq('id', id)
    .select('id');
  if (error || !data?.length)
    throw new Error('The plan was not removed. Owner or administrator access is required.');
}

export function persistDemoPlans(organisationId: string, items: FinancePlan[]): void {
  if (isLocal(organisationId))
    localStorage.setItem(storageKey(organisationId), JSON.stringify(items));
}
