import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceDataset } from '../types/domain';
import {
  applyCsvImport,
  createCsvDataset,
  CSV_ORGANISATION_ID,
  type CsvImportTarget,
  type CsvRow,
} from '../domain/csv-import';
import {
  clearCsvDataset,
  loadCsvDataset,
  parseCsvBackup,
  saveCsvDataset,
} from '../services/csv-storage';

function importTime(dataset: FinanceDataset): string | null {
  return (
    dataset.connections
      .map((connection) => connection.lastSyncedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  );
}

/** Private local statement data. This hook never simulates transactions or contacts a provider. */
export function useCsvFinance(enabled = true) {
  const [data, setData] = useState<FinanceDataset | null>(null);
  const [organisationId, setOrganisationId] = useState(CSV_ORGANISATION_ID);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [simulationMessage, setSimulationMessage] = useState('');
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const current = useRef<FinanceDataset | null>(null);
  const actionRunning = useRef(false);

  const commit = useCallback((dataset: FinanceDataset, message = '') => {
    // Persist first: a failed import/category change is not shown as successfully saved.
    saveCsvDataset(dataset);
    current.current = dataset;
    setData(dataset);
    setSimulationMessage(message);
  }, []);

  const refresh = useCallback(
    async (_options: { background?: boolean } = {}) => {
      void _options;
      if (!enabled) return;
      setLoading(true);
      setError('');
      try {
        const dataset = loadCsvDataset();
        current.current = dataset;
        setData(dataset);
      } catch (cause) {
        current.current = null;
        setData(null);
        setError(
          cause instanceof Error ? cause.message : 'Your CSV workspace could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run<T>(action: () => T | Promise<T>): Promise<T | undefined> {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    setError('');
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The local change could not be saved.');
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  }

  async function categoriseMany(transactionIds: string[], categoryId: string) {
    return run(() => {
      const dataset = current.current;
      const selected = new Set(transactionIds);
      if (
        !dataset ||
        !selected.size ||
        selected.size > 1000 ||
        !dataset.categories.some((category) => category.id === categoryId)
      )
        throw new Error('Select between 1 and 1,000 imported transactions and a category.');
      const owned = new Set(dataset.transactions.map((transaction) => transaction.id));
      if ([...selected].some((transactionId) => !owned.has(transactionId)))
        throw new Error('The selected transaction no longer belongs to this CSV workspace.');
      commit(
        {
          ...dataset,
          transactions: dataset.transactions.map((transaction) =>
            selected.has(transaction.id)
              ? { ...transaction, categoryId, categorySource: 'manual' as const }
              : transaction,
          ),
        },
        `Category saved for ${selected.size} imported transactions on this device.`,
      );
      return selected.size;
    });
  }

  async function categorise(transactionId: string, categoryId: string) {
    await categoriseMany([transactionId], categoryId);
  }

  async function importRows(rows: CsvRow[], target: CsvImportTarget) {
    return run(() => {
      if (!current.current) throw new Error('Load or restore your CSV workspace before importing.');
      const result = applyCsvImport(current.current, rows, target);
      commit(
        result.dataset,
        `Imported ${result.imported} transactions; skipped ${result.duplicates} duplicates.`,
      );
      return result;
    });
  }

  async function restoreBackup(raw: string): Promise<boolean> {
    const result = await run(() => {
      const dataset = parseCsvBackup(raw);
      commit(dataset, 'CSV account and transaction backup restored on this device.');
      setWorkspaceRevision((revision) => revision + 1);
      return true;
    });
    return result === true;
  }

  async function sync(_entityId?: string) {
    void _entityId;
    return run(() => {
      setSimulationMessage(
        'CSV data is a statement snapshot. Upload another statement to update it.',
      );
      return false;
    });
  }

  async function createDemo(_name: string) {
    void _name;
    await run(() => {
      throw new Error('CSV workspaces cannot create cloud or demo workspaces.');
    });
  }

  async function createLive(_name: string) {
    void _name;
    await run(() => {
      throw new Error('Switch to the bank workspace to create a connected workspace.');
    });
  }

  function toggleSimulation() {
    setSimulationMessage('CSV imports never generate simulated transactions.');
  }

  /** The caller must confirm deletion before calling; cloud and demo data are untouched. */
  async function resetDemo() {
    await run(() => {
      clearCsvDataset();
      const dataset = createCsvDataset();
      current.current = dataset;
      setData(dataset);
      setWorkspaceRevision((revision) => revision + 1);
      setSimulationMessage('Imported accounts and transactions cleared from this device.');
    });
  }

  return {
    data,
    organisations: data ? [data.organisation] : [],
    organisationId,
    setOrganisationId,
    loading,
    busy,
    error,
    simulationPaused: true,
    lastUpdatedAt: data ? importTime(data) : null,
    simulationMessage,
    refresh,
    categorise,
    categoriseMany,
    sync,
    createDemo,
    createLive,
    toggleSimulation,
    resetDemo,
    importRows,
    restoreBackup,
    workspaceRevision,
  };
}
