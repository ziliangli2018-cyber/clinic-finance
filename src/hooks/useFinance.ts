import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceDataset, Organisation } from '../types/domain';
import { advanceDemoDataset } from '@clinic-finance/demo-simulation';
import { isMock } from '../services/supabase';
import {
  loadDemoState,
  resetDemoState,
  saveDemoState,
  type DemoState,
} from '../services/demo-storage';
import {
  createLiveOrganisation,
  listOrganisations,
  loadDataset,
  saveCategories,
  saveCategory,
  seedDemo,
  syncBank,
} from '../services/finance';

export function useFinance() {
  const [data, setData] = useState<FinanceDataset | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [organisationId, setOrganisationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [simulationPaused, setSimulationPaused] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [simulationMessage, setSimulationMessage] = useState('');
  const loadedOrganisationId = data?.organisation.id;
  const version = useRef(0);
  const actionRunning = useRef(false);
  const demoState = useRef<DemoState | null>(null);
  const commitDemoState = useCallback((next: DemoState, message = '') => {
    demoState.current = next;
    setData(next.dataset);
    setSimulationPaused(next.paused);
    setLastUpdatedAt(next.lastUpdatedAt);
    setSimulationMessage(message);
    saveDemoState(next);
  }, []);
  const advanceDemo = useCallback(
    (force = false) => {
      const current = demoState.current;
      if (!current || (current.paused && !force)) return;
      const now = new Date();
      const advanced = advanceDemoDataset(current.dataset, current.sequence, now);
      commitDemoState(
        {
          dataset: advanced.dataset,
          paused: current.paused,
          sequence: advanced.sequence,
          lastUpdatedAt: now.toISOString(),
        },
        advanced.message,
      );
    },
    [commitDemoState],
  );
  const refresh = useCallback(
    async (options: { background?: boolean } = {}) => {
      const current = ++version.current;
      if (!options.background) {
        setLoading(true);
        setError('');
        setData(null);
      }
      try {
        if ((import.meta.env.VITE_DATA_MODE || 'mock') === 'mock') {
          const { createMockDataset } = await import('@clinic-finance/mock-dataset');
          const state = loadDemoState(createMockDataset());
          if (current !== version.current) return;
          demoState.current = state;
          setData(state.dataset);
          setSimulationPaused(state.paused);
          setLastUpdatedAt(state.lastUpdatedAt);
          setOrganisations([state.dataset.organisation]);
        } else {
          const orgs = await listOrganisations();
          const selected =
            orgs.find((org) => org.id === organisationId) ||
            orgs.find((org) => !org.isDemo) ||
            orgs[0];
          const dataset = selected ? await loadDataset(selected) : null;
          if (current !== version.current) return;
          setOrganisations(orgs);
          setData(dataset);
          setLastUpdatedAt(new Date().toISOString());
        }
      } catch (error) {
        if (current === version.current)
          setError(error instanceof Error ? error.message : 'Could not load your workspace');
      } finally {
        if (current === version.current) setLoading(false);
      }
    },
    [organisationId],
  );
  useEffect(() => {
    if (isMock || loading || !loadedOrganisationId) return;
    let reading = false;
    const readLatest = async () => {
      if (document.visibilityState !== 'visible' || reading || actionRunning.current) return;
      reading = true;
      try {
        await refresh({ background: true });
      } finally {
        reading = false;
      }
    };
    const timer = window.setInterval(() => void readLatest(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void readLatest();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadedOrganisationId, loading, refresh]);
  useEffect(() => {
    void refresh();
    // This is a request generation counter, not a DOM ref; invalidate all pending requests on cleanup.
    const invalidate = () => {
      version.current++;
    };
    return invalidate;
  }, [refresh]);
  useEffect(() => {
    if (!isMock || loading || simulationPaused || !demoState.current) return;
    const firstUpdate = window.setTimeout(() => advanceDemo(), 7_000);
    const updates = window.setInterval(() => advanceDemo(), 15_000);
    return () => {
      window.clearTimeout(firstUpdate);
      window.clearInterval(updates);
    };
  }, [advanceDemo, loading, simulationPaused]);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    setError('');
    try {
      return await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to complete this action');
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  }
  async function categorise(transactionId: string, categoryId: string) {
    await run(async () => {
      if (!isMock) await saveCategory(transactionId, categoryId);
      const current = isMock ? demoState.current?.dataset : data;
      if (!current) return;
      const next = {
        ...current,
        transactions: current.transactions.map((transaction) =>
          transaction.id === transactionId
            ? { ...transaction, categoryId, categorySource: 'manual' as const }
            : transaction,
        ),
      };
      if (isMock && demoState.current) {
        commitDemoState({ ...demoState.current, dataset: next }, 'Category saved on this device.');
      } else setData(next);
    });
  }
  async function categoriseMany(transactionIds: string[], categoryId: string) {
    return run(async () => {
      const current = isMock ? demoState.current?.dataset : data;
      const ids = [...new Set(transactionIds)];
      if (
        !current ||
        !ids.length ||
        ids.length > 1000 ||
        !current.categories.some((category) => category.id === categoryId)
      )
        throw new Error('Select between 1 and 1,000 transactions and a category.');
      const ownedIds = new Set(
        current.transactions
          .filter((transaction) => transaction.organisationId === current.organisation.id)
          .map((transaction) => transaction.id),
      );
      if (ids.some((id) => !ownedIds.has(id)))
        throw new Error(
          'The selection no longer belongs to this workspace. Refresh and try again.',
        );
      const requestVersion = version.current;
      const count = isMock ? ids.length : await saveCategories(ids, categoryId);
      const selectedIds = new Set(ids);
      const update = (dataset: FinanceDataset): FinanceDataset => ({
        ...dataset,
        transactions: dataset.transactions.map((transaction) =>
          selectedIds.has(transaction.id)
            ? { ...transaction, categoryId, categorySource: 'manual' as const }
            : transaction,
        ),
      });
      if (isMock && demoState.current) {
        // Retain the sequence, pause setting, and latest simulated balances.
        commitDemoState(
          { ...demoState.current, dataset: update(demoState.current.dataset) },
          `Category saved for ${count} transactions on this device.`,
        );
      } else if (requestVersion === version.current) {
        setData((dataset) =>
          dataset?.organisation.id === current.organisation.id ? update(dataset) : dataset,
        );
      }
      return count;
    });
  }
  async function sync(entityId?: string) {
    if (!data) return;
    return run(async () => {
      if (isMock) {
        advanceDemo(true);
      } else {
        await syncBank(data.organisation.id, entityId);
        await refresh({ background: true });
      }
      return true;
    });
  }
  async function createDemo(name: string) {
    await run(async () => {
      await seedDemo(name);
      await refresh();
    });
  }
  async function createLive(name: string) {
    await run(async () => {
      const id = await createLiveOrganisation(name.trim());
      if (id === organisationId) await refresh();
      else setOrganisationId(id);
    });
  }
  function toggleSimulation() {
    const current = demoState.current;
    if (!current) return;
    const next = { ...current, paused: !current.paused };
    commitDemoState(next, next.paused ? 'Automatic updates paused.' : 'Automatic updates resumed.');
  }
  async function resetDemo() {
    await run(async () => {
      const { createMockDataset } = await import('@clinic-finance/mock-dataset');
      const state = resetDemoState(createMockDataset());
      commitDemoState(state, 'Demo restored to its original fixture.');
      setOrganisations([state.dataset.organisation]);
    });
  }
  return {
    data,
    organisations,
    organisationId,
    setOrganisationId,
    loading,
    busy,
    error,
    simulationPaused,
    lastUpdatedAt,
    simulationMessage,
    refresh,
    categorise,
    categoriseMany,
    sync,
    createDemo,
    createLive,
    toggleSimulation,
    resetDemo,
  };
}
