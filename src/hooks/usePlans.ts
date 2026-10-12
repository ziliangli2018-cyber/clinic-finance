import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceDataset } from '../types/domain';
import type { FinancePlan, PlanInput } from '../types/planning';
import { deletePlan, loadPlans, persistDemoPlans, persistPlan } from '../services/plans';

export function usePlans(data: FinanceDataset) {
  const [state, setState] = useState({
    organisationId: '',
    items: [] as FinancePlan[],
    loading: true,
    error: '',
  });
  const [savingScope, setSavingScope] = useState('');
  const current = useRef<FinancePlan[]>([]);
  const busy = useRef(false);
  const organisationId = data.organisation.id;
  const generation = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    let active = true;
    generation.current += 1;
    current.current = [];
    loadPlans(dataRef.current)
      .then((plans) => {
        if (!active) return;
        current.current = plans;
        setState({ organisationId, items: plans, loading: false, error: '' });
      })
      .catch((cause) => {
        if (!active) return;
        setState({
          organisationId,
          items: [],
          loading: false,
          error: cause instanceof Error ? cause.message : 'Plans could not be loaded.',
        });
      });
    return () => {
      active = false;
    };
  }, [organisationId]);

  const run = useCallback(
    async (action: () => Promise<FinancePlan[]>) => {
      if (busy.current) return false;
      busy.current = true;
      const actionGeneration = generation.current;
      setSavingScope(organisationId);
      setState((value) => ({ ...value, error: '' }));
      try {
        const next = await action();
        persistDemoPlans(organisationId, next);
        if (actionGeneration !== generation.current) return false;
        current.current = next;
        setState({ organisationId, items: next, loading: false, error: '' });
        return true;
      } catch (cause) {
        if (actionGeneration === generation.current)
          setState((value) => ({
            ...value,
            error: cause instanceof Error ? cause.message : 'The change could not be saved.',
          }));
        return false;
      } finally {
        busy.current = false;
        setSavingScope('');
      }
    },
    [organisationId],
  );

  const save = (input: PlanInput) =>
    run(async () => {
      const previous = current.current;
      const item = await persistPlan(dataRef.current, input);
      return [...previous.filter((row) => row.id !== item.id), item];
    });
  const remove = (id: string) =>
    run(async () => {
      const previous = current.current;
      await deletePlan(organisationId, id);
      return previous.filter((row) => row.id !== id);
    });
  const sameScope = state.organisationId === organisationId;
  const items = sameScope ? state.items : [];
  const loading = !sameScope || state.loading;
  const error = sameScope ? state.error : '';
  const saving = savingScope === organisationId;
  return { items, loading, saving, error, save, remove };
}
