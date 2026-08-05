'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, otp }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error ?? 'Unable to sign in'); return; }
    router.push('/dashboard'); router.refresh();
  }
  return <main className="main" style={{ maxWidth: 440 }}><div className="panel"><h1>Eldorado Operations</h1><p className="muted">Secure order processing and reconciliation</p><form className="form" onSubmit={submit}><label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></label><label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><label>Administrator code <span className="muted">(if enabled)</span><input inputMode="numeric" pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value)} autoComplete="one-time-code" /></label>{error && <p className="error">{error}</p>}<button className="button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></div></main>;
}
