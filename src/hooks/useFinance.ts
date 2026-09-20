import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceDataset, Organisation } from '../types/domain';
import { isMock } from '../services/supabase';
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
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      if ((import.meta.env.VITE_DATA_MODE || 'mock') === 'mock') {
        const { createMockDataset } = await import('../domain/mock');
        const dataset = createMockDataset();
        if (current !== version.current) return;
        setData(dataset);
        setOrganisations([dataset.organisation]);
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
      setData(
        (previous) =>
          previous && {
            ...previous,
            transactions: previous.transactions.map((transaction) =>
              transaction.id === transactionId
                ? { ...transaction, categoryId, categorySource: 'manual' }
                : transaction,
            ),
          },
      );
    });
  }
  async function sync() {
    if (!data) return;
    await run(async () => {
      if (isMock) {
        setData(
          (previous) =>
            previous && {
              ...previous,
              connections: previous.connections.map((connection) => ({
                ...connection,
                lastSyncedAt: new Date().toISOString(),
              })),
            },
        );
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
  return {
    data,
    organisations,
    organisationId,
    setOrganisationId,
    loading,
    busy,
    error,
    refresh,
    categorise,
    sync,
    createDemo,
  };
}
