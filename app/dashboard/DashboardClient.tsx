'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type User = { id: string; name: string; email: string; role: 'OWNER_ADMIN' | 'WORKER' };
type Worker = { id: string; name: string; email: string; status: string };
type FutOrder = { providerOrderId?: string | null; transferMethod?: string | null; status: string; submissionState: string; estimatedCostMinor?: number | null; estimatedCostCurrency?: string | null; actualCostMinor?: number | null; actualCostCurrency?: string | null; quoteFetchedAt?: string | null; quoteExpiresAt?: string | null };
type Order = {
  id: string; orderReference: string; marketplaceReference?: string | null; customerName: string; platform: string; coinQuantity: number; fulfillmentSource: 'PUBLIC_SUPPLIER' | 'OWNED_SENDERS'; status: string; assignedWorker?: { id?: string; name: string } | null; grossSaleMinor: number; saleCurrency: string; marketplaceFeeMinor: number; version: number; createdAt: string; reconciledAt?: string | null; futOrder?: FutOrder | null; credentials?: { deletedAt?: string | null } | null; _count?: { proofFiles: number; notes: number };
};
type OrderDetail = Order & { statusHistory: Array<{ id: string; next: string; reason?: string | null; source: string; createdAt: string }>; proofFiles: Array<{ id: string; type: string; createdAt: string }>; notes: Array<{ id: string; body: string; createdAt: string }>; financialEntries?: Array<{ id: string; type: string; amountMinor: number; currency: string }> };
type AdminSummary = { period: { from: string; to: string }; ordersByStatus: Record<string, number>; workersOnline: number; profit: { usdMinor: number; egpMinor: number }; ledger: { revenueMinor: number; marketplaceFeeMinor: number; futCostMinor: number; refundMinor: number; fxFeeMinor: number; adjustmentMinor: number; entryCount: number; nonUsdEntryCount: number }; controls: { completedUnreconciled: number; unknownSubmissions: number; customerActions: number } };
type EconomyConfig = { feeBps: number; effectiveFrom: string; publicOrders: number; ownedOrders: number };
type AuditEvent = { id: string; action: string; entityType: string; result: string; actor?: { name: string } | null; orderReference?: string | null; createdAt: string };
type PayrollPeriod = { id: string; monthStart: string; status: string; totalMinor: number; entries: Array<{ id: string; completedCleanOrders: number; assignedValidOrders: number; handlingRateBps: number; tier: string; finalAmountMinor: number; worker: { name: string } }> };
type RetentionReport = { active: number; dueWithinSevenDays: number; overdue: number; deleted: number; deletionFailures: number; legacyKeyVersions: number };
type AutomationPolicy = { mode: 'MANUAL' | 'LIMIT_BASED' | 'AUTOMATIC'; killSwitch: boolean; maxGrossSaleMinor: number; maxCoinQuantity: number; maxQuoteAgeSeconds: number; minMarginBps: number; minBalanceAfterMinor: number; maxConsecutiveFailures: number; maxRiskLevel: number; allowedPlatforms: string[]; allowedSources: string[] };

const emptyCreate = { marketplaceReference: '', customerName: '', platform: 'PLAYSTATION', coinQuantity: '200000', grossUsd: '', fulfillmentSource: 'PUBLIC_SUPPLIER', email: '', password: '', backupCodes: '', notes: '', assignedWorkerId: '' };
const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED']);

function csrf(): string { return document.cookie.split('; ').find((entry) => entry.startsWith('eldorado_csrf='))?.split('=')[1] ?? ''; }

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('x-csrf-token', csrf());
  const response = await fetch(path, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('AUTH_REQUIRED');
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data as T;
}

function money(minor?: number | null, currency = 'USD'): string { return minor == null ? 'Not available' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100); }
function label(value: string): string { return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
function statusTone(status: string): string { return ['COMPLETED', 'APPROVED', 'PROCESSING'].includes(status) ? 'success' : ['FAILED', 'DISPUTED', 'REFUNDED'].includes(status) ? 'danger' : ['READY_FOR_REVIEW', 'CUSTOMER_ACTION_REQUIRED'].includes(status) ? 'warning' : 'neutral'; }
function initials(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function hasActiveCredentials(order: Order): boolean { return Boolean(order.credentials && !order.credentials.deletedAt); }
function canPrepareOrder(order: Order): boolean { return Boolean(order.assignedWorker?.id) && hasActiveCredentials(order); }

export default function DashboardClient() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shift, setShift] = useState<{ id: string } | null>(null);
  const [view, setView] = useState<'work' | 'new' | 'admin'>('work');
  const [filter, setFilter] = useState<'active' | 'attention' | 'done'>('active');
  const [create, setCreate] = useState(emptyCreate);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [confirming, setConfirming] = useState<Order | null>(null);
  const [confirmedReview, setConfirmedReview] = useState(false);
  const [proof, setProof] = useState<File | null>(null);
  const [manualCostUsd, setManualCostUsd] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [economy, setEconomy] = useState<EconomyConfig | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [payrollPeriods, setPayrollPeriods] = useState<PayrollPeriod[]>([]);
  const [futBalance, setFutBalance] = useState<{ balanceMinor: number; currency: string } | null>(null);
  const [controlSettings, setControlSettings] = useState({ approvalUsd: '', tolerancePercent: '5', lowBalanceUsd: '1000', workerQuoteVisibility: true, feePercent: '5' });
  const [payrollMonth, setPayrollMonth] = useState(new Date().toISOString().slice(0, 7));
  const [retention, setRetention] = useState<RetentionReport | null>(null);
  const [automation, setAutomation] = useState<AutomationPolicy | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [me, orderData, shiftData] = await Promise.all([api<{ user: User }>('/api/auth/me'), api<{ orders: Order[] }>('/api/orders'), api<{ shift: { id: string } | null }>('/api/shifts')]);
      setUser(me.user); setOrders(orderData.orders); setShift(shiftData.shift);
      if (me.user.role === 'OWNER_ADMIN') setWorkers((await api<{ workers: Worker[] }>('/api/admin/workers')).workers);
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') router.push('/login');
      else setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Unable to load work queue' });
    }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadAdmin = useCallback(async () => {
    const [summary, settings, economyData, audit, payroll, balance, retentionData, automationData] = await Promise.all([
      api<AdminSummary>('/api/reports/summary'),
      api<Record<string, unknown>>('/api/settings'),
      api<EconomyConfig>('/api/admin/economy'),
      api<{ events: AuditEvent[] }>('/api/admin/audit?limit=30'),
      api<{ periods: PayrollPeriod[] }>('/api/payroll'),
      api<{ balanceMinor: number; currency: string }>('/api/integrations/fut/balance').catch(() => null),
      api<RetentionReport>('/api/admin/security/retention'),
      api<AutomationPolicy>('/api/admin/automation')
    ]);
    setAdminSummary(summary); setEconomy(economyData); setAuditEvents(audit.events); setPayrollPeriods(payroll.periods); setFutBalance(balance); setRetention(retentionData); setAutomation(automationData);
    setControlSettings({ approvalUsd: settings.futApprovalLimitMinor == null ? '' : String(Number(settings.futApprovalLimitMinor) / 100), tolerancePercent: String(Number(settings.futPriceToleranceBps ?? 500) / 100), lowBalanceUsd: String(Number(settings.futLowBalanceMinor ?? 100000) / 100), workerQuoteVisibility: settings.workerQuoteVisibility !== false, feePercent: String(economyData.feeBps / 100) });
  }, []);

  useEffect(() => { if (view === 'admin' && user?.role === 'OWNER_ADMIN') void loadAdmin().catch((cause) => setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Unable to load owner controls' })); }, [loadAdmin, user?.role, view]);

  const counts = useMemo(() => ({
    active: orders.filter((order) => !terminal.has(order.status)).length,
    attention: orders.filter((order) => ['DRAFT', 'WAITING_FOR_DETAILS', 'READY_FOR_REVIEW', 'CUSTOMER_ACTION_REQUIRED', 'FAILED'].includes(order.status)).length,
    done: orders.filter((order) => order.status === 'COMPLETED').length
  }), [orders]);
  const visibleOrders = useMemo(() => orders.filter((order) => filter === 'done' ? terminal.has(order.status) : filter === 'attention' ? ['DRAFT', 'WAITING_FOR_DETAILS', 'READY_FOR_REVIEW', 'CUSTOMER_ACTION_REQUIRED', 'FAILED'].includes(order.status) : !terminal.has(order.status)), [filter, orders]);
  const activeWorkers = workers.filter((worker) => worker.status === 'ACTIVE');

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true); setMessage(null);
    try { await action(); await refresh(); }
    catch (cause) { await refresh().catch(() => undefined); setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : fallback }); }
    finally { setBusy(false); }
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const grossSaleMinor = Math.round(Number(create.grossUsd) * 100);
      const created = await api<{ id: string; orderReference: string; version: number; duplicateWarning?: { orderReference: string } | null }>('/api/orders', { method: 'POST', body: JSON.stringify({ marketplaceReference: create.marketplaceReference || undefined, customerName: create.customerName, platform: create.platform, coinQuantity: Number(create.coinQuantity), grossSaleMinor, fulfillmentSource: create.fulfillmentSource, assignedWorkerId: create.assignedWorkerId || undefined }) });
      try {
        const backupCodes = create.backupCodes.split(/[\n,]+/).map((code) => code.trim()).filter(Boolean);
        await api(`/api/orders/${created.id}/credentials`, { method: 'POST', body: JSON.stringify({ email: create.email, password: create.password, backupCodes }) });
        if (create.notes.trim()) await api(`/api/orders/${created.id}/notes`, { method: 'POST', body: JSON.stringify({ body: create.notes.trim() }) });
        await api(`/api/orders/${created.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'READY_FOR_REVIEW', version: created.version, reason: 'Order details and credentials entered' }) });
      } catch (cause) {
        throw new Error(`${created.orderReference} was created as a draft, but setup needs attention: ${cause instanceof Error ? cause.message : 'unknown error'}`);
      }
      setCreate(emptyCreate); setView('work'); setFilter('attention');
      setMessage({ tone: created.duplicateWarning ? 'warning' : 'success', text: created.duplicateWarning ? `${created.orderReference} created. Possible duplicate: ${created.duplicateWarning.orderReference}.` : `${created.orderReference} is ready for review.` });
    }, 'Unable to create order');
  }

  async function loadWorkspace(orderId: string) {
    await run(async () => { const data = await api<{ order: OrderDetail }>(`/api/orders/${orderId}`); setSelected(data.order); }, 'Unable to open order workspace');
  }

  async function setStatus(order: Order, status: string, reason: string) { await run(async () => { await api(`/api/orders/${order.id}/status`, { method: 'POST', body: JSON.stringify({ status, version: order.version, reason }) }); if (selected?.id === order.id) setSelected((await api<{ order: OrderDetail }>(`/api/orders/${order.id}`)).order); }, 'Status update failed'); }
  async function prepare(order: Order) { await run(async () => { const quote = await api<{ estimatedCostMinor: number; currency: string }>(`/api/orders/${order.id}/prepare`, { method: 'POST', body: '{}' }); setMessage({ tone: 'success', text: `Fresh quote received: ${money(quote.estimatedCostMinor, quote.currency)}.` }); }, 'Quote preparation failed'); }
  async function confirm() { if (!confirming || !confirmedReview) return; await run(async () => { await api(`/api/orders/${confirming.id}/confirm`, { method: 'POST', body: JSON.stringify({ expectedVersion: confirming.version }) }); setConfirming(null); setConfirmedReview(false); }, 'FUT confirmation failed'); }
  async function sync(order: Order) { await run(async () => { await api(`/api/orders/${order.id}/sync`, { method: 'POST', body: '{}' }); if (selected?.id === order.id) setSelected((await api<{ order: OrderDetail }>(`/api/orders/${order.id}`)).order); }, 'Status synchronization failed'); }
  async function assign(order: Order, assignedWorkerId: string) { await run(async () => { await api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ version: order.version, assignedWorkerId: assignedWorkerId || null }) }); }, 'Assignment failed'); }
  async function shiftAction(action: string) { await run(async () => { await api('/api/shifts', { method: 'POST', body: JSON.stringify({ action }) }); }, 'Shift action failed'); }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined); router.push('/login'); }

  async function uploadProof() {
    if (!selected || !proof) return;
    await run(async () => {
      const form = new FormData(); form.set('file', proof); form.set('type', 'DELIVERY_SCREENSHOT');
      const response = await fetch(`/api/orders/${selected.id}/proof`, { method: 'POST', headers: { 'x-csrf-token': csrf() }, body: form });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? 'Proof upload failed');
      setProof(null); setSelected((await api<{ order: OrderDetail }>(`/api/orders/${selected.id}`)).order);
    }, 'Proof upload failed');
  }

  async function completeManually() {
    if (!selected) return;
    const actualCostMinor = Math.round(Number(manualCostUsd) * 100);
    if (manualCostUsd.trim() === '' || !Number.isSafeInteger(actualCostMinor) || actualCostMinor < 0) { setMessage({ tone: 'error', text: 'Enter a valid actual fulfillment cost in USD.' }); return; }
    await run(async () => {
      await api(`/api/orders/${selected.id}/manual-complete`, { method: 'POST', body: JSON.stringify({ version: selected.version, actualCostMinor }) });
      setManualCostUsd(''); setProof(null);
      setSelected((await api<{ order: OrderDetail }>(`/api/orders/${selected.id}`)).order);
      setMessage({ tone: 'success', text: `${selected.orderReference} completed manually at ${money(actualCostMinor)} actual cost.` });
    }, 'Manual completion failed');
  }

  async function addNote() {
    if (!selected || !note.trim()) return;
    await run(async () => { await api(`/api/orders/${selected.id}/notes`, { method: 'POST', body: JSON.stringify({ body: note.trim() }) }); setNote(''); setSelected((await api<{ order: OrderDetail }>(`/api/orders/${selected.id}`)).order); }, 'Unable to add note');
  }

  async function addMissingCredentials(order: Order) {
    const email = window.prompt('Customer EA email'); const password = window.prompt('Customer EA password'); const backupCode = window.prompt('At least one backup code');
    if (!email || !password || !backupCode) return;
    await run(async () => { await api(`/api/orders/${order.id}/credentials`, { method: 'POST', body: JSON.stringify({ email, password, backupCodes: [backupCode] }) }); }, 'Credential save failed');
  }

  async function correctCredentialsAndResume(order: Order) {
    const email = window.prompt('Correct customer EA email'); const password = window.prompt('Correct customer EA password'); const backupCode = window.prompt('New EA backup code');
    if (!email || !password || !backupCode) return;
    await run(async () => {
      await api(`/api/orders/${order.id}/credentials`, { method: 'POST', body: JSON.stringify({ email, password, backupCodes: [backupCode] }) });
      await api(`/api/orders/${order.id}/correct`, { method: 'POST', body: '{}' });
    }, 'Unable to correct and resume FUT order');
  }

  async function saveOwnerControls(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ futApprovalLimitMinor: controlSettings.approvalUsd ? Math.round(Number(controlSettings.approvalUsd) * 100) : Number.MAX_SAFE_INTEGER, futPriceToleranceBps: Math.round(Number(controlSettings.tolerancePercent) * 100), futLowBalanceMinor: Math.round(Number(controlSettings.lowBalanceUsd) * 100), workerQuoteVisibility: controlSettings.workerQuoteVisibility }) });
      await api('/api/admin/economy', { method: 'PATCH', body: JSON.stringify({ feeBps: Math.round(Number(controlSettings.feePercent) * 100) }) });
      await loadAdmin();
    }, 'Unable to save owner controls');
  }

  async function buildPayroll() { await run(async () => { await api('/api/payroll', { method: 'POST', body: JSON.stringify({ month: payrollMonth }) }); await loadAdmin(); }, 'Unable to build payroll draft'); }
  async function payrollAction(id: string, action: 'APPROVE' | 'PAID') { await run(async () => { await api(`/api/payroll/${id}/approve`, { method: 'POST', body: JSON.stringify({ action }) }); await loadAdmin(); }, 'Unable to update payroll'); }
  async function reconcileSelected() { if (!selected) return; await run(async () => { await api(`/api/orders/${selected.id}/reconcile`, { method: 'POST', body: JSON.stringify({ exchangeRates: {} }) }); setSelected((await api<{ order: OrderDetail }>(`/api/orders/${selected.id}`)).order); await loadAdmin(); }, 'Unable to reconcile order'); }
  async function rotateCredentials() { await run(async () => { const result = await api<{ rotated: number; failed: number; remaining: number }>('/api/admin/security/rotate-credentials', { method: 'POST', body: '{}' }); await loadAdmin(); setMessage({ tone: result.failed ? 'warning' : 'success', text: `Credential rotation: ${result.rotated} rotated, ${result.failed} failed, ${result.remaining} remaining.` }); }, 'Credential rotation failed'); }
  async function emergencyStop() { await run(async () => { await api('/api/admin/automation', { method: 'DELETE', body: '{}' }); await loadAdmin(); }, 'Unable to stop automation'); }
  async function runAutomation() { if (!selected) return; await run(async () => { const result = await api<{ submitted: boolean; reasons: string[] }>(`/api/orders/${selected.id}/automation`, { method: 'POST', body: '{}' }); if (!result.submitted) throw new Error(`Automation blocked: ${result.reasons.join(', ')}`); setSelected((await api<{ order: OrderDetail }>(`/api/orders/${selected.id}`)).order); await refresh(); }, 'Controlled automation did not submit'); }

  if (!user) return <main className="loading-screen"><div className="loading-mark">EO</div><p>Opening secure workspace…</p></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="wordmark"><span className="wordmark-mark">EO</span><span><strong>Eldorado</strong><small>Operations</small></span></div>
      <nav className="side-nav" aria-label="Main navigation">
        <button className={view === 'work' ? 'active' : ''} onClick={() => setView('work')}><span>▦</span> My work <b>{counts.active}</b></button>
        <button className={view === 'new' ? 'active' : ''} onClick={() => setView('new')}><span>＋</span> New order</button>
        {user.role === 'OWNER_ADMIN' && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><span>$</span> Owner control</button>}
      </nav>
      <div className="side-foot"><div className="avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><small>{user.role === 'OWNER_ADMIN' ? 'Owner / admin' : 'Operations worker'}</small></div><button onClick={logout} aria-label="Sign out">↗</button></div>
    </aside>

    <main className="workspace">
      <header className="workspace-head"><div><p className="eyebrow">{view === 'admin' ? 'Private owner view' : user.role === 'OWNER_ADMIN' ? 'Operations overview' : shift ? 'Shift active' : 'Not clocked in'}</p><h1>{view === 'new' ? 'Create a manual order' : view === 'admin' ? 'Owner control' : 'My work'}</h1><p>{view === 'new' ? 'Capture the Eldorado sale once, then move it through a controlled fulfillment flow.' : view === 'admin' ? 'Economy, FUT exceptions, payroll, policy, and audit in one owner-only view.' : 'The next action for every assigned customer order, in one place.'}</p></div><div className="header-actions">{user.role === 'WORKER' && (!shift ? <button className="button secondary" disabled={busy} onClick={() => void shiftAction('CLOCK_IN')}>Clock in</button> : <><span className="live-dot">● Live</span><button className="button ghost" disabled={busy} onClick={() => void shiftAction('BREAK_START')}>Break</button><button className="button ghost" disabled={busy} onClick={() => void shiftAction('BREAK_END')}>Return</button><button className="button secondary" disabled={busy} onClick={() => void shiftAction('CLOCK_OUT')}>Clock out</button></>)}</div></header>

      {message && <div className={`notice ${message.tone}`}><span>{message.text}</span><button onClick={() => setMessage(null)}>×</button></div>}

      {view === 'admin' && user.role === 'OWNER_ADMIN' ? <section className="admin-console">
        <div className="admin-title"><div><p className="eyebrow">Private owner view</p><h2>Economy and control</h2><p>All amounts below are ledger-backed. Operational workers cannot access this view or its APIs.</p></div><div className="queue-actions"><a className="button ghost" href="/api/reports/export">Export CSV</a><button className="button" onClick={() => void loadAdmin()}>Refresh controls</button></div></div>
        <div className="admin-metrics">
          <article><small>Net USD profit</small><strong>{money(adminSummary?.profit.usdMinor, 'USD')}</strong><span>{adminSummary?.ledger.entryCount ?? 0} immutable ledger entries</span></article>
          <article><small>FUT balance</small><strong>{futBalance ? money(futBalance.balanceMinor, futBalance.currency) : 'Unavailable'}</strong><span>Low-balance threshold {money(Math.round(Number(controlSettings.lowBalanceUsd || 0) * 100))}</span></article>
          <article><small>Needs reconciliation</small><strong>{adminSummary?.controls.completedUnreconciled ?? 0}</strong><span>Completed orders without ledger closure</span></article>
          <article className={(adminSummary?.controls.unknownSubmissions ?? 0) > 0 ? 'alert-card' : ''}><small>Unknown submissions</small><strong>{adminSummary?.controls.unknownSubmissions ?? 0}</strong><span>Never retry; recover by external ID</span></article>
        </div>
        <div className="admin-grid">
          <section className="panel admin-panel"><div className="panel-heading"><div><h3>USD economy</h3><p>Exact components for the current report period.</p></div><span className="pill success">Ledger</span></div><dl className="economy-lines"><div><dt>Gross revenue</dt><dd>{money(adminSummary?.ledger.revenueMinor)}</dd></div><div><dt>Marketplace fees</dt><dd>- {money(adminSummary?.ledger.marketplaceFeeMinor)}</dd></div><div><dt>FUT costs</dt><dd>- {money(adminSummary?.ledger.futCostMinor)}</dd></div><div><dt>Refunds</dt><dd>- {money(adminSummary?.ledger.refundMinor)}</dd></div><div><dt>Payment / FX fees</dt><dd>- {money(adminSummary?.ledger.fxFeeMinor)}</dd></div><div><dt>Adjustments</dt><dd>{money(adminSummary?.ledger.adjustmentMinor)}</dd></div><div className="economy-total"><dt>Net profit</dt><dd>{money(adminSummary?.profit.usdMinor)}</dd></div></dl><div className="source-split"><span><b>{economy?.publicOrders ?? 0}</b> public supplier orders</span><span><b>{economy?.ownedOrders ?? 0}</b> owned sender orders</span></div></section>
          <form className="panel admin-panel control-form" onSubmit={saveOwnerControls}><div className="panel-heading"><div><h3>Submission policy</h3><p>Changes are owner-only and audit logged.</p></div></div><label>Marketplace fee (%)<input type="number" min="0" max="100" step="0.01" value={controlSettings.feePercent} onChange={(event) => setControlSettings({ ...controlSettings, feePercent: event.target.value })} /></label><label>Worker approval limit (USD)<input type="number" min="0" step="0.01" value={controlSettings.approvalUsd} onChange={(event) => setControlSettings({ ...controlSettings, approvalUsd: event.target.value })} placeholder="No limit" /></label><label>Quote change tolerance (%)<input type="number" min="0" max="100" step="0.01" value={controlSettings.tolerancePercent} onChange={(event) => setControlSettings({ ...controlSettings, tolerancePercent: event.target.value })} /></label><label>FUT low-balance warning (USD)<input type="number" min="0" step="0.01" value={controlSettings.lowBalanceUsd} onChange={(event) => setControlSettings({ ...controlSettings, lowBalanceUsd: event.target.value })} /></label><label className="switch-row"><input type="checkbox" checked={controlSettings.workerQuoteVisibility} onChange={(event) => setControlSettings({ ...controlSettings, workerQuoteVisibility: event.target.checked })} /><span>Workers can see the current per-order quote</span></label><button className="button" disabled={busy}>Save owner controls</button></form>
          <section className="panel admin-panel payroll-panel"><div className="panel-heading"><div><h3>Payroll</h3><p>Draft, review, approve, then mark paid. Amounts are EGP.</p></div></div><div className="payroll-build"><input type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} /><button className="button" disabled={busy} onClick={() => void buildPayroll()}>Build draft</button></div><div className="payroll-list">{payrollPeriods.map((period) => <article key={period.id}><div><strong>{new Date(period.monthStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><span className={`pill ${period.status === 'PAID' ? 'success' : period.status === 'APPROVED' ? 'warning' : 'neutral'}`}>{label(period.status)}</span></div><p>{period.entries.length} worker(s) · {money(period.totalMinor, 'EGP')}</p>{period.entries.map((entry) => <small key={entry.id}>{entry.worker.name}: {entry.completedCleanOrders}/{entry.assignedValidOrders} clean · {money(entry.finalAmountMinor, 'EGP')}</small>)}<div>{period.status === 'DRAFT' && <button className="button ghost" onClick={() => void payrollAction(period.id, 'APPROVE')}>Approve</button>}{period.status === 'APPROVED' && <button className="button confirm" onClick={() => void payrollAction(period.id, 'PAID')}>Mark paid</button>}</div></article>)}{!payrollPeriods.length && <p className="muted">No payroll periods yet.</p>}</div></section>
          <section className="panel admin-panel"><div className="panel-heading"><div><h3>Credential security</h3><p>Seven-day deletion and encryption-key health.</p></div><span className={`pill ${(retention?.overdue ?? 0) > 0 || (retention?.deletionFailures ?? 0) > 0 ? 'danger' : 'success'}`}>{(retention?.overdue ?? 0) > 0 ? 'Attention' : 'Healthy'}</span></div><dl className="economy-lines"><div><dt>Active encrypted sets</dt><dd>{retention?.active ?? 0}</dd></div><div><dt>Due within seven days</dt><dd>{retention?.dueWithinSevenDays ?? 0}</dd></div><div><dt>Overdue deletion</dt><dd>{retention?.overdue ?? 0}</dd></div><div><dt>Deletion failures</dt><dd>{retention?.deletionFailures ?? 0}</dd></div><div><dt>Legacy key versions</dt><dd>{retention?.legacyKeyVersions ?? 0}</dd></div><div><dt>Deleted sets</dt><dd>{retention?.deleted ?? 0}</dd></div></dl><button className="button wide-button" disabled={busy || (retention?.legacyKeyVersions ?? 0) === 0} onClick={() => void rotateCredentials()}>Rotate legacy credentials to active key</button></section>
          <section className="panel admin-panel"><div className="panel-heading"><div><h3>Automation safety</h3><p>Fail-closed policy for future FUT execution.</p></div><span className={`pill ${automation?.mode === 'AUTOMATIC' && !automation.killSwitch ? 'warning' : 'success'}`}>{automation?.killSwitch ? 'Stopped' : label(automation?.mode ?? 'MANUAL')}</span></div><dl className="economy-lines"><div><dt>Mode</dt><dd>{label(automation?.mode ?? 'MANUAL')}</dd></div><div><dt>Maximum order</dt><dd>{money(automation?.maxGrossSaleMinor ?? 0, 'USD')}</dd></div><div><dt>Maximum coins</dt><dd>{(automation?.maxCoinQuantity ?? 0).toLocaleString()}</dd></div><div><dt>Minimum margin</dt><dd>{((automation?.minMarginBps ?? 0) / 100).toFixed(2)}%</dd></div><div><dt>Maximum risk</dt><dd>{automation?.maxRiskLevel ?? 1}</dd></div><div><dt>Failure cutoff</dt><dd>{automation?.maxConsecutiveFailures ?? 1}</dd></div></dl><button className="button danger wide-button" disabled={busy || (automation?.killSwitch ?? true)} onClick={() => void emergencyStop()}>Emergency stop</button><p className="muted">Activation requires exact owner acknowledgement through the protected policy API. Manual mode remains the default.</p></section>
          <section className="panel admin-panel audit-panel"><div className="panel-heading"><div><h3>Recent audit</h3><p>Newest owner, worker, provider, and security events.</p></div><span>{auditEvents.length} shown</span></div><div className="audit-list">{auditEvents.map((event) => <article key={event.id}><span className={`audit-result ${event.result === 'SUCCESS' ? 'ok' : 'bad'}`}></span><div><strong>{label(event.action)}</strong><p>{event.actor?.name ?? 'System'}{event.orderReference ? ` · ${event.orderReference}` : ''}</p></div><time>{new Date(event.createdAt).toLocaleString()}</time></article>)}{!auditEvents.length && <p className="muted">No audit events yet.</p>}</div></section>
        </div>
      </section> : view === 'new' ? <section className="entry-layout">
        <form className="order-form panel" onSubmit={submitCreate}>
          <div className="section-title"><span>01</span><div><h2>Customer and sale</h2><p>Marketplace reference is optional. The system creates the permanent internal reference.</p></div></div>
          <div className="form-grid">
            <label>Customer name<input required minLength={2} maxLength={160} autoComplete="off" value={create.customerName} onChange={(event) => setCreate({ ...create, customerName: event.target.value })} placeholder="Customer display name" /></label>
            <label>Marketplace reference <em>Optional</em><input maxLength={120} value={create.marketplaceReference} onChange={(event) => setCreate({ ...create, marketplaceReference: event.target.value })} placeholder="Eldorado reference, if shown" /></label>
            <label>Platform<select value={create.platform} onChange={(event) => setCreate({ ...create, platform: event.target.value })}><option value="PLAYSTATION">PlayStation</option><option value="XBOX">Xbox</option><option value="PC">PC</option></select></label>
            <label>Coin quantity<input type="number" min="200000" step="10000" required value={create.coinQuantity} onChange={(event) => setCreate({ ...create, coinQuantity: event.target.value })} /><small>Whole coins; minimum 200,000</small></label>
            <label>Gross sale before fees <span className="input-money"><b>$</b><input type="number" min="0.01" step="0.01" required value={create.grossUsd} onChange={(event) => setCreate({ ...create, grossUsd: event.target.value })} placeholder="0.00" /></span><small>Stored exactly as integer USD cents</small></label>
            {user.role === 'OWNER_ADMIN' && <label>Assigned worker<select value={create.assignedWorkerId} onChange={(event) => setCreate({ ...create, assignedWorkerId: event.target.value })}><option value="">Unassigned</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>}
          </div>
          <div className="section-title"><span>02</span><div><h2>Fulfillment source</h2><p>The choice is manual now and uses the same controlled submission engine later.</p></div></div>
          <div className="source-picker">
            <label className={create.fulfillmentSource === 'PUBLIC_SUPPLIER' ? 'selected' : ''}><input type="radio" name="source" value="PUBLIC_SUPPLIER" checked={create.fulfillmentSource === 'PUBLIC_SUPPLIER'} onChange={() => setCreate({ ...create, fulfillmentSource: 'PUBLIC_SUPPLIER' })} /><strong>Public FUT supplier</strong><span>Use public stock and a live supplier quote.</span></label>
            <label className={create.fulfillmentSource === 'OWNED_SENDERS' ? 'selected' : ''}><input type="radio" name="source" value="OWNED_SENDERS" checked={create.fulfillmentSource === 'OWNED_SENDERS'} onChange={() => setCreate({ ...create, fulfillmentSource: 'OWNED_SENDERS' })} /><strong>Owned sender accounts</strong><span>Fulfill from the business&apos;s own sender capacity.</span></label>
          </div>
          <div className="section-title"><span>03</span><div><h2>EA credentials</h2><p>Encrypted field-by-field. Values are never returned in order lists or logs.</p></div></div>
          <div className="form-grid">
            <label>EA email<input type="email" required autoComplete="off" value={create.email} onChange={(event) => setCreate({ ...create, email: event.target.value })} /></label>
            <label>EA password<input type="password" required autoComplete="new-password" value={create.password} onChange={(event) => setCreate({ ...create, password: event.target.value })} /></label>
            <label className="wide">Backup codes<textarea required value={create.backupCodes} onChange={(event) => setCreate({ ...create, backupCodes: event.target.value })} placeholder="One per line or separated by commas" /></label>
            <label className="wide">Operational note <em>Optional</em><textarea value={create.notes} onChange={(event) => setCreate({ ...create, notes: event.target.value })} placeholder="Only non-sensitive delivery context" /></label>
          </div>
          <div className="form-submit"><p>Creating the order also records the fee policy, audit event, and initial timeline.</p><button className="button" disabled={busy}>{busy ? 'Creating…' : 'Create and mark ready'}</button></div>
        </form>
        <aside className="entry-help panel"><span className="help-icon">✓</span><h3>Before you submit</h3><ul><li>Coin quantity is at least 200K.</li><li>The sale is entered before the Eldorado fee.</li><li>At least one backup code is included.</li><li>No credential is placed in notes.</li></ul><div className="fee-preview"><span>Current fee snapshot</span><strong>5.00%</strong><small>Admin-configurable effective-dated policy</small></div></aside>
      </section> : <>
        <section className="metrics-grid">
          <button onClick={() => setFilter('active')} className={filter === 'active' ? 'metric-card active' : 'metric-card'}><span>Active orders</span><strong>{counts.active}</strong><small>In your current queue</small></button>
          <button onClick={() => setFilter('attention')} className={filter === 'attention' ? 'metric-card active' : 'metric-card'}><span>Needs attention</span><strong>{counts.attention}</strong><small>Details, review, or customer action</small></button>
          <button onClick={() => setFilter('done')} className={filter === 'done' ? 'metric-card active' : 'metric-card'}><span>Completed</span><strong>{counts.done}</strong><small>Visible closed work</small></button>
        </section>
        <section className="queue panel">
          <div className="queue-head"><div><h2>{filter === 'active' ? 'Active queue' : filter === 'attention' ? 'Orders needing attention' : 'Closed orders'}</h2><p>{visibleOrders.length} order{visibleOrders.length === 1 ? '' : 's'} shown</p></div><div className="queue-actions"><button className="button ghost" onClick={() => void refresh()}>Refresh</button><button className="button" onClick={() => setView('new')}>＋ New order</button></div></div>
          <div className="order-list">{visibleOrders.map((order) => <article className="order-row" key={order.id}>
            <button className="order-primary" onClick={() => void loadWorkspace(order.id)}><span className="platform-mark">{order.platform === 'PLAYSTATION' ? 'PS' : order.platform === 'XBOX' ? 'XB' : 'PC'}</span><span><strong>{order.orderReference}</strong><small>{order.customerName} · {order.marketplaceReference || 'No marketplace reference'}</small></span></button>
            <div className="order-data"><span><small>Order</small>{order.coinQuantity.toLocaleString()} coins</span><span><small>Gross sale</small>{money(order.grossSaleMinor, order.saleCurrency)}</span><span><small>Source</small>{order.fulfillmentSource === 'PUBLIC_SUPPLIER' ? 'Public supplier' : 'Owned senders'}</span></div>
            <div className="order-state"><span className={`pill ${statusTone(order.status)}`}>{label(order.status)}</span>{order.futOrder && <small>FUT · {label(order.futOrder.submissionState)}</small>}{order.futOrder?.submissionState === 'UNKNOWN' && <small>Do not submit again. Recover by external order ID.</small>}</div>
            <div className="row-actions">
              {user.role === 'OWNER_ADMIN' && <select aria-label="Assigned worker" value={order.assignedWorker?.id ?? ''} onChange={(event) => void assign(order, event.target.value)}><option value="">Unassigned</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>}
              {order.status === 'DRAFT' && <><button className="button ghost" onClick={() => void addMissingCredentials(order)}>{hasActiveCredentials(order) ? 'Update credentials' : 'Add credentials'}</button><button className="button" disabled={!canPrepareOrder(order) || busy} title={!order.assignedWorker?.id ? 'Assign a worker first' : !hasActiveCredentials(order) ? 'Add customer credentials first' : undefined} onClick={() => void setStatus(order, 'READY_FOR_REVIEW', 'Order details completed')}>Mark ready</button></>}
              {order.status === 'READY_FOR_REVIEW' && !order.futOrder && !hasActiveCredentials(order) && <button className="button ghost" disabled={busy} onClick={() => void addMissingCredentials(order)}>Add credentials</button>}
              {order.status === 'READY_FOR_REVIEW' && !order.futOrder && hasActiveCredentials(order) && !order.assignedWorker?.id && <button className="button" disabled title="Assign a worker to continue">Assign worker first</button>}
              {order.status === 'READY_FOR_REVIEW' && !order.futOrder && canPrepareOrder(order) && <button className="button" disabled={busy} onClick={() => void prepare(order)}>Get live quote</button>}
              {order.status === 'READY_FOR_REVIEW' && canPrepareOrder(order) && !order.futOrder?.providerOrderId && <button className="button secondary" disabled={busy} onClick={() => void loadWorkspace(order.id)}>Complete manually</button>}
              {order.status === 'READY_FOR_REVIEW' && order.futOrder && <button className="button" onClick={() => void setStatus(order, 'APPROVED', 'Quote reviewed and order approved')}>Approve quote</button>}
              {order.status === 'APPROVED' && order.futOrder?.submissionState !== 'UNKNOWN' && <button className="button confirm" onClick={() => setConfirming(order)}>Review & confirm</button>}
              {order.status === 'APPROVED' && !order.futOrder?.providerOrderId && order.futOrder?.submissionState !== 'UNKNOWN' && <button className="button secondary" disabled={busy} onClick={() => void loadWorkspace(order.id)}>Complete manually</button>}
              {order.futOrder?.submissionState === 'UNKNOWN' && <button className="button confirm" onClick={() => void sync(order)}>Recover FUT submission</button>}
              {order.status === 'SUBMITTED_TO_FUT' && order.futOrder?.submissionState !== 'UNKNOWN' && <button className="button" onClick={() => void sync(order)}>Sync FUT status</button>}
              {order.status === 'CUSTOMER_ACTION_REQUIRED' && order.futOrder && <button className="button confirm" onClick={() => void correctCredentialsAndResume(order)}>Correct details & resume</button>}
              {['PROCESSING', 'CUSTOMER_ACTION_REQUIRED'].includes(order.status) && <button className="button" onClick={() => void loadWorkspace(order.id)}>Open workspace</button>}
              <button className="icon-button" aria-label={`Open ${order.orderReference}`} onClick={() => void loadWorkspace(order.id)}>›</button>
            </div>
          </article>)}{visibleOrders.length === 0 && <div className="empty-state"><span>✓</span><h3>Nothing in this view</h3><p>Create a new order or select another queue.</p></div>}</div>
        </section>
      </>}
    </main>

    {confirming && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="modal-close" onClick={() => { setConfirming(null); setConfirmedReview(false); }}>×</button><p className="eyebrow">Final human checkpoint</p><h2 id="confirm-title">Confirm FUT submission</h2><p className="modal-lead">This action can create a real transfer when the HTTP provider is enabled. Review every value before continuing.</p><dl className="review-grid"><div><dt>Reference</dt><dd>{confirming.orderReference}</dd></div><div><dt>Customer</dt><dd>{confirming.customerName}</dd></div><div><dt>Platform</dt><dd>{label(confirming.platform)}</dd></div><div><dt>Quantity</dt><dd>{confirming.coinQuantity.toLocaleString()} coins</dd></div><div><dt>Source</dt><dd>{confirming.fulfillmentSource === 'PUBLIC_SUPPLIER' ? 'Public supplier' : 'Owned senders'}</dd></div><div><dt>Fresh quote</dt><dd>{money(confirming.futOrder?.estimatedCostMinor, confirming.futOrder?.estimatedCostCurrency ?? 'USD')}</dd></div></dl><label className="confirmation-check"><input type="checkbox" checked={confirmedReview} onChange={(event) => setConfirmedReview(event.target.checked)} /><span>I checked the customer, platform, quantity, source, and current quote.</span></label><div className="modal-actions"><button className="button ghost" onClick={() => { setConfirming(null); setConfirmedReview(false); }}>Go back</button><button className="button confirm" disabled={!confirmedReview || busy} onClick={() => void confirm()}>{busy ? 'Submitting once…' : 'Confirm and submit once'}</button></div></section></div>}

    {selected && <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><div className="drawer-head"><div><p className="eyebrow">Order workspace</p><h2 id="workspace-title">{selected.orderReference}</h2><p>{selected.customerName} · {label(selected.platform)} · {selected.coinQuantity.toLocaleString()} coins</p></div><button className="modal-close" onClick={() => setSelected(null)}>×</button></div><div className="drawer-body">
      <section className="workspace-summary"><span className={`pill ${statusTone(selected.status)}`}>{label(selected.status)}</span><div><small>Gross sale</small><strong>{money(selected.grossSaleMinor, selected.saleCurrency)}</strong></div><div><small>Fulfillment</small><strong>{selected.fulfillmentSource === 'PUBLIC_SUPPLIER' ? 'Public supplier' : 'Owned senders'}</strong></div>{selected.futOrder && <div><small>{selected.futOrder.transferMethod === 'MANUAL' ? 'Manual cost' : 'FUT quote'}</small><strong>{money(selected.futOrder.transferMethod === 'MANUAL' ? selected.futOrder.actualCostMinor : selected.futOrder.estimatedCostMinor, selected.futOrder.transferMethod === 'MANUAL' ? selected.futOrder.actualCostCurrency ?? 'USD' : selected.futOrder.estimatedCostCurrency ?? 'USD')}</strong></div>}</section>
      {user.role === 'OWNER_ADMIN' && selected.status === 'COMPLETED' && !selected.reconciledAt && <button className="button confirm wide-button" disabled={busy} onClick={() => void reconcileSelected()}>Reconcile USD ledger</button>}
      {user.role === 'OWNER_ADMIN' && selected.status === 'APPROVED' && selected.futOrder?.submissionState === 'PREPARED' && <button className="button warning wide-button" disabled={busy || automation?.mode === 'MANUAL' || automation?.killSwitch !== false} onClick={() => void runAutomation()}>{automation?.mode === 'AUTOMATIC' ? 'Run controlled automation' : 'Run policy-checked submission'}</button>}
      {user.role === 'OWNER_ADMIN' && selected.reconciledAt && <section className="drawer-section"><h3>Reconciled ledger</h3><p className="success-text">Locked on {new Date(selected.reconciledAt).toLocaleString()}.</p><div className="economy-lines">{selected.financialEntries?.map((entry) => <div key={entry.id}><span>{label(entry.type)}</span><strong>{money(entry.amountMinor, entry.currency)}</strong></div>)}</div></section>}
      {selected.status === 'SUBMITTED_TO_FUT' && <button className="button wide-button" disabled={busy} onClick={() => void sync(selected)}>Synchronize provider status</button>}
      {['READY_FOR_REVIEW', 'APPROVED'].includes(selected.status) && !selected.futOrder?.providerOrderId && selected.futOrder?.submissionState !== 'UNKNOWN' && <section className="drawer-section manual-fulfillment"><h3>Complete manually</h3><p>Use this only after the worker finishes the transfer outside FUT automation. No FUT order will be submitted.</p><label>Actual fulfillment cost (USD)<span className="input-money"><b>$</b><input type="number" min="0" max="1000000" step="0.01" value={manualCostUsd} onChange={(event) => setManualCostUsd(event.target.value)} placeholder="0.00" /></span></label><div className="upload-row"><input type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => setProof(event.target.files?.[0] ?? null)} /><button className="button" disabled={!proof || busy} onClick={() => void uploadProof()}>Upload proof</button></div>{selected.proofFiles.length > 0 && <p className="success-text">{selected.proofFiles.length} proof file(s) recorded.</p>}<button className="button confirm wide-button" disabled={selected.proofFiles.length === 0 || manualCostUsd.trim() === '' || Number(manualCostUsd) < 0 || busy} onClick={() => void completeManually()}>{busy ? 'Completing…' : 'Complete manual order'}</button></section>}
      {['PROCESSING', 'CUSTOMER_ACTION_REQUIRED'].includes(selected.status) && <section className="drawer-section"><h3>Delivery proof</h3><p>Upload PNG, JPEG, or PDF proof before closing the order.</p><div className="upload-row"><input type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => setProof(event.target.files?.[0] ?? null)} /><button className="button" disabled={!proof || busy} onClick={() => void uploadProof()}>Upload proof</button></div>{selected.proofFiles.length > 0 && <p className="success-text">{selected.proofFiles.length} proof file(s) recorded.</p>}{selected.proofFiles.length > 0 && <button className="button confirm wide-button" disabled={busy} onClick={() => void setStatus(selected, 'COMPLETED', 'Delivery proof verified and order completed')}>Complete order</button>}</section>}
      <section className="drawer-section"><h3>Timeline</h3><ol className="timeline">{selected.statusHistory.map((event) => <li key={event.id}><span></span><div><strong>{label(event.next)}</strong><p>{event.reason || 'Status updated'} · {event.source}</p><time>{new Date(event.createdAt).toLocaleString()}</time></div></li>)}</ol></section>
      <section className="drawer-section"><h3>Operational notes</h3><div className="note-list">{selected.notes.map((entry) => <p key={entry.id}>{entry.body}<small>{new Date(entry.createdAt).toLocaleString()}</small></p>)}{!selected.notes.length && <p className="muted">No notes yet.</p>}</div><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a non-sensitive note" /><button className="button secondary" disabled={!note.trim() || busy} onClick={() => void addNote()}>Add note</button></section>
    </div></aside></div>}
  </div>;
}
