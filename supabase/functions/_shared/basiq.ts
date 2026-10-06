import { HttpError } from './http.ts';

export const BASIQ_ORIGIN = 'https://au-api.basiq.io';
const CONSENT_ORIGIN = 'https://consent.basiq.io';
const KNOWN_INSTITUTIONS: Record<string, string> = {
  AU01001: 'NAB',
  AU20130: 'BOQ Specialist',
};
const CATEGORY_IDS = {
  patient: 'c4e5e067-5567-4cf9-a1a7-134d591c1b17',
  healthFund: 'a7858a97-f8bf-450d-a57d-bdc9712b42e7',
  interestIncome: '6f1ea3be-0230-48ec-a74b-45d86d337dee',
  wages: '68d846a3-80bd-4079-a7f5-1f1dde6a6813',
  rent: 'ee0feaa4-c805-4b0a-a585-4a66b4f64614',
  supplies: '389e3b2c-30d8-4896-a9c7-f50ab328519c',
  laboratory: 'e2546575-4560-42cf-a4d1-5d5bf22b9805',
  equipment: 'c8d453c6-5666-48a4-ac39-28e81ee3a896',
  utilities: '24b8e163-6a41-4485-a27b-af51866eb9d3',
  software: 'e692d684-704a-43a6-a538-fd62deba0fb4',
  insurance: 'c8452d4b-d9ce-40b5-a885-d409dbe69f9b',
  bankFees: '31fec648-65b4-417e-a245-6282f83dbcf8',
  marketing: 'f0eb4b9b-7f8b-4541-a0dc-85fd3e33568b',
  loan: '210ec3ae-8e0b-4e4c-a942-e188137d06de',
  tax: '22014f99-6de2-41d7-ac5c-be0313e18529',
  interestExpense: '2f0252c7-c573-46bd-acba-3531ee5cb477',
} as const;

type Json = Record<string, unknown>;
type ConsentAction = 'connect' | 'manage' | 'extend' | 'reauthorise';

export interface BasiqConfig {
  apiKey: string;
  allowedInstitutionIds: string[];
  businessProfile: Json;
  automaticSync: boolean;
}

export interface BankingSnapshot {
  connectionState: 'not_connected' | 'pending' | 'active' | 'error' | 'consent_required';
  consentExpiresAt: string | null;
  connections: Json[];
  accounts: Json[];
  transactions: Json[];
}

function record(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(502, 'Invalid banking response');
  return value as Json;
}

function rows(value: unknown): Json[] {
  const data = record(value).data;
  if (!Array.isArray(data)) throw new HttpError(502, 'Incomplete banking response');
  return data.map(record);
}

export function providerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new HttpError(502, 'Invalid banking identifier');
  return value;
}

function relationId(value: unknown): string {
  return providerId(typeof value === 'object' && value !== null ? record(value).id : value);
}

function institutionId(value: unknown): string {
  const id = typeof value === 'object' && value !== null ? record(value).id : value;
  if (typeof id !== 'string' || !/^AU\d{5}$/.test(id))
    throw new HttpError(502, 'Invalid banking institution');
  return id;
}

export function cents(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HttpError(502, 'Bank amount unavailable');
    const scaled = value * 100;
    if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 1e-7)
      throw new HttpError(502, 'Bank amount has unsupported precision');
    return Math.round(scaled);
  }
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value))
    throw new HttpError(502, 'Bank amount unavailable');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new HttpError(502, 'Bank amount outside supported range');
  return Number(negative ? -amount : amount);
}

function optionalCents(value: unknown): number | null {
  return value === undefined || value === null ? null : cents(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new HttpError(502, 'Bank date unavailable');
  return new Date(value).toISOString();
}

function optionalTimestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return timestamp(value);
}

export function postedDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value))
    throw new HttpError(502, 'Posted bank date unavailable');
  const date = value.slice(0, 10);
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new HttpError(502, 'Invalid posted bank date');
  return date;
}

export function transactionAmount(row: Json): number {
  const amount = cents(row.amount);
  if (row.direction !== undefined) {
    if (
      !['debit', 'credit'].includes(String(row.direction)) ||
      (row.direction === 'debit' && amount > 0) ||
      (row.direction === 'credit' && amount < 0)
    )
      throw new HttpError(502, 'Inconsistent bank transaction direction');
  }
  return amount;
}

export function classifyTransaction(
  description: string,
  amountCents: number,
): { category_id: string | null; category_source: 'rule' | 'uncategorised' } {
  const value = description.toUpperCase();
  const rules: Array<['positive' | 'negative', RegExp, string]> = [
    ['positive', /HICAPS|HEALTH FUND|INSURANCE SETTLEMENT/, CATEGORY_IDS.healthFund],
    ['positive', /TYRO SETTLEMENT|PATIENT|EFTPOS SETTLEMENT/, CATEGORY_IDS.patient],
    ['negative', /PAYROLL|WAGES|SUPERANNUATION/, CATEGORY_IDS.wages],
    ['negative', /RENT|LEASE/, CATEGORY_IDS.rent],
    ['negative', /DENTAL.*SUPPL|CONSUMABLE/, CATEGORY_IDS.supplies],
    ['negative', /DENTAL.*LAB|LABORATORY/, CATEGORY_IDS.laboratory],
    ['negative', /EQUIPMENT|AUTOCLAVE|MAINTENANCE|REPAIR/, CATEGORY_IDS.equipment],
    ['negative', /ELECTRIC|ENERGY|INTERNET|PHONE|WATER/, CATEGORY_IDS.utilities],
    ['negative', /SOFTWARE|SUBSCRIPTION|CLOUD/, CATEGORY_IDS.software],
    ['negative', /INSURANCE|INDEMNITY/, CATEGORY_IDS.insurance],
    ['negative', /MERCHANT FEE|BANK FEE|ACCOUNT FEE/, CATEGORY_IDS.bankFees],
    ['negative', /ADVERTIS|MARKETING|SEARCH ADS/, CATEGORY_IDS.marketing],
    ['negative', /LOAN.*(PAYMENT|REPAYMENT)|REPAYMENT.*LOAN/, CATEGORY_IDS.loan],
    ['negative', /\bATO\b|\bGST\b|TAX PAYMENT/, CATEGORY_IDS.tax],
  ];
  if (/INTEREST/.test(value))
    return {
      category_id: amountCents >= 0 ? CATEGORY_IDS.interestIncome : CATEGORY_IDS.interestExpense,
      category_source: 'rule',
    };
  const sign = amountCents > 0 ? 'positive' : amountCents < 0 ? 'negative' : null;
  const match = sign
    ? rules.find(([requiredSign, pattern]) => requiredSign === sign && pattern.test(value))
    : null;
  return match
    ? { category_id: match[2], category_source: 'rule' }
    : { category_id: null, category_source: 'uncategorised' };
}

function safeNext(value: unknown, userId: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(502, 'Invalid banking page');
  const url = new URL(value, BASIQ_ORIGIN);
  if (
    url.origin !== BASIQ_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.startsWith(`/users/${providerId(userId)}/`)
  )
    throw new HttpError(502, 'Unsafe banking page');
  return url.href;
}

export async function stableId(organisationId: string, external: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`basiq:${organisationId}:${external}`),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function businessProfile(value: unknown): Json {
  const profile = record(value);
  const address = record(profile.businessAddress);
  const id = String(profile.businessIdNo ?? '').replace(/\s/g, '');
  const type = profile.businessIdNoType;
  if (
    typeof profile.businessName !== 'string' ||
    !profile.businessName.trim() ||
    !((type === 'ABN' && /^\d{11}$/.test(id)) || (type === 'ACN' && /^\d{9}$/.test(id))) ||
    profile.verificationStatus !== true ||
    typeof profile.verificationDate !== 'string' ||
    !/^\d{2}\/\d{2}\/\d{4}$/.test(profile.verificationDate) ||
    !['addressLine1', 'suburb', 'state', 'postcode'].every(
      (key) => typeof address[key] === 'string' && String(address[key]).trim(),
    ) ||
    address.countryCode !== 'AUS'
  )
    throw new HttpError(503, 'Verified business onboarding configuration required');
  return {
    businessName: profile.businessName.trim(),
    businessIdNo: id,
    businessIdNoType: type,
    businessAddress: address,
    verificationStatus: true,
    verificationDate: profile.verificationDate,
  };
}

export function basiqConfig(): BasiqConfig | null {
  if (
    Deno.env.get('APP_ENV') !== 'production' ||
    Deno.env.get('ALLOW_MOCK_DATA') !== 'false' ||
    Deno.env.get('BASIQ_ENABLED') !== 'true' ||
    Deno.env.get('BASIQ_BUSINESS_ONBOARDING_APPROVED') !== 'true'
  )
    return null;
  const apiKey = Deno.env.get('BASIQ_API_KEY');
  const rawIds = Deno.env.get('BASIQ_ALLOWED_INSTITUTION_IDS');
  if (!apiKey || !rawIds) return null;
  const allowedInstitutionIds = [...new Set(rawIds.split(',').map((value) => value.trim()))];
  if (!allowedInstitutionIds.length || allowedInstitutionIds.some((id) => !/^AU\d{5}$/.test(id)))
    return null;
  try {
    return {
      apiKey,
      allowedInstitutionIds,
      businessProfile: businessProfile(
        JSON.parse(Deno.env.get('BASIQ_BUSINESS_PROFILE') ?? 'null'),
      ),
      automaticSync: Deno.env.get('BASIQ_AUTOMATIC_SYNC') === 'true',
    };
  } catch {
    return null;
  }
}

function accountKind(
  value: unknown,
): 'operating' | 'savings' | 'credit_card' | 'transaction' | 'loan' | 'mortgage' | 'term_deposit' {
  const type = String(record(value).type ?? '')
    .toLowerCase()
    .replace(/_/g, '-');
  const mapped: Record<string, ReturnType<typeof accountKind>> = {
    transaction: 'transaction',
    operating: 'operating',
    savings: 'savings',
    'credit-card': 'credit_card',
    loan: 'loan',
    mortgage: 'mortgage',
    'term-deposit': 'term_deposit',
  };
  const kind = mapped[type];
  if (!kind) throw new HttpError(422, `Unsupported bank account class: ${type || 'unknown'}`);
  return kind;
}

function institutionName(row: Json, id: string): string {
  const institution = row.institution;
  if (institution && typeof institution === 'object') {
    const details = record(institution);
    const candidate = details.shortName ?? details.name;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 120);
  }
  return KNOWN_INSTITUTIONS[id] ?? `Institution ${id}`;
}

function merchantName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().slice(0, 500) || null;
  if (value && typeof value === 'object') {
    const merchant = record(value);
    for (const candidate of [merchant.businessName, merchant.name])
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 500);
  }
  return null;
}

function maskedAccountNumber(account: Json): string {
  if (
    typeof account.maskedNumber === 'string' &&
    account.maskedNumber.trim() &&
    account.maskedNumber.length <= 100 &&
    /[*xX•]/.test(account.maskedNumber)
  )
    return account.maskedNumber.trim();
  // Some Basiq responses expose accountNo but omit maskedNumber. Retain only
  // the final four characters; the unmasked value is never persisted or logged.
  if (typeof account.accountNo === 'string' && account.accountNo.trim()) {
    const ending = account.accountNo.replace(/\s/g, '').slice(-4);
    if (/^[A-Za-z0-9]{1,4}$/.test(ending)) return `•••• ${ending}`;
  }
  throw new HttpError(502, 'Masked bank account number unavailable');
}

/** Strict Basiq v3 transport. Provider bodies and credentials never reach logs or browser errors. */
export class Basiq {
  private cached?: { value: string; expires: number };
  private issuing?: Promise<string>;

  constructor(
    readonly config: BasiqConfig,
    private fetcher: typeof fetch = fetch,
    private now = () => Date.now(),
  ) {}

  private async send(url: string, init: RequestInit): Promise<unknown> {
    let result: Response;
    try {
      result = await this.fetcher(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new HttpError(503, 'Banking provider unavailable; please try again later');
    }
    if (!result.ok)
      throw new HttpError(
        result.status === 429 ? 429 : 502,
        result.status === 429
          ? 'Bank refresh limit reached; please try again later'
          : 'Banking provider request failed',
      );
    if (result.status === 204) return null;
    const raw = await result.text();
    if (raw.length > 8_000_000) throw new HttpError(502, 'Banking response too large');
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(502, 'Invalid banking response');
    }
  }

  private async issue(
    scope: 'SERVER_ACCESS' | 'CLIENT_ACCESS',
    userId?: string,
  ): Promise<{ value: string; expires: number }> {
    const body = new URLSearchParams({ scope });
    if (userId) body.set('userId', providerId(userId));
    const data = record(
      await this.send(`${BASIQ_ORIGIN}/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.config.apiKey}`,
          'basiq-version': '3.0',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }),
    );
    if (
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      data.token_type !== 'Bearer' ||
      typeof data.expires_in !== 'number' ||
      data.expires_in < 60 ||
      data.expires_in > 7200
    )
      throw new HttpError(502, 'Invalid banking token response');
    return {
      value: data.access_token,
      expires: this.now() + data.expires_in * 1000 - 30_000,
    };
  }

  private token(): Promise<string> {
    if (this.cached && this.cached.expires > this.now()) return Promise.resolve(this.cached.value);
    if (!this.issuing)
      this.issuing = this.issue('SERVER_ACCESS')
        .then((token) => {
          this.cached = token;
          return token.value;
        })
        .finally(() => {
          this.issuing = undefined;
        });
    return this.issuing;
  }

  private async api(path: string, method = 'GET', body?: Json): Promise<unknown> {
    const url = new URL(path, BASIQ_ORIGIN);
    if (url.origin !== BASIQ_ORIGIN || url.username || url.password || url.hash)
      throw new HttpError(502, 'Unsafe banking request');
    return this.send(url.href, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'basiq-version': '3.0',
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  private async all(path: string, userId: string): Promise<Json[]> {
    let next: string | null = new URL(path, BASIQ_ORIGIN).href;
    const output: Json[] = [];
    const pages = new Set<string>();
    while (next) {
      if (pages.has(next) || pages.size >= 200)
        throw new HttpError(502, 'Banking history exceeds safe import limits');
      pages.add(next);
      const page = record(await this.api(next));
      output.push(...rows(page));
      next = safeNext(record(page.links ?? {}).next, userId);
    }
    return output;
  }

  async createUser(email: string): Promise<string> {
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320)
      throw new HttpError(400, 'A verified account email is required');
    return providerId(
      record(await this.api('/users', 'POST', { email, ...this.config.businessProfile })).id,
    );
  }

  async consentUrl(userId: string, action: ConsentAction): Promise<string> {
    const token = await this.issue('CLIENT_ACCESS', userId);
    const url = new URL('/home', CONSENT_ORIGIN);
    url.searchParams.set('token', token.value);
    url.searchParams.set('action', action);
    return url.href;
  }

  async refreshUser(userId: string): Promise<void> {
    const result = await this.api(`/users/${providerId(userId)}/connections/refresh`, 'POST');
    const payload = result && typeof result === 'object' ? record(result) : {};
    const candidates = Array.isArray(payload.data) ? payload.data.map(record) : [payload];
    const jobIds = candidates
      .map((candidate) => candidate.id)
      .filter((id): id is string => typeof id === 'string')
      .map(providerId);
    if (!jobIds.length) return;
    const deadline = Date.now() + 25_000;
    const pending = new Set(jobIds);
    while (pending.size && Date.now() < deadline) {
      for (const id of [...pending]) {
        const job = record(await this.api(`/jobs/${id}`));
        const states = Array.isArray(job.steps)
          ? job.steps.map((step) => String(record(step).status).toLowerCase())
          : [String(job.status ?? job.state).toLowerCase()];
        if (states.some((state) => ['failed', 'error', 'cancelled'].includes(state)))
          throw new HttpError(502, 'Bank refresh did not complete');
        if (
          states.length > 0 &&
          states.every((state) => ['success', 'succeeded', 'complete', 'completed'].includes(state))
        )
          pending.delete(id);
      }
      if (pending.size) await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (pending.size)
      throw new HttpError(503, 'Bank refresh is still processing; check again shortly');
  }

  private async providerConnections(userId: string): Promise<Json[]> {
    return this.all(`/users/${providerId(userId)}/connections`, userId);
  }

  private async consentState(userId: string): Promise<{
    hasConsent: boolean;
    valid: boolean;
    expiry: string | null;
  }> {
    const consents = await this.all(`/users/${providerId(userId)}/consents`, userId);
    const active = consents.filter(
      (consent) =>
        consent.status === 'active' &&
        typeof consent.expiryDate === 'string' &&
        Date.parse(consent.expiryDate) > this.now(),
    );
    const required = new Set(['account.basic', 'account.detail', 'transaction.detail']);
    const eligible = active.filter((consent) => {
      const data = record(consent.data);
      if (!Array.isArray(data.permissions)) return false;
      const granted = new Set(
        data.permissions
          .map(record)
          .filter((permission) => permission.consented === true)
          .map((permission) => String(permission.scope)),
      );
      return [...required].every((scope) => granted.has(scope));
    });
    const expiries = eligible.map((consent) => timestamp(consent.expiryDate)).sort();
    return {
      hasConsent: consents.length > 0,
      valid: eligible.length > 0,
      expiry: expiries[0] ?? null,
    };
  }

  async status(userId: string, organisationId: string): Promise<BankingSnapshot> {
    const allowed = new Set(this.config.allowedInstitutionIds);
    const [providerConnections, consent] = await Promise.all([
      this.providerConnections(userId),
      this.consentState(userId),
    ]);
    const connections: Json[] = [];
    for (const connection of providerConnections) {
      const externalId = providerId(connection.id);
      const bankId = institutionId(connection.institution);
      if (!allowed.has(bankId))
        throw new HttpError(422, 'A connected institution is not approved for this workspace');
      const method = String(connection.method).toLowerCase().replace(/_/g, '-');
      if (!['open-banking', 'openbanking'].includes(method))
        throw new HttpError(422, 'Only Open Banking connections are accepted');
      const providerState = String(connection.status).toLowerCase();
      const state = ['active'].includes(providerState)
        ? 'active'
        : ['pending', 'pre-init', 'init'].includes(providerState)
          ? 'pending'
          : ['invalid', 'expired', 'revoked'].includes(providerState)
            ? 'consent_required'
            : 'error';
      const expiry = optionalTimestamp(connection.expiryDate);
      connections.push({
        id: await stableId(organisationId, `connection:${userId}:${externalId}`),
        provider_connection_id: externalId,
        institution_id: bankId,
        institution_name: institutionName(connection, bankId),
        status: state,
        last_synced_at: optionalTimestamp(connection.lastUpdated),
        consent_expires_at: expiry,
      });
    }
    const states = connections.map((connection) => String(connection.status));
    let connectionState: BankingSnapshot['connectionState'] = states.includes('active')
      ? 'active'
      : states.includes('pending')
        ? 'pending'
        : states.includes('consent_required')
          ? 'consent_required'
          : states.length
            ? 'error'
            : 'not_connected';
    if (!consent.valid && (consent.hasConsent || states.length))
      connectionState = 'consent_required';
    const expiries = connections
      .map((connection) => connection.consent_expires_at)
      .filter((value): value is string => typeof value === 'string')
      .sort();
    if (consent.expiry) expiries.push(consent.expiry);
    expiries.sort();
    return {
      connectionState,
      consentExpiresAt: expiries[0] ?? null,
      connections,
      accounts: [],
      transactions: [],
    };
  }

  async snapshot(userId: string, organisationId: string): Promise<BankingSnapshot> {
    const result = await this.status(userId, organisationId);
    const active = result.connections.filter((connection) => connection.status === 'active');
    if (!active.length) return result;
    const externalConnections = new Map(
      active.map((connection) => [String(connection.provider_connection_id), connection]),
    );
    const providerAccounts = await this.all(`/users/${providerId(userId)}/accounts`, userId);
    const accountIds = new Map<string, string>();
    for (const account of providerAccounts) {
      const externalAccount = providerId(account.id);
      const externalConnection = relationId(account.connection);
      const connection = externalConnections.get(externalConnection);
      if (!connection) continue;
      const bankId = institutionId(account.institution);
      if (bankId !== connection.institution_id || account.currency !== 'AUD')
        throw new HttpError(502, 'Unexpected bank account scope or currency');
      if (
        account.isOwned === false ||
        (account.status !== undefined && account.status !== 'available')
      )
        throw new HttpError(502, 'Bank account ownership or availability could not be verified');
      const name = [account.name, account.displayName].find(
        (value) => typeof value === 'string' && value.trim(),
      );
      if (typeof name !== 'string' || name.length > 200)
        throw new HttpError(502, 'Bank account name unavailable');
      const masked = maskedAccountNumber(account);
      const kind = accountKind(account.class);
      let balance = cents(account.balance);
      if (['loan', 'mortgage', 'credit_card'].includes(kind)) balance = -Math.abs(balance);
      const localId = await stableId(
        organisationId,
        `account:${userId}:${externalConnection}:${externalAccount}`,
      );
      accountIds.set(externalAccount, localId);
      result.accounts.push({
        id: localId,
        connection_id: connection.id,
        name: name.trim(),
        institution: connection.institution_name,
        kind,
        balance_cents: balance,
        available_funds_cents: optionalCents(account.availableFunds),
        masked_number: masked,
        updated_at: timestamp(account.lastUpdated),
      });
    }
    if (!result.accounts.length)
      throw new HttpError(503, 'Connected bank accounts are not ready yet');

    const providerTransactions = await this.all(
      `/users/${providerId(userId)}/transactions?limit=500`,
      userId,
    );
    const seen = new Set<string>();
    for (const transaction of providerTransactions) {
      const externalId = providerId(transaction.id);
      const externalAccount = relationId(transaction.account);
      const accountId = accountIds.get(externalAccount);
      if (!accountId) continue;
      const externalConnection = relationId(transaction.connection);
      if (!externalConnections.has(externalConnection) || transaction.currency !== 'AUD')
        throw new HttpError(502, 'Unexpected bank transaction scope or currency');
      const status = String(transaction.status).toLowerCase();
      if (!['posted', 'pending'].includes(status)) continue;
      const unique = `${externalConnection}:${externalId}`;
      if (seen.has(unique)) throw new HttpError(502, 'Duplicate bank transaction');
      seen.add(unique);
      if (
        typeof transaction.description !== 'string' ||
        !transaction.description.trim() ||
        transaction.description.length > 4000
      )
        throw new HttpError(502, 'Bank description unavailable');
      const amountCents = transactionAmount(transaction);
      result.transactions.push({
        id: await stableId(organisationId, `transaction:${userId}:${unique}`),
        account_id: accountId,
        provider_transaction_id: externalId,
        posted_at: postedDate(transaction.postDate ?? transaction.transactionDate),
        description: transaction.description.trim(),
        merchant: merchantName(transaction.merchant),
        amount_cents: amountCents,
        status,
        ...classifyTransaction(transaction.description, amountCents),
      });
    }
    return result;
  }

  async disconnect(userId: string): Promise<void> {
    const path = `/users/${providerId(userId)}`;
    const consents = await this.all(`${path}/consents`, userId);
    for (const consent of consents)
      if (consent.status === 'active')
        await this.api(`${path}/consents/${providerId(consent.id)}`, 'DELETE');
    // Consent removal may also remove connections, so re-read before deleting leftovers.
    for (const connection of await this.providerConnections(userId))
      await this.api(`${path}/connections/${providerId(connection.id)}`, 'DELETE');
    await this.api(path, 'DELETE');
  }
}

let instance: Basiq | undefined;
let instanceKey = '';
export function configuredBasiq(config: BasiqConfig): Basiq {
  const key = `${config.apiKey}\u0000${config.allowedInstitutionIds.join(',')}`;
  if (!instance || instanceKey !== key) {
    instance = new Basiq(config);
    instanceKey = key;
  }
  return instance;
}
