import { describe, expect, it } from 'vitest';
import { bankingConnectionAttention } from '../src/domain/banking';
import type { BankingStatus } from '../src/types/domain';

const activeStatus: BankingStatus = {
  entityId: 'kilcoy-entity',
  configured: true,
  provider: 'basiq',
  connectionState: 'active',
  connections: [
    {
      id: 'nab-connection',
      institutionId: 'AU01001',
      institutionName: 'NAB',
      state: 'active',
      lastSyncedAt: '2026-10-10T00:00:00Z',
      consentExpiresAt: '2027-10-10T00:00:00Z',
    },
  ],
  lastSyncedAt: '2026-10-10T00:00:00Z',
  consentExpiresAt: '2027-10-10T00:00:00Z',
  automaticSync: true,
};

describe('banking connection attention', () => {
  it('surfaces an expired connection even while another bank remains active', () => {
    const mixed: BankingStatus = {
      ...activeStatus,
      connections: [
        ...activeStatus.connections,
        {
          id: 'boqs-connection',
          institutionId: 'AU20130',
          institutionName: 'BOQ Specialist',
          state: 'consent_required',
          lastSyncedAt: '2026-10-09T00:00:00Z',
          consentExpiresAt: '2026-10-09T00:00:00Z',
        },
      ],
    };

    expect(bankingConnectionAttention(mixed)).toEqual({
      needsReauthorisation: true,
      hasError: false,
    });
  });

  it('surfaces a failed connection without treating it as expired consent', () => {
    const mixed: BankingStatus = {
      ...activeStatus,
      connections: [
        ...activeStatus.connections,
        {
          ...activeStatus.connections[0],
          id: 'failed-connection',
          state: 'error',
        },
      ],
    };

    expect(bankingConnectionAttention(mixed)).toEqual({
      needsReauthorisation: false,
      hasError: true,
    });
  });
});
