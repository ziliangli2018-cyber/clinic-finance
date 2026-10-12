import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDataset } from '../src/domain/mock';
import type { PlanInput } from '../src/types/planning';

const { mode, from, eq, order, range, upsert, remove, select } = vi.hoisted(() => ({
  mode: { mock: true },
  from: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  select: vi.fn(),
}));

vi.mock('../src/services/supabase', () => ({
  get isMock() {
    return mode.mock;
  },
  supabase: { from },
}));

import {
  deletePlan,
  loadPlans,
  persistDemoPlans,
  persistPlan,
  validatePlan,
} from '../src/services/plans';

const dataset = createMockDataset();
const clinic = dataset.entities.find((entity) => entity.name === 'Kilcoy')!;
const otherClinic = dataset.entities.find((entity) => entity.name === 'Burpengary')!;
const account = dataset.accounts.find((row) => row.entityId === clinic.id)!;
const category = dataset.categories.find((row) => row.kind === 'expense')!;
const budget: PlanInput = {
  entityId: clinic.id,
  kind: 'budget',
  name: 'Clinical supplies',
  amountCents: 120_000,
  savedCents: 0,
  categoryId: category.id,
  accountId: null,
  dueDate: null,
  frequency: null,
};
const goal: PlanInput = {
  ...budget,
  kind: 'goal',
  name: 'Practice reserve',
  categoryId: null,
  accountId: account.id,
  savedCents: 20_000,
  dueDate: '2028-02-29',
};

beforeEach(() => {
  vi.resetAllMocks();
  mode.mock = true;
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const query = { select, eq, order, range, upsert, delete: remove };
  from.mockReturnValue(query);
  select.mockReturnValue(query);
  eq.mockReturnValue(query);
  order.mockReturnValue(query);
  remove.mockReturnValue(query);
});

describe('financial plan input boundaries', () => {
  it('rejects imprecise money, invalid dates, and unrecognised references before storage', async () => {
    for (const input of [
      { ...budget, amountCents: 0 },
      { ...budget, amountCents: 1.5 },
      { ...budget, amountCents: Number.MAX_SAFE_INTEGER + 1 },
      { ...goal, savedCents: -1 },
      { ...goal, dueDate: '2027-02-29' },
      { ...goal, dueDate: '2028-02-29T00:00:00Z' },
      { ...budget, entityId: 'another-workspace' },
      { ...budget, categoryId: 'unknown-category' },
      { ...goal, accountId: 'unknown-account' },
      { ...goal, entityId: otherClinic.id },
    ]) {
      await expect(persistPlan(dataset, input)).rejects.toThrow();
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('keeps budget, goal, and recurring bill fields consistent', () => {
    expect(() => validatePlan(budget, dataset)).not.toThrow();
    expect(() => validatePlan(goal, dataset)).not.toThrow();
    const bill: PlanInput = {
      ...budget,
      kind: 'bill',
      dueDate: '2026-11-01',
      frequency: 'monthly',
      accountId: account.id,
    };
    expect(() => validatePlan(bill, dataset)).not.toThrow();
    for (const input of [
      { ...budget, accountId: account.id },
      { ...goal, categoryId: category.id },
      { ...bill, dueDate: null },
      { ...bill, frequency: null },
      { ...bill, savedCents: 1 },
    ])
      expect(() => validatePlan(input, dataset)).toThrow();
  });
});

describe('demo plan persistence', () => {
  it('seeds valid plans and saves only in the selected workspace', async () => {
    const seed = await loadPlans(dataset);
    expect(seed.length).toBeGreaterThan(0);
    seed.forEach((item) => expect(() => validatePlan(item, dataset)).not.toThrow());
    const saved = await persistPlan(dataset, { ...budget, name: '  Clinical supplies  ' });
    expect(saved).toMatchObject({ ...budget, organisationId: dataset.organisation.id });
    expect(saved.id).toEqual(expect.any(String));
    persistDemoPlans(dataset.organisation.id, [saved]);
    expect(await loadPlans(dataset)).toEqual([saved]);
    expect(
      await loadPlans({
        ...dataset,
        organisation: { ...dataset.organisation, id: 'other-workspace' },
      }),
    ).not.toEqual([saved]);
    expect(from).not.toHaveBeenCalled();
  });

  it('filters foreign-workspace and invalid saved plans', async () => {
    const valid = await persistPlan(dataset, budget);
    localStorage.setItem(
      `clinic-finance.plans.v1.${dataset.organisation.id}`,
      JSON.stringify([
        valid,
        { ...valid, id: 'foreign', organisationId: 'other-workspace' },
        { ...valid, id: 'invalid-money', amountCents: 0 },
        { ...valid, id: 'invalid-entity', entityId: 'other-workspace' },
        null,
      ]),
    );
    expect(await loadPlans(dataset)).toEqual([valid]);
  });

  it('reports unreadable storage instead of treating it as a complete plan list', async () => {
    localStorage.setItem(`clinic-finance.plans.v1.${dataset.organisation.id}`, '{broken');
    await expect(loadPlans(dataset)).rejects.toThrow();
    localStorage.setItem(`clinic-finance.plans.v1.${dataset.organisation.id}`, '{}');
    await expect(loadPlans(dataset)).rejects.toThrow('Saved plans could not be read');
  });
});

describe('hosted plan storage', () => {
  const row = {
    id: 'saved-plan',
    organisation_id: dataset.organisation.id,
    entity_id: clinic.id,
    kind: 'budget',
    name: budget.name,
    amount_cents: budget.amountCents,
    saved_cents: 0,
    category_id: category.id,
    account_id: null,
    due_date: null,
    frequency: null,
  };

  beforeEach(() => {
    mode.mock = false;
  });

  it('loads all pages with a workspace filter and maps database money fields', async () => {
    range.mockResolvedValueOnce({
      data: Array.from({ length: 1000 }, (_, index) => ({
        ...row,
        id: `plan-${index}`,
      })),
      error: null,
    });
    range.mockResolvedValueOnce({ data: [row], error: null });
    const items = await loadPlans(dataset);
    expect(items).toHaveLength(1001);
    expect(items.at(-1)).toEqual({
      ...budget,
      id: row.id,
      organisationId: dataset.organisation.id,
    });
    expect(from).toHaveBeenCalledWith('finance_plans');
    expect(eq).toHaveBeenCalledWith('organisation_id', dataset.organisation.id);
    expect(order).toHaveBeenCalledWith('id');
    expect(range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('persists an existing plan with the trusted workspace id and trimmed name', async () => {
    upsert.mockResolvedValue({ error: null });
    const item = await persistPlan(dataset, {
      ...budget,
      id: row.id,
      name: '  Clinical supplies  ',
    });
    expect(item.name).toBe('Clinical supplies');
    expect(upsert).toHaveBeenCalledWith(row);
  });

  it('does not expose database error details when load or save fails', async () => {
    range.mockResolvedValue({ data: null, error: new Error('private-database-detail') });
    await expect(loadPlans(dataset)).rejects.toThrow('Plans could not be loaded');
    upsert.mockResolvedValue({ error: new Error('private-database-detail') });
    await expect(persistPlan(dataset, budget)).rejects.toThrow('Owner or administrator');
  });

  it('requires a returned row for deletion and scopes both workspace and plan', async () => {
    select.mockResolvedValueOnce({ data: [{ id: row.id }], error: null });
    await expect(deletePlan(dataset.organisation.id, row.id)).resolves.toBeUndefined();
    expect(eq.mock.calls).toEqual([
      ['organisation_id', dataset.organisation.id],
      ['id', row.id],
    ]);
    select.mockResolvedValueOnce({ data: [], error: null });
    await expect(deletePlan(dataset.organisation.id, row.id)).rejects.toThrow('not removed');
  });
});
