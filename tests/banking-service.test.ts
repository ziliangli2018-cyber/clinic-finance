import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/services/supabase', () => ({
  supabase: { functions: { invoke }, rpc },
}));

import {
  assignAccountToEntity,
  bankingConsentUrl,
  createLiveOrganisation,
  disconnectBank,
  loadBankingStatus,
  validateConsentUrl,
} from '../src/services/finance';

const status = {
  configured: true,
  provider: 'basiq',
  connectionState: 'active',
  connections: [
    {
      id: 'connection-one',
      institutionId: 'AU01001',
      institutionName: 'NAB',
      state: 'active',
      lastSyncedAt: '2026-10-06T01:00:00Z',
      consentExpiresAt: '2027-09-01T00:00:00Z',
    },
  ],
  lastSyncedAt: '2026-10-06T01:00:00Z',
  consentExpiresAt: '2027-09-01T00:00:00Z',
  automaticSync: true,
};

beforeEach(() => vi.resetAllMocks());

describe('hosted bank consent boundary', () => {
  it('accepts only the exact HTTPS Basiq consent origin and path', () => {
    expect(validateConsentUrl('https://consent.basiq.io/home?token=synthetic')).toBe(
      'https://consent.basiq.io/home?token=synthetic',
    );
    for (const value of [
      undefined,
      '',
      '/home',
      'javascript:alert(1)',
      'http://consent.basiq.io/home',
      'https://consent.basiq.io.evil.example/home',
      'https://evil.example/home',
      'https://consent.basiq.io:444/home',
      'https://user:password@consent.basiq.io/home',
      'https://consent.basiq.io/home/extra',
      'https://consent.basiq.io/home#token=synthetic',
    ])
      expect(() => validateConsentUrl(value)).toThrow();
  });

  it('does not forward an untrusted redirect from the backend', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://evil.example/home' }, error: null });
    await expect(bankingConsentUrl('owned-org', 'connect')).rejects.toThrow('invalid');
  });

  it('creates a live workspace without demo seeding', async () => {
    rpc.mockResolvedValue({ data: 'owned-org', error: null });
    await expect(createLiveOrganisation('Kilcoy & Burpengary')).resolves.toBe('owned-org');
    expect(rpc).toHaveBeenCalledWith('create_live_organisation', {
      name: 'Kilcoy & Burpengary',
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('bank status and account ownership actions', () => {
  it('validates every connection and scheduling fact', async () => {
    invoke.mockResolvedValue({ data: status, error: null });
    await expect(loadBankingStatus('owned-org')).resolves.toEqual(status);
    invoke.mockResolvedValue({
      data: { ...status, connections: [{ ...status.connections[0], institutionId: 1001 }] },
      error: null,
    });
    await expect(loadBankingStatus('owned-org')).rejects.toThrow('status is unavailable');
  });

  it('does not expose provider error text and requires confirmed disconnection', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('private-provider-detail') });
    await expect(loadBankingStatus('owned-org')).rejects.not.toThrow('private-provider-detail');
    invoke.mockResolvedValue({ data: { disconnected: false }, error: null });
    await expect(disconnectBank('owned-org')).rejects.toThrow('could not be disconnected');
  });

  it('assigns an imported account through a narrow RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await assignAccountToEntity('account-one', 'kilcoy-entity');
    expect(rpc).toHaveBeenCalledWith('set_account_entity', {
      account_id: 'account-one',
      entity_id: 'kilcoy-entity',
    });
  });
});
