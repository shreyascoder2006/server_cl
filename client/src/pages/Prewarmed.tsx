import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type Issue, type Order, type Quote } from '../lib/api';
import { money } from '../lib/format';
import { Banner, Field, PlatformMark, PrimaryDomainWarning, Seg, Spinner } from '../components/ui';
import { CheckoutPanel, CostBreakdown, PURCHASE_TERMS, SummaryCard } from '../components/Checkout';

interface Listing {
  domain: string; platform: 'google' | 'microsoft'; tierKey: string; tierLabel: string; warmupWeeks: number; mailboxes: { address: string; name: string }[];
  domainExpires: string; recommended?: boolean; monthlyPerMailboxCents: number; annualPerMailboxMonthlyCents: number; domainFeeCents: number;
}
interface Pick { domain: string; platform: 'google' | 'microsoft'; tierKey: string; mailboxes: number }

export function PrewarmedPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { catalog } = useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [cfg, setCfg] = useState<any>({ picks: [], term: 'monthly' });
  const [preview, setPreview] = useState<Quote | null>(null);
  const [items, setItems] = useState<Listing[] | null>(null);
  const [tiers, setTiers] = useState<{ key: string; label: string }[]>([]);
  const [filters, setFilters] = useState({ platform: '', tier: '', q: '' });
  const [stage, setStage] = useState<'browse' | 'details' | 'review'>('browse');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ order: Order; preview: Quote | null }>(`/orders/${id}`).then((r) => {
      if (!['draft', 'awaiting_payment'].includes(r.order.status)) { nav(`/orders/${id}`, { replace: true }); return; }
      setOrder(r.order); setCfg(r.order.config); setPreview(r.preview);
      if (r.order.status === 'awaiting_payment') setStage('review');
    }).catch((e) => setErr(e.message));
  }, [id, nav]);

  useEffect(() => {
    const qs = new URLSearchParams({ platform: filters.platform, tier: filters.tier, q: filters.q });
    const t = setTimeout(() => api<{ items: Listing[]; tiers: any[] }>(`/prewarmed?${qs}`).then((r) => { setItems(r.items); setTiers(r.tiers); }).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [filters]);

  const save = useCallback(async (patch: any, step?: string) => {
    setCfg((c: any) => ({ ...c, ...patch }));
    setSaving(true);
    try {
      const r = await api<{ order: Order; preview: Quote | null }>(`/orders/${id}`, { method: 'PATCH', body: { config: patch, step } });
      setOrder(r.order); setPreview(r.preview);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }, [id]);

  const picks: Pick[] = cfg.picks ?? [];
  const inCart = useMemo(() => new Set(picks.map((p) => p.domain)), [picks]);
  const toggle = (l: Listing) => save({ picks: inCart.has(l.domain) ? picks.filter((p) => p.domain !== l.domain) : [...picks, { domain: l.domain, platform: l.platform, tierKey: l.tierKey, mailboxes: l.mailboxes.length }] });

  const next = async (to: 'details' | 'review') => {
    const v = await api<{ issues: Issue[] }>(`/orders/${id}/validate`, { body: { step: to === 'details' ? 'browse' : 'contact' } });
    if (v.issues.length) { setIssues(v.issues); return; }
    setIssues([]); setStage(to); await save({}, to === 'details' ? 'contact' : 'review'); window.scrollTo({ top: 0 });
  };

  if (err && !order) return <div className="page"><Banner tone="err">{err}</Banner></div>;
  if (!order || !catalog) return <div className="page"><Spinner label="Loading…" /></div>;
  const c = cfg.contact ?? {};
  const fieldErr = (f: string) => issues.find((i) => i.field === f)?.message;

  return (
    <div className="page">
      <div className="spread" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        <div><h1 style={{ fontSize: 22 }}>Pre-warmed mailboxes</h1><p className="small muted">Domains and inboxes with an existing sending history. Ready to use from day one.</p></div>
        <Link to="/store" className="small">← Back to store</Link>
      </div>
      <div className="row wrap" style={{ marginBottom: 16, gap: 8 }}>
        {(['browse', 'details', 'review'] as const).map((s, i) => <span key={s} className={`badge ${stage === s ? '' : 'grey'}`}>{i + 1}. {s === 'browse' ? 'Choose domains' : s === 'details' ? 'Your details' : 'Review & pay'}</span>)}
      </div>

      <div className="wizard">
        <div className="stack">
          {issues.length > 0 && <Banner tone="err"><ul style={{ margin: 0, paddingLeft: 18 }}>{issues.map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul></Banner>}
          {err && order && <Banner tone="err">{err}</Banner>}

          {stage === 'browse' && (
            <>
              <div className="card card-pad row wrap">
                <input aria-label="Search domains" className="input" style={{ flex: '1 1 220px' }} placeholder="Search domains…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
                <select aria-label="Provider" className="select" style={{ width: 200 }} value={filters.platform} onChange={(e) => setFilters({ ...filters, platform: e.target.value })}>
                  <option value="">Google + Microsoft</option><option value="google">Google Workspace</option><option value="microsoft">Microsoft 365</option>
                </select>
                <select aria-label="Warmup age" className="select" style={{ width: 200 }} value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value })}>
                  <option value="">Any warmup age</option>{tiers.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              {!items ? <div className="grid grid-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 180 }} />)}</div>
                : items.length === 0 ? <div className="empty">No pre-warmed domains match these filters right now.</div>
                  : (
                    <div className="grid grid-2">
                      {items.map((l) => (
                        <div key={l.domain} className={`pw-card ${inCart.has(l.domain) ? 'in-cart' : ''}`}>
                          <div className="spread">
                            <div className="row"><PlatformMark platform={l.platform} size={32} /><div><div className="strong">{l.domain}</div><div className="tiny muted">Domain renews {l.domainExpires}</div></div></div>
                            {l.recommended && <span className="badge accent">Recommended</span>}
                          </div>
                          <div className="row wrap" style={{ gap: 6 }}>
                            <span className="badge grey">{l.mailboxes.length} mailboxes</span>
                            <span className="badge ok">🔥 {l.tierLabel}</span>
                            <span className="badge grey">{money(cfg.term === 'annual' ? l.annualPerMailboxMonthlyCents : l.monthlyPerMailboxCents)} / mailbox / mo</span>
                          </div>
                          <div className="mini-boxes">{l.mailboxes.map((m) => <span key={m.address}>{m.address}</span>)}</div>
                          <div className="spread">
                            <span className="small muted">{money(l.mailboxes.length * (cfg.term === 'annual' ? l.annualPerMailboxMonthlyCents : l.monthlyPerMailboxCents))}/mo + {money(l.domainFeeCents)}/yr domain</span>
                            <button className={`btn btn-sm ${inCart.has(l.domain) ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggle(l)} disabled={saving}>{inCart.has(l.domain) ? 'Remove' : '+ Add'}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              <div className="wizard-nav"><span /><button className="btn btn-primary" disabled={!picks.length} onClick={() => next('details')}>Continue with {picks.length} domain{picks.length === 1 ? '' : 's'} →</button></div>
            </>
          )}

          {stage === 'details' && (
            <>
              <div className="card card-pad stack">
                <h3>Forwarding website</h3>
                <Field label="Forward visitors of these domains to" error={fieldErr('forwardingUrl')} hint="Usually your main website.">
                  <input className="input" placeholder="yourcompany.com" value={cfg.forwardingUrl ?? ''} onChange={(e) => setCfg({ ...cfg, forwardingUrl: e.target.value })} onBlur={() => save({ forwardingUrl: cfg.forwardingUrl })} />
                </Field>
              </div>
              <div className="card card-pad stack">
                <h3>Your contact details</h3>
                <p className="small muted">Used to transfer the domains into your name.</p>
                <div className="grid grid-2">
                  {[['firstName', 'First name'], ['lastName', 'Last name'], ['company', 'Company (optional)'], ['email', 'Email'], ['phone', 'Phone (with country code)'], ['country', 'Country code (e.g. US)'], ['address1', 'Street address'], ['city', 'City'], ['state', 'State / province'], ['postalCode', 'ZIP / postal code']].map(([k, label]) => (
                    <Field key={k} label={label} error={fieldErr(`contact.${k}`)}>
                      <input className={`input ${fieldErr(`contact.${k}`) ? 'invalid' : ''}`} value={c[k] ?? ''} onChange={(e) => setCfg({ ...cfg, contact: { ...c, [k]: e.target.value } })} onBlur={() => save({ contact: cfg.contact })} />
                    </Field>
                  ))}
                </div>
              </div>
              <div className="wizard-nav"><button className="btn btn-ghost" onClick={() => setStage('browse')}>← Back</button><button className="btn btn-primary" onClick={async () => { await save({ forwardingUrl: cfg.forwardingUrl, contact: cfg.contact }); next('review'); }}>Review order →</button></div>
            </>
          )}

          {stage === 'review' && (
            <>
              <div className="card">
                <div className="card-head"><h3>Selected domains</h3><span className="small muted">{picks.length} domains · {picks.reduce((s, p) => s + p.mailboxes, 0)} mailboxes</span></div>
                <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="table"><thead><tr><th>Domain</th><th>Platform</th><th>Mailboxes</th></tr></thead>
                    <tbody>{picks.map((p) => <tr key={p.domain}><td className="strong">{p.domain}</td><td>{p.platform === 'google' ? 'Google Workspace' : 'Microsoft 365'}</td><td>{p.mailboxes}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
              <div className="card card-pad stack"><h3>Cost summary</h3>{preview ? <CostBreakdown quote={preview} /> : <Spinner />}</div>
              <PrimaryDomainWarning />
              <div className="card card-pad stack">
                <h3>Before you pay</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }} className="small">{PURCHASE_TERMS.filter((t) => !t.startsWith('More mailboxes')).map((t) => <li key={t}>{t}</li>)}</ul>
                <label className="checkbox"><input type="checkbox" checked={!!cfg.acceptedTerms} onChange={(e) => save({ acceptedTerms: e.target.checked })} /><span>I agree to these terms and understand the billing schedule above.</span></label>
              </div>
              <CheckoutPanel order={order} onIssues={(is) => { setIssues(is); if (is.some((i) => i.step !== 'review')) setStage(is[0].step === 'browse' ? 'browse' : 'details'); }} onPaid={() => {}} />
              <div><button className="btn btn-ghost" onClick={() => setStage('details')}>← Back</button></div>
            </>
          )}
        </div>

        <div className="stack">
          <div className="card card-pad stack">
            <h3>Billing</h3>
            <Seg value={cfg.term ?? 'monthly'} onChange={(v) => save({ term: v })} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: <>Annual <span className="badge ok">-{catalog.pricing.annualDiscountPct}%</span></> }]} />
          </div>
          <SummaryCard title="Pre-warmed mailboxes" loading={saving} quote={preview} rows={[['Domains', String(picks.length)], ['Mailboxes', String(picks.reduce((s, p) => s + p.mailboxes, 0))]]} />
        </div>
      </div>
    </div>
  );
}
