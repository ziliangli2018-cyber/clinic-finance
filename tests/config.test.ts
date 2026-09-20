import { describe, expect, it } from 'vitest';
import { validatePublicConfig } from '../src/services/config-validation';
import { csvCell } from '../src/utils/csv';

const production = { VITE_APP_ENV: 'production', VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
describe('deployment configuration boundary', () => {
  it('allows an explicit browser demo and valid production public settings', () => {
    expect(validatePublicConfig({ VITE_APP_ENV: 'demo', VITE_DATA_MODE: 'mock' }).mode).toBe('mock');
    expect(validatePublicConfig(production, true).mode).toBe('supabase');
  });
  it('rejects missing credentials, production mocks and an incorrectly labelled build', () => {
    expect(() => validatePublicConfig({ VITE_APP_ENV: 'production', VITE_DATA_MODE: 'mock' }, true)).toThrow();
    expect(() => validatePublicConfig({ VITE_APP_ENV: 'demo', VITE_DATA_MODE: 'mock' }, true)).toThrow();
    expect(() => validatePublicConfig({ ...production, VITE_SUPABASE_PUBLISHABLE_KEY: '' }, true)).toThrow();
  });
  it('rejects server credentials and unapproved variables', () => {
    expect(() => validatePublicConfig({ ...production, VITE_AI_API_KEY: 'secret' }, true)).toThrow();
    expect(() => validatePublicConfig({ ...production, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example' }, true)).toThrow();
    const serviceKey = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
    expect(() => validatePublicConfig({ ...production, VITE_SUPABASE_PUBLISHABLE_KEY: serviceKey }, true)).toThrow();
  });
  it('accepts a public anon JWT', () => {
    const anon = `header.${btoa(JSON.stringify({ role: 'anon' }))}.signature`;
    expect(validatePublicConfig({ ...production, VITE_SUPABASE_PUBLISHABLE_KEY: anon }, true).mode).toBe('supabase');
  });
  it('rejects unsafe origins and asset paths', () => {
    expect(() => validatePublicConfig({ ...production, VITE_SUPABASE_URL: 'http://example.com' }, true)).toThrow();
    expect(() => validatePublicConfig({ ...production, VITE_BASE_PATH: '//example.com/' }, true)).toThrow();
    expect(validatePublicConfig({ ...production, VITE_BASE_PATH: '/clinic-finance/' }, true)).toBeTruthy();
  });
});
describe('spreadsheet export', () => {
  it('neutralises formula-like text, including leading whitespace', () => {
    for (const text of ['=1+1', '  =HYPERLINK("x")', '\t@SUM(1)', '-cmd', '+SUM(1)']) expect(csvCell(text)).toMatch(/^"'/);
  });
  it('quotes and escapes ordinary descriptions', () => { expect(csvCell('Supplier "A", Brisbane')).toBe('"Supplier ""A"", Brisbane"'); });
});
