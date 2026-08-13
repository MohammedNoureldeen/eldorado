'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

const flow = [
  { index: '01', label: 'Eldorado sale', value: '$100.00 captured', state: 'complete' },
  { index: '02', label: 'FUT quote', value: '$42.00 locked', state: 'complete' },
  { index: '03', label: 'Transfer', value: 'Human confirmation', state: 'current' },
  { index: '04', label: 'Ledger', value: '$53.00 projected', state: 'next' }
];

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

  return <main className="auth-screen">
    <section className="auth-story" aria-label="Eldorado Operations workflow">
      <div className="auth-brand"><span className="auth-brand-mark">EO</span><span><strong>Eldorado</strong><small>Operations desk</small></span></div>
      <div className="auth-story-copy">
        <p className="auth-kicker"><span></span> Private fulfillment workspace</p>
        <h1>Every coin order.<br /><em>One clear trail.</em></h1>
        <p>From the Eldorado sale to the final FUT cost, keep the worker, customer action, proof, and profit connected.</p>
      </div>
      <div className="transaction-ticket">
        <div className="ticket-head"><span>LIVE ORDER PATH</span><strong>ELD-2026-000142</strong><i>MANUAL</i></div>
        <div className="ticket-flow">{flow.map((step) => <div className={`ticket-step ${step.state}`} key={step.index}><span>{step.index}</span><div><small>{step.label}</small><strong>{step.value}</strong></div><b aria-hidden="true">{step.state === 'complete' ? '✓' : step.state === 'current' ? '●' : '—'}</b></div>)}</div>
        <div className="ticket-foot"><span><b></b> Customer credentials encrypted</span><span>USD ledger · Cairo desk</span></div>
      </div>
      <div className="auth-assurance"><span><b>01</b> Quote before purchase</span><span><b>02</b> Submit exactly once</span><span><b>03</b> Audit every action</span></div>
    </section>

    <section className="auth-access">
      <div className="auth-environment"><span></span> Local preview · Safe mode</div>
      <div className="auth-card">
        <div className="auth-card-head"><p>SECURE OPERATOR ACCESS</p><h2>Open the desk</h2><span>Owner and assigned workers only.</span></div>
        <form className="auth-form" onSubmit={submit}>
          <label><span>Work email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="name@company.com" /></label>
          <label><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" /></label>
          <label><span>Administrator code <i>Optional</i></span><input inputMode="numeric" pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value)} autoComplete="one-time-code" placeholder="6-digit code" /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={busy}><span>{busy ? 'Opening secure desk…' : 'Enter operations'}</span><b aria-hidden="true">↗</b></button>
        </form>
        <div className="auth-card-foot"><span><b></b> Session protected</span><span>Access is audit logged</span></div>
      </div>
      <p className="auth-access-note">Built for controlled FC coin fulfillment.<br />No customer-facing access.</p>
    </section>
  </main>;
}
