import { useEffect, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowRight, ChartNoAxesCombined, LockKeyhole } from 'lucide-react';
import { isMock, supabase } from '../services/supabase';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!isMock);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
        if (error) setError(error.message);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, current) => {
      if (active) {
        setSession(current);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const credentials = {
        email: String(form.get('email')),
        password: String(form.get('password')),
      };
      const result =
        mode === 'login'
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp({
              ...credentials,
              options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
            });
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data.session)
        setNotice(
          'Check your email to confirm your account, then sign in. For local Supabase, open the local email inbox.',
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }
  if (isMock) return children;
  if (loading) return <div className="loading-screen">Opening your workspace…</div>;
  if (session) return <div key={session.user.id}>{children}</div>;
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-icon">
            <ChartNoAxesCombined size={22} />
          </span>
          clinic<span>finance</span>
        </div>
        <div>
          <span className="eyebrow">YOUR FINANCES, IN FOCUS</span>
          <h1>
            A clear view.
            <br />A stronger practice.
          </h1>
          <p>One place for your clinic group’s accounts, transactions and cash flow.</p>
        </div>
        <p className="auth-foot">
          <LockKeyhole size={16} /> Your workspace is protected by Supabase authentication.
        </p>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">CLINIC FINANCE · V0.1</span>
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="muted">
            {mode === 'login'
              ? 'Sign in to your financial workspace.'
              : 'Start with a secure workspace and sample banking data.'}
          </p>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@yourclinic.com.au"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                required
                placeholder="At least 8 characters"
              />
            </label>
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="notice">
                {notice}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError('');
              setNotice('');
            }}
          >
            {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </div>
      </section>
    </main>
  );
}
