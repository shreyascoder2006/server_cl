import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { Banner, Field, Modal, Spinner, StatusBadge, Switch, useToast } from '../components/ui';

type Tab = 'products' | 'settings' | 'integrations' | 'orders' | 'audit';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('products');
  const { node, toast } = useToast();
  return (
    <div className="page">
      <div className="spread" style={{ marginBottom: 12 }}><h1>Admin</h1><span className="badge">Cloudlead staff only</span></div>
      <div className="tabs" role="tablist">
        {([['products', 'Products & pricing'], ['settings', 'Global settings'], ['integrations', 'Integrations'], ['orders', 'Orders'], ['audit', 'Audit log']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'products' && <ProductsTab toast={toast} />}
      {tab === 'settings' && <SettingsTab toast={toast} />}
      {tab === 'integrations' && <IntegrationsTab toast={toast} />}
      {tab === 'orders' && <OrdersTab toast={toast} />}
      {tab === 'audit' && <AuditTab />}
      {node}
    </div>
  );
}

const dollars = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));
const toCents = (s: string) => Math.round(Number(s) * 100);

function ProductsTab({ toast }: { toast: (s: string) => void }) {
  const { refreshCatalog } = useApp();
  const [data, setData] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const load = () => api('/admin/products').then(setData);
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;
  const toggle = async (p: any) => { await api(`/admin/products/${p.code}`, { method: 'PATCH', body: { enabled: !p.enabled } }); toast(`${p.name} ${p.enabled ? 'hidden from' : 'shown in'} the store`); load(); refreshCatalog(); };
  return (
    <div className="stack">
      <p className="small muted">Every price, discount, quantity limit and ratio below is used by the server when it prices an order. Vendor and cost columns are never shown to customers.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>On</th><th>Product</th><th>Vendor</th><th>Unit</th><th className="right">Price / mo</th><th className="right">Annual</th><th className="right">Our cost</th><th className="right">Margin</th><th>Ratios</th><th /></tr></thead>
          <tbody>{data.products.map((p: any) => {
            const disc = p.annualDiscountPct ?? data.settings.annual_discount_pct;
            const margin = p.costCents ? Math.round(((p.monthlyPriceCents - p.costCents) / p.monthlyPriceCents) * 100) : null;
            return (
              <tr key={p.code}>
                <td><Switch on={p.enabled} onChange={() => toggle(p)} label={`Enable ${p.name}`} /></td>
                <td><div className="strong">{p.name}</div><div className="tiny muted">{p.code}</div></td>
                <td>{data.providers.find((v: any) => v.id === p.providerId)?.name}</td>
                <td>{p.unit}{p.mailboxesPerUnit ? ` (${p.mailboxesPerUnit})` : ''}</td>
                <td className="right strong">{money(p.monthlyPriceCents)}</td>
                <td className="right">{disc}%{p.annualDiscountPct === null && <span className="tiny muted"> (default)</span>}</td>
                <td className="right">{money(p.costCents)}</td>
                <td className="right">{margin === null ? '—' : <span className={`badge ${margin < 0 ? 'err' : margin < 15 ? 'warn' : 'ok'}`}>{margin}%</span>}</td>
                <td className="small">{p.allowedRatios.join(', ')}</td>
                <td><button className="btn btn-secondary btn-sm" onClick={() => setEdit(p)}>Edit</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {edit && <ProductEditor product={edit} providers={data.providers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); refreshCatalog(); toast('Saved. New prices apply to new quotes immediately.'); }} />}
    </div>
  );
}

function ProductEditor({ product, providers, onClose, onSaved }: { product: any; providers: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: product.name, tagline: product.tagline, description: product.description, features: product.features.join('\n'), provider_id: product.providerId,
    badge: product.badge ?? '', featured: product.featured, monthly: dollars(product.monthlyPriceCents), discount: product.annualDiscountPct ?? '', setup: dollars(product.setupFeeCents),
    cost: dollars(product.costCents), min: product.minQty, max: product.maxQty, presets: product.qtyPresets.join(', '), ratios: product.allowedRatios.join(', '), defRatio: product.defaultRatio,
    perUnit: product.mailboxesPerUnit ?? '', monthlyTerm: product.billingTerms.includes('monthly'), annualTerm: product.billingTerms.includes('annual'),
    tiers: (product.priceTiers ?? []).map((t: any) => `${t.key} | ${t.label} | ${dollars(t.monthly_price_cents)}`).join('\n'),
  });
  const [err, setErr] = useState<string | null>(null);
  const nums = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const save = async () => {
    setErr(null);
    try {
      const body: any = {
        name: f.name, tagline: f.tagline, description: f.description, features: f.features.split('\n').map((s: string) => s.trim()).filter(Boolean), provider_id: f.provider_id,
        badge: f.badge.trim() || null, featured: f.featured, monthly_price_cents: toCents(f.monthly), annual_discount_pct: f.discount === '' ? null : Number(f.discount),
        setup_fee_cents: toCents(f.setup || '0'), cost_cents: f.cost === '' ? null : toCents(f.cost), min_qty: Number(f.min), max_qty: Number(f.max), qty_presets: nums(f.presets),
        allowed_ratios: nums(f.ratios), default_ratio: Number(f.defRatio), mailboxes_per_unit: f.perUnit === '' ? null : Number(f.perUnit),
        billing_terms: [...(f.monthlyTerm ? ['monthly'] : []), ...(f.annualTerm ? ['annual'] : [])],
      };
      if (product.category === 'prewarmed') body.price_tiers = f.tiers.split('\n').filter((l: string) => l.trim()).map((l: string) => { const [key, label, price] = l.split('|').map((s) => s.trim()); return { key, label, monthly_price_cents: toCents(price) }; });
      await api(`/admin/products/${product.code}`, { method: 'PATCH', body });
      onSaved();
    } catch (e: any) { setErr(e.details ? `${e.message} ${e.details.map?.((d: any) => `${d.path?.join('.')}: ${d.message}`).join('; ') ?? ''}` : e.message); }
  };
  const inp = (k: keyof typeof f, label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={hint}><input className="input" type={type} value={f[k] as any} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <Modal title={`Edit ${product.name}`} subtitle="Changes are recorded in the audit log" onClose={onClose}>
      <div className="stack">
        {err && <Banner tone="err">{err}</Banner>}
        <div className="grid grid-2">
          {inp('name', 'Customer-facing name')}
          <Field label="Vendor (admin only)"><select className="select" value={f.provider_id} onChange={(e) => setF({ ...f, provider_id: e.target.value })}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          {inp('monthly', 'Price per unit per month (USD)', undefined, 'number')}
          {inp('discount', 'Annual discount % (blank = global default)', undefined, 'number')}
          {inp('cost', 'Our cost per unit per month (USD)', 'Used for margin only', 'number')}
          {inp('setup', 'One-time setup fee per unit (USD)', undefined, 'number')}
          {inp('min', 'Minimum quantity', undefined, 'number')}
          {inp('max', 'Maximum quantity', undefined, 'number')}
          {inp('presets', 'Quantity presets', 'Comma separated, e.g. 10, 20, 50, 100')}
          {inp('ratios', product.unit === 'server' ? 'Domains per server options' : 'Mailbox : domain ratio options', 'Comma separated')}
          {inp('defRatio', 'Default ratio', undefined, 'number')}
          {product.unit === 'tenant' && inp('perUnit', 'Mailboxes per tenant', undefined, 'number')}
          {inp('badge', 'Badge (optional)')}
          {inp('tagline', 'Tagline')}
        </div>
        <Field label="Description"><textarea className="textarea" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Features (one per line)"><textarea className="textarea" rows={4} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} /></Field>
        {product.category === 'prewarmed' && <Field label="Warmup tiers (key | label | USD per mailbox per month)"><textarea className="textarea mono" rows={3} value={f.tiers} onChange={(e) => setF({ ...f, tiers: e.target.value })} /></Field>}
        <div className="row wrap">
          <label className="checkbox"><input type="checkbox" checked={f.monthlyTerm} onChange={(e) => setF({ ...f, monthlyTerm: e.target.checked })} />Offer monthly</label>
          <label className="checkbox"><input type="checkbox" checked={f.annualTerm} onChange={(e) => setF({ ...f, annualTerm: e.target.checked })} />Offer annual</label>
          <label className="checkbox"><input type="checkbox" checked={f.featured} onChange={(e) => setF({ ...f, featured: e.target.checked })} />Featured</label>
        </div>
        <div className="wizard-nav"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save changes</button></div>
      </div>
    </Modal>
  );
}

function SettingsTab({ toast }: { toast: (s: string) => void }) {
  const { refreshCatalog } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const load = () => api('/admin/settings').then((r: any) => { setRows(r.settings); setVals(Object.fromEntries(r.settings.map((s: any) => [s.key, s.kind === 'cents' ? dollars(s.value) : String(s.value)]))); });
  useEffect(() => { load(); }, []);
  if (!rows) return <Spinner />;
  const save = async () => {
    const body = Object.fromEntries(rows.map((s) => [s.key, s.kind === 'cents' ? toCents(vals[s.key]) : Number(vals[s.key])]));
    try { await api('/admin/settings', { method: 'PATCH', body }); toast('Settings saved'); load(); refreshCatalog(); } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="card card-pad stack" style={{ maxWidth: 720 }}>
      <div className="grid grid-2">
        {rows.map((s) => <Field key={s.key} label={s.label.replace('(cents / year)', '(USD / year)').replace('(cents)', '(USD)')}><input className="input" type="number" step="any" value={vals[s.key]} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} /></Field>)}
      </div>
      <div><button className="btn btn-primary" onClick={save}>Save settings</button></div>
    </div>
  );
}

function IntegrationsTab({ toast }: { toast: (s: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [health, setHealth] = useState<Record<string, any>>({});
  const [running, setRunning] = useState<string | null>(null);
  const load = () => api('/admin/providers').then(setData);
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;
  const patch = async (id: string, body: any) => { await api(`/admin/providers/${id}`, { method: 'PATCH', body }); load(); toast('Updated'); };
  const check = async (id: string) => { setRunning(id); try { const r = await api(`/admin/providers/${id}/health`, { method: 'POST' }); setHealth({ ...health, [id]: r }); } finally { setRunning(null); } };
  return (
    <div className="stack">
      <div className="grid grid-3">
        <div className="kpi"><div className="small muted">Global provider mode (.env)</div><div className="v">{data.globalMode.toUpperCase()}</div><div className="tiny muted">PROVIDER_MODE. Must be "live" for any real call.</div></div>
        <div className="kpi"><div className="small muted">Payment gateway</div><div className="v">{data.paymentGateway}</div><div className="tiny muted">PAYMENT_GATEWAY. Stripe is wired by Akshay.</div></div>
        <div className="kpi"><div className="small muted">Live providers</div><div className="v">{data.providers.filter((p: any) => p.modeInfo.effective === 'live').length} / {data.providers.length}</div></div>
      </div>
      <Banner tone="info">Health checks only run read-only calls. Checks that could buy something or create resources are listed but never run automatically.</Banner>
      {data.providers.map((p: any) => (
        <div key={p.id} className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <div><h3>{p.name}</h3><p className="small muted">{p.purpose}</p></div>
            <div className="row wrap">
              <span className={`badge ${p.modeInfo.effective === 'live' ? 'ok' : 'grey'}`}>Running: {p.modeInfo.effective}</span>
              <select aria-label={`${p.name} mode`} className="select" style={{ width: 120 }} value={p.mode} onChange={(e) => patch(p.id, { mode: e.target.value })}><option value="mock">Mock</option><option value="live">Live</option></select>
              <span className="row small">Enabled <Switch on={p.enabled} onChange={(v) => patch(p.id, { enabled: v })} label={`Enable ${p.name}`} /></span>
              <button className="btn btn-secondary btn-sm" onClick={() => check(p.id)} disabled={running === p.id}>{running === p.id ? 'Checking…' : 'Run health check'}</button>
            </div>
          </div>
          <div className="card-pad stack" style={{ gap: 8 }}>
            <p className="small">{p.modeInfo.reason} {p.docs_url && <a href={p.docs_url} target="_blank" rel="noreferrer">API docs ↗</a>}</p>
            {health[p.id] && (
              <ul className="timeline">{health[p.id].checks.map((c: any) => (
                <li key={c.name}><span className={`status-dot ${c.ok ? 'succeeded' : c.billable ? 'pending' : 'failed'}`} /><span style={{ flex: 1 }}><b className="small">{c.name}</b><div className="tiny muted">{c.detail}</div></span>{c.billable && <span className="badge warn">May incur charges</span>}</li>
              ))}</ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OrdersTab({ toast }: { toast: (s: string) => void }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  const load = () => api(`/admin/orders?status=${status}`).then((r: any) => setRows(r.orders));
  useEffect(() => { load(); }, [status]);
  const show = async (id: string) => setOpen(await api(`/admin/orders/${id}`));
  const retry = async () => { try { await api(`/admin/orders/${open.order.id}/retry`, { method: 'POST' }); toast('Retried'); show(open.order.id); load(); } catch (e: any) { toast(e.message); } };
  const resolve = async (stepKey: string, outcome: string) => { await api(`/admin/orders/${open.order.id}/resolve-step`, { body: { stepKey, outcome } }); show(open.order.id); };
  return (
    <div className="stack">
      <div className="row"><select className="select" style={{ width: 240 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
        <option value="">All statuses</option>{['draft', 'awaiting_payment', 'payment_authorized', 'submitting', 'provider_pending', 'submitted', 'needs_review', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select></div>
      {!rows ? <Spinner /> : rows.length === 0 ? <div className="empty">No orders.</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Status</th><th className="right">Total</th><th>Updated</th></tr></thead>
          <tbody>{rows.map((o) => <tr key={o.id} className="clickable" onClick={() => show(o.id)}><td className="mono">{o.id.slice(0, 12)}</td><td><div>{o.tenant}</div><div className="tiny muted">{o.email}</div></td><td>{o.product_code ?? o.journey}</td><td><StatusBadge status={o.status} /></td><td className="right">{money(o.total_due_cents)}</td><td className="small muted">{fmtDate(o.updated_at)}</td></tr>)}</tbody>
        </table></div>
      )}
      {open && (
        <Modal title={`Order ${open.order.id}`} subtitle={`${open.order.productName} · ${open.order.status}`} onClose={() => setOpen(null)}>
          <div className="stack">
            {['failed', 'needs_review'].includes(open.order.status) && <div className="row"><button className="btn btn-primary btn-sm" onClick={retry}>Retry remaining steps</button><span className="small muted">Completed steps are skipped, so nothing is bought twice.</span></div>}
            <h3>Provider requests</h3>
            {open.providerRequests.length === 0 ? <p className="small muted">None yet.</p> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>Step</th><th>Vendor</th><th>Mode</th><th>Status</th><th>Ref / error</th><th /></tr></thead>
                <tbody>{open.providerRequests.map((r: any) => (
                  <tr key={r.id}><td className="small">{r.step_key}</td><td>{r.provider}</td><td><span className="badge grey">{r.mode}</span></td><td><StatusBadge status={r.status} /></td><td className="tiny">{r.external_ref ?? r.error}</td>
                    <td>{r.status === 'unknown' && <div className="row"><button className="btn btn-sm btn-secondary" onClick={() => resolve(r.step_key, 'succeeded')}>It went through</button><button className="btn btn-sm btn-danger" onClick={() => resolve(r.step_key, 'failed')}>It failed</button></div>}</td></tr>
                ))}</tbody></table></div>
            )}
            <h3>Payments</h3>
            {open.payments.map((p: any) => <div key={p.id} className="small">{p.gateway} · {p.status} · {money(p.amount_cents)} · <span className="mono">{p.id}</span></div>)}
            <h3>History</h3>
            <ul className="timeline">{open.order.events.map((e: any, i: number) => <li key={i}><span className="small muted" style={{ width: 150 }}>{fmtDate(e.created_at)}</span><span className="small"><b>{e.to_status}</b> · {e.note} <span className="muted">({e.actor})</span></span></li>)}</ul>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api('/admin/audit').then((r: any) => setRows(r.entries)); }, []);
  if (!rows) return <Spinner />;
  return rows.length === 0 ? <div className="empty">No changes recorded yet.</div> : (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td className="small muted">{fmtDate(r.created_at)}</td><td className="small">{r.email ?? 'system'}</td><td className="small"><b>{r.action}</b> {r.entity} {r.entity_id}</td><td className="tiny mono" style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{summarize(r)}</td></tr>)}</tbody>
    </table></div>
  );
}

function summarize(r: any) {
  try {
    const a = JSON.parse(r.before_json ?? 'null'); const b = JSON.parse(r.after_json ?? 'null');
    if (!a || !b || typeof a !== 'object') return '';
    return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && k !== 'updatedAt' && k !== 'updated_at').map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`).join('; ');
  } catch { return ''; }
}
