import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceDataset, Organisation } from '../types/domain';
import { advanceDemoDataset } from '../domain/simulation';
import { isMock } from '../services/supabase';
import {
  loadDemoState,
  resetDemoState,
  saveDemoState,
  type DemoState,
} from '../services/demo-storage';
import {
  listOrganisations,
  loadDataset,
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
  const version = useRef(0);
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
  const refresh = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      if ((import.meta.env.VITE_DATA_MODE || 'mock') === 'mock') {
        const { createMockDataset } = await import('../domain/mock');
        const state = loadDemoState(createMockDataset());
        if (current !== version.current) return;
        demoState.current = state;
        setData(state.dataset);
        setSimulationPaused(state.paused);
        setLastUpdatedAt(state.lastUpdatedAt);
        setOrganisations([state.dataset.organisation]);
      } else {
        const orgs = await listOrganisations();
        const selected = orgs.find((org) => org.id === organisationId) || orgs[0];
        const dataset = selected ? await loadDataset(selected) : null;
        if (current !== version.current) return;
        setOrganisations(orgs);
        setData(dataset);
      }
    } catch (error) {
      if (current === version.current)
        setError(error instanceof Error ? error.message : 'Could not load your workspace');
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [organisationId]);
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
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to complete this action');
    } finally {
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
  async function sync() {
    if (!data) return;
    await run(async () => {
      if (isMock) {
        advanceDemo(true);
      } else {
        await syncBank(data.organisation.id);
        await refresh();
      }
    });
  }
  async function createDemo(name: string) {
    await run(async () => {
      await seedDemo(name);
      await refresh();
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
      const { createMockDataset } = await import('../domain/mock');
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
    sync,
    createDemo,
    toggleSimulation,
    resetDemo,
  };
}
