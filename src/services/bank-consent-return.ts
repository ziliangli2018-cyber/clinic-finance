export const BANK_CONSENT_RETURN_KEY = 'clinic-finance.bank-consent-return';
export const BANK_CONSENT_RETURN_MAX_AGE_MS = 30 * 60_000;

export interface BankConsentReturn {
  organisationId: string;
  entityId: string;
  startedAt: number;
}

export interface ConsentReturnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function browserStorage(storage?: ConsentReturnStorage | null) {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Remember where to import after consent. Tokens, URLs and account details never enter storage. */
export function rememberBankConsentReturn(
  organisationId: string,
  entityId: string,
  storage?: ConsentReturnStorage | null,
  now = Date.now(),
): boolean {
  const target = browserStorage(storage);
  if (!target || !uuid.test(organisationId) || !uuid.test(entityId) || !Number.isFinite(now))
    return false;
  const marker: BankConsentReturn = { organisationId, entityId, startedAt: now };
  try {
    target.setItem(BANK_CONSENT_RETURN_KEY, JSON.stringify(marker));
    return true;
  } catch {
    return false;
  }
}

export function pendingBankConsentReturn(
  storage?: ConsentReturnStorage | null,
  now = Date.now(),
): BankConsentReturn | null {
  const target = browserStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(BANK_CONSENT_RETURN_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const marker = value as Record<string, unknown>;
      if (
        Object.keys(marker).length === 3 &&
        typeof marker.organisationId === 'string' &&
        uuid.test(marker.organisationId) &&
        typeof marker.entityId === 'string' &&
        uuid.test(marker.entityId) &&
        typeof marker.startedAt === 'number' &&
        Number.isFinite(marker.startedAt) &&
        marker.startedAt <= now &&
        now - marker.startedAt < BANK_CONSENT_RETURN_MAX_AGE_MS
      )
        return marker as unknown as BankConsentReturn;
    }
    target.removeItem(BANK_CONSENT_RETURN_KEY);
  } catch {
    // Storage may be unavailable. Consent still works without a remembered return destination.
  }
  return null;
}

/** A completion in another workspace/entity cannot erase this entity's pending consent. */
export function clearBankConsentReturn(
  organisationId: string,
  entityId: string,
  storage?: ConsentReturnStorage | null,
): boolean {
  const target = browserStorage(storage);
  if (!target) return false;
  const marker = pendingBankConsentReturn(target);
  if (!marker || marker.organisationId !== organisationId || marker.entityId !== entityId)
    return false;
  try {
    target.removeItem(BANK_CONSENT_RETURN_KEY);
    return true;
  } catch {
    return false;
  }
}
