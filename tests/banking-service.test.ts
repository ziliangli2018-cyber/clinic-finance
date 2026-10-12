import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/services/supabase', () => ({
  supabase: { functions: { invoke }, rpc },
}));

import {
  bankingConsentUrl,
  createLiveOrganisation,
  disconnectBank,
  loadBankingStatus,
  validateConsentUrl,
} from '../src/services/finance';

const status = {
  entityId: 'kilcoy-entity',
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
    invoke.mockResolvedValue({
      data: { entityId: 'kilcoy-entity', url: 'https://evil.example/home' },
      error: null,
    });
    await expect(bankingConsentUrl('owned-org', 'kilcoy-entity', 'connect')).rejects.toThrow(
      'invalid',
    );
    expect(invoke).toHaveBeenCalledWith('bank-connect', {
      body: { organisationId: 'owned-org', entityId: 'kilcoy-entity', action: 'connect' },
    });
  });

  it('does not forward a consent token issued for another legal entity', async () => {
    invoke.mockResolvedValue({
      data: {
        entityId: 'burpengary-entity',
        url: 'https://consent.basiq.io/home?token=synthetic',
      },
      error: null,
    });
    await expect(bankingConsentUrl('owned-org', 'kilcoy-entity', 'connect')).rejects.toThrow(
      'unavailable',
    );
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

describe('bank status and legal-entity consent actions', () => {
  it('validates every connection and scheduling fact', async () => {
    invoke.mockResolvedValue({ data: status, error: null });
    await expect(loadBankingStatus('owned-org', 'kilcoy-entity')).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith('bank-connect', {
      body: { organisationId: 'owned-org', entityId: 'kilcoy-entity', action: 'status' },
    });
    invoke.mockResolvedValue({
      data: { ...status, connections: [{ ...status.connections[0], institutionId: 1001 }] },
      error: null,
    });
    await expect(loadBankingStatus('owned-org', 'kilcoy-entity')).rejects.toThrow(
      'status is unavailable',
    );
  });

  it('does not expose provider error text and requires confirmed disconnection', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('private-provider-detail') });
    await expect(loadBankingStatus('owned-org', 'kilcoy-entity')).rejects.not.toThrow(
      'private-provider-detail',
    );
    invoke.mockResolvedValue({
      data: { entityId: 'kilcoy-entity', disconnected: false },
      error: null,
    });
    await expect(disconnectBank('owned-org', 'kilcoy-entity')).rejects.toThrow(
      'could not be disconnected',
    );
    expect(invoke).toHaveBeenLastCalledWith('bank-connect', {
      body: { organisationId: 'owned-org', entityId: 'kilcoy-entity', action: 'disconnect' },
    });
  });
});
