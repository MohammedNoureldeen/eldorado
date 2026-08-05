'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type User = { id: string; name: string; email: string; role: 'OWNER_ADMIN' | 'WORKER' };
type Worker = { id: string; name: string; email: string; status: string };
type Order = {
  id: string;
  eldoradoOrderId: string;
  platform: string;
  coinQuantity: number;
  status: string;
  assignedWorker?: { id?: string; name: string } | null;
  grossSaleMinor: number;
  saleCurrency: string;
  version: number;
  futOrder?: { status: string; estimatedCostMinor?: number | null; actualCostMinor?: number | null } | null;
};

function csrf(): string {
  return document.cookie.split('; ').find((entry) => entry.startsWith('eldorado_csrf='))?.split('=')[1] ?? '';
}

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('x-csrf-token', csrf());
  const response = await fetch(path, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('AUTH_REQUIRED');
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

function statusClass(status: string): string {
  return ['COMPLETED', 'APPROVED', 'PROCESSING'].includes(status) ? 'success' : ['FAILED', 'DISPUTED', 'REFUNDED'].includes(status) ? 'danger' : ['READY_FOR_REVIEW', 'CUSTOMER_ACTION_REQUIRED'].includes(status) ? 'warning' : 'neutral';
}

export default function DashboardClient() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [summary, setSummary] = useState<{ workersOnline: number; profit: { egp: number } } | null>(null);
  const [shift, setShift] = useState<{ id: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [create, setCreate] = useState({ eldoradoOrderId: '', platform: 'PC', coinQuantity: '100', grossSaleMinor: '0', saleCurrency: 'EGP', assignedWorkerId: '' });

  const refresh = useCallback(async () => {
    try {
      const [me, orderData] = await Promise.all([api('/api/auth/me'), api('/api/orders')]);
      setUser(me.user);
      setOrders(orderData.orders);
      setShift((await api('/api/shifts')).shift);
      if (me.user.role === 'OWNER_ADMIN') {
        setSummary(await api('/api/reports/summary'));
        setWorkers((await api('/api/admin/workers')).workers);
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') router.push('/login');
      else setError(cause instanceof Error ? cause.message : 'Unable to load dashboard');
    }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);
  const counts = useMemo(() => orders.reduce<Record<string, number>>((result, order) => { result[order.status] = (result[order.status] ?? 0) + 1; return result; }, {}), [orders]);

  async function logout() { await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined); router.push('/login'); }
  async function shiftAction(action: string) { setBusy(true); try { await api('/api/shifts', { method: 'POST', body: JSON.stringify({ action }) }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Shift action failed'); } finally { setBusy(false); } }
  async function submitCreate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/api/orders', { method: 'POST', body: JSON.stringify({ ...create, assignedWorkerId: create.assignedWorkerId || undefined, coinQuantity: Number(create.coinQuantity), grossSaleMinor: Number(create.grossSaleMinor) }) });
      setShowCreate(false); setCreate({ eldoradoOrderId: '', platform: 'PC', coinQuantity: '100', grossSaleMinor: '0', saleCurrency: 'EGP', assignedWorkerId: '' }); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create order'); } finally { setBusy(false); }
  }
  async function setStatus(order: Order, status: string) { const reason = window.prompt('Reason for this status change') ?? ''; if (!reason.trim()) return; try { await api(`/api/orders/${order.id}/status`, { method: 'POST', body: JSON.stringify({ status, version: order.version, reason }) }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Status update failed'); } }
  async function prepare(order: Order) { try { const data = await api(`/api/orders/${order.id}/prepare`, { method: 'POST', body: '{}' }); window.alert(`Estimated FUT cost: ${data.estimatedCostMinor} ${data.currency}`); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'FUT preparation failed'); } }
  async function confirm(order: Order) { if (!window.confirm('Confirm this FUT purchase? The dashboard UUID prevents duplicate purchases.')) return; try { await api(`/api/orders/${order.id}/confirm`, { method: 'POST', body: JSON.stringify({ expectedVersion: order.version }) }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'FUT confirmation failed'); } }
  async function credentials(order: Order) { const email = window.prompt('Customer email'); const password = window.prompt('Customer password'); if (!email || !password) return; try { await api(`/api/orders/${order.id}/credentials`, { method: 'POST', body: JSON.stringify({ email, password }) }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Credential save failed'); } }
  async function assign(order: Order, assignedWorkerId: string) { try { await api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ version: order.version, assignedWorkerId: assignedWorkerId || null }) }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Assignment failed'); } }

  if (!user) return <main className="main"><div className="panel">Loading dashboard...</div></main>;
  const activeWorkers = workers.filter((worker) => worker.status === 'ACTIVE');
  return <div className="shell">
    <header className="topbar"><div className="brand">Eldorado Operations</div><nav className="nav"><span>{user.name} - {user.role === 'OWNER_ADMIN' ? 'Admin' : 'Worker'}</span><button onClick={logout}>Sign out</button></nav></header>
    <main className="main stack">
      {error && <div className="notice"><p className="error">{error}</p><button className="button secondary" onClick={() => setError('')}>Dismiss</button></div>}
      <section className="grid grid-4"><div className="panel"><div className="muted">Open orders</div><div className="metric">{orders.filter((order) => !['COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(order.status)).length}</div></div><div className="panel"><div className="muted">Ready for review</div><div className="metric">{counts.READY_FOR_REVIEW ?? 0}</div></div><div className="panel"><div className="muted">Completed</div><div className="metric">{counts.COMPLETED ?? 0}</div></div><div className="panel"><div className="muted">{user.role === 'OWNER_ADMIN' ? 'Profit EGP' : 'Shift'}</div><div className="metric">{user.role === 'OWNER_ADMIN' ? (summary?.profit.egp ?? 0).toLocaleString() : (shift ? 'Open' : 'Off')}</div></div></section>
      <section className="actions"><button className="button" onClick={() => setShowCreate((value) => !value)}>+ New manual order</button>{user.role === 'WORKER' && (!shift ? <button className="button secondary" onClick={() => shiftAction('CLOCK_IN')} disabled={busy}>Clock in</button> : <><button className="button secondary" onClick={() => shiftAction('BREAK_START')} disabled={busy}>Start break</button><button className="button secondary" onClick={() => shiftAction('BREAK_END')} disabled={busy}>Return</button><button className="button danger" onClick={() => shiftAction('CLOCK_OUT')} disabled={busy}>Clock out</button></>)}</section>
      {showCreate && <section className="panel"><h2>Manual order entry</h2><form className="form" onSubmit={submitCreate}><div className="grid grid-2"><label>Eldorado order ID<input required value={create.eldoradoOrderId} onChange={(event) => setCreate({ ...create, eldoradoOrderId: event.target.value })} /></label><label>Platform<select value={create.platform} onChange={(event) => setCreate({ ...create, platform: event.target.value })}><option>PC</option><option>PLAYSTATION</option><option>XBOX</option></select></label><label>Coin quantity<input type="number" min="1" required value={create.coinQuantity} onChange={(event) => setCreate({ ...create, coinQuantity: event.target.value })} /></label><label>Gross sale (minor units)<input type="number" min="1" required value={create.grossSaleMinor} onChange={(event) => setCreate({ ...create, grossSaleMinor: event.target.value })} /></label><label>Currency<input maxLength={3} required value={create.saleCurrency} onChange={(event) => setCreate({ ...create, saleCurrency: event.target.value.toUpperCase() })} /></label>{user.role === 'OWNER_ADMIN' && <label>Assign worker<select value={create.assignedWorkerId} onChange={(event) => setCreate({ ...create, assignedWorkerId: event.target.value })}><option value="">Unassigned</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>}</div><button className="button" disabled={busy}>Create order</button></form></section>}
      <section className="panel"><div className="actions" style={{ justifyContent: 'space-between' }}><h2>Order queue</h2><button className="button secondary" onClick={() => void refresh()}>Refresh</button></div><div className="table-wrap"><table><thead><tr><th>Eldorado ID</th><th>Platform</th><th>Status</th><th>Assigned</th><th>Sale</th><th>Actions</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.eldoradoOrderId}</strong><br /><span className="muted">{order.id.slice(0, 8)}</span></td><td>{order.platform}<br />{order.coinQuantity.toLocaleString()} coins</td><td><span className={`pill ${statusClass(order.status)}`}>{order.status}</span>{order.futOrder && <div className="muted">FUT: {order.futOrder.status}</div>}</td><td>{user.role === 'OWNER_ADMIN' ? <select value={order.assignedWorker?.id ?? ''} onChange={(event) => void assign(order, event.target.value)}><option value="">Unassigned</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select> : order.assignedWorker?.name ?? 'Unassigned'}</td><td>{order.grossSaleMinor.toLocaleString()} {order.saleCurrency}</td><td><div className="actions">{['DRAFT', 'WAITING_FOR_DETAILS'].includes(order.status) && <button className="button secondary" onClick={() => void credentials(order)}>Credentials</button>}{order.status === 'DRAFT' && <button className="button" onClick={() => void setStatus(order, 'WAITING_FOR_DETAILS')}>Needs details</button>}{order.status === 'WAITING_FOR_DETAILS' && <button className="button" onClick={() => void setStatus(order, 'READY_FOR_REVIEW')}>Ready review</button>}{order.status === 'READY_FOR_REVIEW' && <><button className="button" onClick={() => void setStatus(order, 'APPROVED')}>Approve</button><button className="button secondary" onClick={() => void prepare(order)}>Price</button></>}{order.status === 'APPROVED' && <button className="button" onClick={() => void confirm(order)}>Confirm FUT</button>}{['PROCESSING', 'CUSTOMER_ACTION_REQUIRED'].includes(order.status) && <button className="button" onClick={() => void setStatus(order, 'COMPLETED')}>Complete</button>}</div></td></tr>)}</tbody></table>{!orders.length && <p className="muted">No orders yet. Start with a manual order.</p>}</div></section>
      {user.role === 'OWNER_ADMIN' && <section className="panel"><h2>Operations controls</h2><p className="muted">{workers.length} worker account(s) - {summary?.workersOnline ?? 0} currently online</p><div className="actions"><a className="button secondary" href="/api/reports/export">Download order CSV</a><button className="button secondary" onClick={async () => { try { const data = await api('/api/integrations/fut/balance'); window.alert(`FUT balance: ${data.balanceMinor} ${data.currency}${data.low ? ' - LOW' : ''}`); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Balance check failed'); } }}>Check FUT balance</button></div></section>}
    </main>
  </div>;
}
