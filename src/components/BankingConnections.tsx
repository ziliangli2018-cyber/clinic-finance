import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, CircleHelp, ExternalLink, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BankingStatus } from '../types/domain';
import {
  bankingConsentUrl,
  disconnectBank,
  loadBankingStatus,
  type BankingAction,
} from '../services/finance';

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
  workspaceBusy,
  enabled,
  onRefresh,
  onDisconnected,
}: {
  organisationId: string;
  workspaceBusy: boolean;
  enabled: boolean;
  onRefresh: () => Promise<void>;
  onDisconnected: () => Promise<void>;
}) {
  const [status, setStatus] = useState<BankingStatus | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const requestVersion = useRef(0);
  const actionRunning = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const refreshStatus = useCallback(async () => {
    if (!enabled) return;
    const current = ++requestVersion.current;
    setChecking(true);
    setError('');
    try {
      const result = await loadBankingStatus(organisationId);
      if (current === requestVersion.current) setStatus(result);
    } catch (caught) {
      if (current === requestVersion.current) {
        setStatus(null);
        setError(caught instanceof Error ? caught.message : 'Unable to check bank connections.');
      }
    } finally {
      if (current === requestVersion.current) setChecking(false);
    }
  }, [enabled, organisationId]);

  useEffect(() => {
    void refreshStatus();
    const onFocus = () => {
      if (!actionRunning.current) void refreshStatus();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      requestVersion.current += 1;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshStatus]);

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
      const url = await bankingConsentUrl(organisationId, action);
      // Never retain the short-lived consent token in this app's URL or browser storage.
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open bank consent.');
      actionRunning.current = false;
      setBusy(false);
    }
  }

  async function disconnect() {
    if (actionRunning.current || workspaceBusy) return;
    actionRunning.current = true;
    setBusy(true);
    setError('');
    try {
      await disconnectBank(organisationId);
      setConfirmDisconnect(false);
      await onDisconnected();
      await refreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to disconnect banking.');
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  }

  const unavailable = !enabled || !status?.configured;
  const locked = busy || checking || workspaceBusy;
  const hasConnection = Boolean(status?.connections.length);
  const needsReauthorisation = status?.connectionState === 'consent_required';
  const needsRenewal = renewalDue(status?.consentExpiresAt ?? null);

  return (
    <section className="panel banking-panel">
      <div className="panel-heading">
        <div>
          <h2>Connected banking</h2>
          <p>NAB and BOQ Specialist · secured by Basiq Open Banking</p>
        </div>
        {status?.connectionState === 'active' && <ShieldCheck size={20} />}
      </div>
      <div className="settings-body">
        <div className="banking-status-summary">
          <span className="bank-symbol">
            <Building2 size={21} />
          </span>
          <div>
            <strong>
              {checking
                ? 'Checking connections…'
                : status
                  ? stateLabels[status.connectionState]
                  : 'Connection unavailable'}
            </strong>
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
            onClick={() => void refreshStatus()}
          >
            <RefreshCw size={15} />
            Check status
          </button>
          {status?.connectionState === 'active' && (
            <button className="button secondary" disabled={locked} onClick={() => void onRefresh()}>
              Refresh data
            </button>
          )}
          {hasConnection && (
            <button
              className="text-button banking-remove"
              disabled={locked}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect all and remove imported data
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
        aria-labelledby="disconnect-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setConfirmDisconnect(false);
        }}
        onClose={() => {
          if (!busy) setConfirmDisconnect(false);
        }}
      >
        <h2 id="disconnect-title">Disconnect every bank?</h2>
        <p>
          This revokes access and permanently removes imported accounts and transactions from this
          workspace, including their manual category assignments.
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
            {busy ? 'Removing bank data…' : 'Disconnect and remove data'}
          </button>
        </div>
      </dialog>
    </section>
  );
}
