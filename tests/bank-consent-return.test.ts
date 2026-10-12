import { describe, expect, it } from 'vitest';
import {
  BANK_CONSENT_RETURN_KEY,
  BANK_CONSENT_RETURN_MAX_AGE_MS,
  clearBankConsentReturn,
  pendingBankConsentReturn,
  rememberBankConsentReturn,
  type ConsentReturnStorage,
} from '../src/services/bank-consent-return';

const organisationId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const otherEntityId = '33333333-3333-4333-8333-333333333333';

function memoryStorage(): ConsentReturnStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('bank consent return destination', () => {
  it('retains only non-secret entity scope and time, never a token or URL', () => {
    const storage = memoryStorage();
    expect(rememberBankConsentReturn(organisationId, entityId, storage, 100)).toBe(true);
    expect(JSON.parse(storage.getItem(BANK_CONSENT_RETURN_KEY)!)).toEqual({
      organisationId,
      entityId,
      startedAt: 100,
    });
    expect(pendingBankConsentReturn(storage, 101)).toEqual({
      organisationId,
      entityId,
      startedAt: 100,
    });
    expect(
      rememberBankConsentReturn('https://consent.basiq.io/home?token=secret', entityId, storage),
    ).toBe(false);
    expect(storage.getItem(BANK_CONSENT_RETURN_KEY)).not.toContain('secret');
  });

  it('expires abandoned consent and rejects future or unexpected payloads', () => {
    const storage = memoryStorage();
    rememberBankConsentReturn(organisationId, entityId, storage, 100);
    expect(pendingBankConsentReturn(storage, 100 + BANK_CONSENT_RETURN_MAX_AGE_MS)).toBeNull();
    expect(storage.getItem(BANK_CONSENT_RETURN_KEY)).toBeNull();
    rememberBankConsentReturn(organisationId, entityId, storage, 100);
    expect(pendingBankConsentReturn(storage, 99)).toBeNull();
    storage.setItem(
      BANK_CONSENT_RETURN_KEY,
      JSON.stringify({ organisationId, entityId, startedAt: 100, token: 'secret' }),
    );
    expect(pendingBankConsentReturn(storage, 101)).toBeNull();
    expect(storage.getItem(BANK_CONSENT_RETURN_KEY)).toBeNull();
  });

  it('clears only the workspace and entity that completed its import', () => {
    const storage = memoryStorage();
    rememberBankConsentReturn(organisationId, entityId, storage);
    expect(clearBankConsentReturn(organisationId, otherEntityId, storage)).toBe(false);
    expect(clearBankConsentReturn(otherEntityId, entityId, storage)).toBe(false);
    expect(pendingBankConsentReturn(storage)?.entityId).toBe(entityId);
    expect(clearBankConsentReturn(organisationId, entityId, storage)).toBe(true);
    expect(pendingBankConsentReturn(storage)).toBeNull();
  });

  it('tolerates blocked storage without blocking bank consent', () => {
    const storage: ConsentReturnStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(rememberBankConsentReturn(organisationId, entityId, storage)).toBe(false);
    expect(pendingBankConsentReturn(storage)).toBeNull();
    expect(clearBankConsentReturn(organisationId, entityId, storage)).toBe(false);
  });
});
