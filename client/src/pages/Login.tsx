import { useState } from 'react';
import { useApp } from '../App';
import { api, ApiError, type User } from '../lib/api';
import { Banner, Field } from '../components/ui';

export function LoginPage() {
  const { setUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ user: User }>('/auth/login', { body: creds ?? { email, password } });
      setUser(r.user);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not sign in.'); } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card card-pad" style={{ width: 'min(420px, 100%)' }}>
        <div className="stack">
          <div className="logo"><span className="logo-mark">☁</span>Cloudlead</div>
          <div><h1 style={{ fontSize: 22 }}>Sign in</h1><p className="muted small">Local development build of the infrastructure store.</p></div>
          {err && <Banner tone="err">{err}</Banner>}
          <form className="stack" onSubmit={submit}>
            <Field label="Email" htmlFor="email"><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Password" htmlFor="pw"><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="hr" />
          <p className="small muted">Demo accounts (local only):</p>
          <div className="grid grid-2">
            <button className="btn btn-secondary" disabled={busy} onClick={() => submit(undefined, { email: 'demo@acme.local', password: 'demo1234' })}>Customer demo</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => submit(undefined, { email: 'admin@cloudlead.local', password: 'admin1234' })}>Admin demo</button>
          </div>
        </div>
      </div>
    </div>
  );
}
