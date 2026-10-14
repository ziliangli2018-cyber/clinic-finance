import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Building2, CircleHelp, ExternalLink, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BankingStatus } from '../types/domain';
import { bankingConnectionAttention } from '../domain/banking';
import {
  bankingConsentUrl,
  disconnectBank,
  loadBankingStatus,
  type BankingAction,
} from '../services/finance';
import {
  clearBankConsentReturn,
  pendingBankConsentReturn,
  rememberBankConsentReturn,
} from '../services/bank-consent-return';

const initialImportWaitMs = 120_000;
let initialImportOwner: string | null = null;

const stateLabels: Record<BankingStatus['connectionState'], string> = {
  not_connected: 'No bank connected',
  pending: 'Connection in progress',
  active: 'Connected',
  error: 'Connection needs attention',
  consent_required: 'Consent renewal required',
};

function timestamp(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-AU', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Australia/Brisbane',
      }).format(new Date(value))
    : 'Not yet';
}

function renewalDue(value: string | null) {
  return value !== null && Date.parse(value) - Date.now() < 30 * 86_400_000;
}

export function BankingConnections({
  organisationId,
  entityId,
  entityName,
  entityKind,
  workspaceBusy,
  enabled,
  onRefresh,
  onDisconnected,
}: {
  organisationId: string;
  entityId: string;
  entityName: string;
  entityKind: 'clinic' | 'group';
  workspaceBusy: boolean;
  enabled: boolean;
  onRefresh: () => Promise<boolean>;
  onDisconnected: () => Promise<void>;
}) {
  const [status, setStatus] = useState<BankingStatus | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const requestVersion = useRef(0);
  const actionRunning = useRef(false);
  const consentHandoff = useRef(false);
  const statusRunning = useRef(false);
  const initialImportStartedAt = useRef<number | null>(null);
  const initialImportComplete = useRef(false);
  const retryTimer = useRef<number | null>(null);
  const refreshCallback = useRef(onRefresh);
  const workspaceBusyRef = useRef(workspaceBusy);
  const checkCallback = useRef<() => Promise<void>>(async () => {});
  const scopeKey = `${organisationId}:${entityId}`;
  const dialog = useRef<HTMLDialogElement>(null);
  const disconnectTitleId = useId();

  useEffect(() => {
    refreshCallback.current = onRefresh;
    workspaceBusyRef.current = workspaceBusy;
  }, [onRefresh, workspaceBusy]);

  const refreshStatus = useCallback(async () => {
    if (!enabled || statusRunning.current || actionRunning.current) return;
    statusRunning.current = true;
    const current = ++requestVersion.current;
    setChecking(true);
    const releaseInitialImport = () => {
      if (initialImportOwner === scopeKey) initialImportOwner = null;
    };
    const retry = () => {
      if (current !== requestVersion.current) return;
      if (Date.now() - (initialImportStartedAt.current ?? Date.now()) >= initialImportWaitMs) {
        releaseInitialImport();
        clearBankConsentReturn(organisationId, entityId);
        setImportMessage('');
        setError('The first bank import is still pending. Check the connection and retry below.');
        return;
      }
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => void checkCallback.current(), 5_000);
    };
    try {
      const result = await loadBankingStatus(organisationId, entityId);
      if (current !== requestVersion.current) return;
      setStatus(result);
      setChecking(false);
      const marker = pendingBankConsentReturn();
      const returning = marker?.organisationId === organisationId && marker.entityId === entityId;
      const firstImport = !result.lastSyncedAt && !initialImportComplete.current;
      if (!result.configured || (!returning && (marker || !firstImport))) {
        releaseInitialImport();
        if (!result.configured) clearBankConsentReturn(organisationId, entityId);
        return;
      }
      if (
        result.connectionState !== 'active' &&
        (!returning || !['pending', 'not_connected'].includes(result.connectionState))
      ) {
        releaseInitialImport();
        clearBankConsentReturn(organisationId, entityId);
        return;
      }
      initialImportStartedAt.current ??= Date.now();
      if (Date.now() - initialImportStartedAt.current >= initialImportWaitMs) {
        releaseInitialImport();
        clearBankConsentReturn(organisationId, entityId);
        setImportMessage('');
        setError('The first bank import is still pending. Check the connection and retry below.');
        return;
      }
      if (result.connectionState !== 'active') {
        setImportMessage('Waiting for your bank to prepare balances and transactions…');
        retry();
        return;
      }
      if (
        workspaceBusyRef.current ||
        (initialImportOwner !== null && initialImportOwner !== scopeKey)
      ) {
        retry();
        return;
      }
      initialImportOwner = scopeKey;
      actionRunning.current = true;
      setBusy(true);
      setImportMessage('Importing your bank balances and transactions…');
      const imported = await refreshCallback.current();
      if (current !== requestVersion.current) return;
      if (imported) {
        initialImportComplete.current = true;
        clearBankConsentReturn(organisationId, entityId);
        releaseInitialImport();
        setError('');
        setImportMessage('Bank balances and transactions imported.');
        const updated = await loadBankingStatus(organisationId, entityId);
        if (current === requestVersion.current) setStatus(updated);
      } else {
        setError('Your first bank import has not completed yet. Checking again shortly.');
        retry();
      }
    } catch (caught) {
      if (current === requestVersion.current) {
        setError(caught instanceof Error ? caught.message : 'Unable to check bank connections.');
        releaseInitialImport();
        clearBankConsentReturn(organisationId, entityId);
        setImportMessage('');
      }
    } finally {
      if (current === requestVersion.current) {
        statusRunning.current = false;
        actionRunning.current = false;
        setChecking(false);
        setBusy(false);
      }
    }
  }, [enabled, entityId, organisationId, scopeKey]);

  useEffect(() => {
    checkCallback.current = refreshStatus;
    initialImportStartedAt.current = null;
    initialImportComplete.current = false;
    statusRunning.current = false;
    actionRunning.current = false;
    void refreshStatus();
    const onFocus = () => {
      if (consentHandoff.current) {
        consentHandoff.current = false;
        actionRunning.current = false;
        setBusy(false);
      }
      if (!actionRunning.current) void refreshStatus();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      requestVersion.current += 1;
      statusRunning.current = false;
      actionRunning.current = false;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      if (initialImportOwner === scopeKey) initialImportOwner = null;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshStatus, scopeKey]);

  useEffect(() => {
    if (confirmDisconnect) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirmDisconnect]);

  async function consent(action: Exclude<BankingAction, 'status' | 'disconnect'>) {
    if (!enabled || !status?.configured || actionRunning.current || workspaceBusy) return;
    actionRunning.current = true;
    setBusy(true);
    setError('');
    try {
      const url = await bankingConsentUrl(organisationId, entityId, action);
      // Never retain the short-lived consent token in this app's URL or browser storage.
      rememberBankConsentReturn(organisationId, entityId);
      consentHandoff.current = true;
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open bank consent.');
      actionRunning.current = false;
      setBusy(false);
    }
  }

  async function refreshData() {
    if (actionRunning.current || workspaceBusy || !status?.configured) return;
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    const current = requestVersion.current;
    actionRunning.current = true;
    setBusy(true);
    setError('');
    try {
      const imported = await refreshCallback.current();
      if (current !== requestVersion.current) return;
      if (imported) {
        initialImportComplete.current = true;
        clearBankConsentReturn(organisationId, entityId);
        setImportMessage('Bank balances and transactions updated.');
      } else setError('Bank data could not be updated yet. Check the connection and retry.');
    } catch (caught) {
      if (current === requestVersion.current)
        setError(caught instanceof Error ? caught.message : 'Unable to refresh bank data.');
    } finally {
      if (current === requestVersion.current) {
        actionRunning.current = false;
        if (initialImportOwner === scopeKey) initialImportOwner = null;
        setBusy(false);
        await refreshStatus();
      }
    }
  }

  async function disconnect() {
    if (actionRunning.current || workspaceBusy) return;
    const current = requestVersion.current;
    actionRunning.current = true;
    setBusy(true);
    setError('');
    try {
      await disconnectBank(organisationId, entityId);
      clearBankConsentReturn(organisationId, entityId);
      initialImportStartedAt.current = null;
      initialImportComplete.current = false;
      setImportMessage('');
      setConfirmDisconnect(false);
      await onDisconnected();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to disconnect banking.');
    } finally {
      if (current === requestVersion.current) {
        actionRunning.current = false;
        setBusy(false);
        await refreshStatus();
      }
    }
  }

  const unavailable = !enabled || !status?.configured;
  const locked = busy || checking || workspaceBusy;
  const hasConnection = Boolean(status?.connections.length);
  const { needsReauthorisation, hasError: hasConnectionError } = bankingConnectionAttention(status);
  const needsRenewal = renewalDue(status?.consentExpiresAt ?? null);
  const statusLabel = needsReauthorisation
    ? stateLabels.consent_required
    : hasConnectionError
      ? stateLabels.error
      : status
        ? stateLabels[status.connectionState]
        : 'Connection unavailable';

  return (
    <section className="panel banking-panel">
      <div className="panel-heading">
        <div>
          <h2>{entityName} banking</h2>
          <p>Separate legal-entity consent · secured by Basiq Open Banking</p>
        </div>
        {status?.connectionState === 'active' && !needsReauthorisation && !hasConnectionError && (
          <ShieldCheck size={20} />
        )}
      </div>
      <div className="settings-body">
        <div className="banking-status-summary">
          <span className="bank-symbol">
            <Building2 size={21} />
          </span>
          <div>
            <strong>{checking ? 'Checking connections…' : statusLabel}</strong>
            <span>Balances show the last successful provider sync, not a live payment feed.</span>
          </div>
        </div>

        {status?.connections.map((connection) => (
          <div className="connection-row" key={connection.id}>
            <span className="bank-symbol">
              <Building2 size={21} />
            </span>
            <div>
              <strong>{connection.institutionName}</strong>
              <span>
                {connection.state.replace('_', ' ')} · synced {timestamp(connection.lastSyncedAt)}
              </span>
            </div>
            {connection.state === 'active' && <ShieldCheck size={18} />}
          </div>
        ))}

        {unavailable && !checking && (
          <p className="banking-notice">
            {!enabled
              ? 'The public demo never requests bank access.'
              : status?.reason ||
                'Basiq production onboarding and server configuration must be completed before bank consent can start.'}
          </p>
        )}
        <p className="banking-ownership-note">
          {entityKind === 'group'
            ? 'Connect the BOQ Specialist loan here only if this entity is the legal borrower.'
            : `Select only bank accounts legally owned by ${entityName}.`}
        </p>
        {status && (
          <dl className="banking-details">
            <div>
              <dt>Last successful sync</dt>
              <dd>{timestamp(status.lastSyncedAt)}</dd>
            </div>
            <div>
              <dt>Consent expires</dt>
              <dd>{timestamp(status.consentExpiresAt)}</dd>
            </div>
            <div>
              <dt>Automatic sync</dt>
              <dd>{status.automaticSync ? 'Daily' : 'Not configured'}</dd>
            </div>
          </dl>
        )}

        {error && !confirmDisconnect && (
          <p role="alert" className="banking-error">
            {error}
          </p>
        )}
        {importMessage && <p role="status">{importMessage}</p>}
        <div className="banking-actions">
          <button
            className="button primary"
            disabled={unavailable || locked}
            onClick={() => void consent('connect')}
          >
            {hasConnection ? <Plus size={16} /> : <ExternalLink size={16} />}
            {busy ? 'Please wait…' : hasConnection ? 'Add bank or account' : 'Connect a bank'}
          </button>
          {hasConnection && (
            <button
              className="button secondary"
              disabled={locked}
              onClick={() => void consent('manage')}
            >
              Manage consent
              <ExternalLink size={15} />
            </button>
          )}
          {needsReauthorisation && status?.configured ? (
            <button
              className="button secondary"
              disabled={locked}
              onClick={() => void consent('reauthorise')}
            >
              Reauthorise bank access
              <ExternalLink size={15} />
            </button>
          ) : needsRenewal && status?.configured ? (
            <button
              className="button secondary"
              disabled={locked}
              onClick={() => void consent('extend')}
            >
              Renew consent
              <ExternalLink size={15} />
            </button>
          ) : null}
          <button
            className="button secondary"
            disabled={!enabled || locked}
            onClick={() => {
              initialImportStartedAt.current = null;
              setError('');
              void refreshStatus();
            }}
          >
            <RefreshCw size={15} />
            Check status
          </button>
          {status?.connectionState === 'active' && (
            <button
              className="button secondary"
              disabled={locked}
              onClick={() => void refreshData()}
            >
              Refresh data
            </button>
          )}
          {hasConnection && (
            <button
              className="text-button banking-remove"
              disabled={locked}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect {entityName} and remove its imported data
            </button>
          )}
        </div>
        <div className="method-note">
          <CircleHelp size={18} />
          <p>
            You authorise access on each bank's secure consent screen. This app never receives your
            internet-banking password. New institutions and newly opened accounts can be added
            later.
          </p>
        </div>
      </div>

      <dialog
        ref={dialog}
        className="banking-dialog"
        aria-labelledby={disconnectTitleId}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setConfirmDisconnect(false);
        }}
        onClose={() => {
          if (!busy) setConfirmDisconnect(false);
        }}
      >
        <h2 id={disconnectTitleId}>Disconnect {entityName} banking?</h2>
        <p>
          This revokes this entity's access and permanently removes its imported accounts and
          transactions, including their manual category assignments. Other entities are unaffected.
        </p>
        {error && (
          <p role="alert" className="banking-error">
            {error}
          </p>
        )}
        <div className="banking-actions">
          <button
            className="button secondary"
            disabled={busy || workspaceBusy}
            onClick={() => setConfirmDisconnect(false)}
            autoFocus
          >
            Keep connections
          </button>
          <button
            className="button danger"
            disabled={busy || workspaceBusy}
            onClick={() => void disconnect()}
          >
            {busy ? 'Removing bank data…' : `Disconnect ${entityName}`}
          </button>
        </div>
      </dialog>
    </section>
  );
}
