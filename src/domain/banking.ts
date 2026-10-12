import type { BankingStatus } from '../types/domain';

export function bankingConnectionAttention(status: BankingStatus | null) {
  return {
    needsReauthorisation: Boolean(
      status?.connectionState === 'consent_required' ||
      status?.connections.some((connection) => connection.state === 'consent_required'),
    ),
    hasError: Boolean(
      status?.connectionState === 'error' ||
      status?.connections.some((connection) => connection.state === 'error'),
    ),
  };
}
