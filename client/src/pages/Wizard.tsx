import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type Contact, type Issue, type Order, type Persona, type Product, type Quote } from '../lib/api';
import { money, unitWord } from '../lib/format';
import { Banner, Field, Modal, MultiSelect, PlatformMark, PrimaryDomainWarning, Seg, Spinner, Switch } from '../components/ui';
import { Calculator } from '../components/Calculator';
import { CheckoutPanel, CostBreakdown, PURCHASE_TERMS, SummaryCard } from '../components/Checkout';

type StepKey = 'setup' | 'domains' | 'personas' | 'dns' | 'contact' | 'review';
const STEP_LABEL: Record<StepKey, string> = { setup: 'Setup', domains: 'Domains', personas: 'Senders', dns: 'DNS & forwarding', contact: 'Domain owner', review: 'Review & pay' };

export function WizardPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { catalog } = useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [cfg, setCfg] = useState<any>({});
  const [preview, setPreview] = useState<Quote | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [step, setStep] = useState<StepKey>('setup');
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const pending = useRef<any>({});
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api<{ order: Order; preview: Quote | null }>(`/orders/${id}`).then((r) => {
      if (r.order.journey !== 'fresh') { nav(`/store/prewarmed/${id}`, { replace: true }); return; }
      if (!['draft', 'awaiting_payment'].includes(r.order.status)) { nav(`/orders/${id}`, { replace: true }); return; }
      setOrder(r.order); setCfg(r.order.config); setPreview(r.preview);
      if (r.order.step && r.order.step in STEP_LABEL) setStep(r.order.step as StepKey);
    }).catch((e) => setLoadErr(e.message));
  }, [id, nav]);

  const product: Product | undefined = useMemo(() => catalog?.products.find((p) => p.code === cfg.productCode), [catalog, cfg.productCode]);
  const steps: StepKey[] = useMemo(() => ['setup', 'domains', ...(product?.needsPersonas ? ['personas' as const] : []), ...(product?.unit !== 'server' ? ['dns' as const] : []), 'contact', 'review'], [product]);

  const flush = useCallback(async (extra: { step?: string } = {}) => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length && !extra.step) return;
    setSaving(true);
    try {
      const r = await api<{ order: Order; preview: Quote | null }>(`/orders/${id}`, { method: 'PATCH', body: { config: patch, step: extra.step } });
      setOrder(r.order); setPreview(r.preview);
    } finally { setSaving(false); }
  }, [id]);

  const update = useCallback((patch: any) => {
    setCfg((c: any) => ({ ...c, ...patch }));
    pending.current = { ...pending.current, ...patch };
    setIssues((is) => is.filter((i) => !Object.keys(patch).some((k) => i.field.startsWith(k))));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { flush(); }, 450);
  }, [flush]);

  const go = async (target: StepKey) => {
    const idx = steps.indexOf(target);
    const cur = steps.indexOf(step);
    if (idx > cur) {
      await flush();
      const v = await api<{ issues: Issue[] }>(`/orders/${id}/validate`, { body: { step } });
      const blocking = v.issues.filter((i) => steps.indexOf(i.step as StepKey) <= cur && steps.indexOf(i.step as StepKey) >= 0);
      if (blocking.length) { setIssues(blocking); const first = blocking[0].step as StepKey; if (first !== step) setStep(first); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    }
    setIssues([]);
    setStep(target);
    await flush({ step: target });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loadErr) return <div className="page"><Banner tone="err">{loadErr}</Banner></div>;
  if (!order || !catalog) return <div className="page"><Spinner label="Loading your order…" /></div>;
  if (!product) return <div className="page"><Banner tone="warn">This product is no longer available. <Link to="/store">Choose another product</Link>.</Banner></div>;

  const idx = steps.indexOf(step);
  const stepIssues = issues.filter((i) => i.step === step);
  const fieldErr = (f: string) => issues.find((i) => i.field === f)?.message;
  const needDomains = product.needsDomains ? (product.unit === 'server' ? cfg.quantity * cfg.ratio : Math.ceil((cfg.quantity || 0) / Math.max(1, cfg.ratio || 1))) : 0;

  return (
    <div className="page">
      <div className="spread" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
        <div className="row"><PlatformMark platform={product.platform} size={38} /><div><h1 style={{ fontSize: 22 }}>{product.name}</h1><p className="small muted">{product.tagline}</p></div></div>
        <Link to="/store" className="small">← Change product</Link>
      </div>

      <div className="stepper" role="list">
        {steps.map((s, i) => (
          <div key={s} className="row" style={{ flex: i < steps.length - 1 ? 1 : 'none', gap: 0 }} role="listitem">
            <button type="button" className={`step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`} disabled={i > idx} onClick={() => i < idx && go(s)} aria-current={i === idx ? 'step' : undefined}>
              <span className="num">{i < idx ? '✓' : i + 1}</span>{STEP_LABEL[s]}
            </button>
            {i < steps.length - 1 && <div className={`step-line ${i < idx ? 'done' : ''}`} />}
          </div>
        ))}
      </div>

      <div className="wizard">
        <div className="stack" style={{ gap: 16 }}>
          {stepIssues.length > 0 && (
            <Banner tone="err"><b>Please fix the following:</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{stepIssues.map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul></Banner>
          )}
          {step === 'setup' && <SetupStep product={product} cfg={cfg} update={update} needDomains={needDomains} discount={product.annualDiscountPct} err={fieldErr} />}
          {step === 'domains' && <DomainsStep cfg={cfg} update={update} needDomains={needDomains} priceCents={catalog.pricing.domainPriceCents} />}
          {step === 'personas' && <PersonasStep cfg={cfg} update={update} order={order} quantity={cfg.quantity} ratio={cfg.ratio} />}
          {step === 'dns' && <DnsStep cfg={cfg} update={update} err={fieldErr} platform={product.platform} />}
          {step === 'contact' && <ContactStep cfg={cfg} update={update} err={fieldErr} />}
          {step === 'review' && <ReviewStep cfg={cfg} update={update} order={order} product={product} preview={preview} onIssues={(is) => { setIssues(is); const first = is.find((i) => i.step !== 'review'); if (first) setStep(first.step as StepKey); }} flush={flush} />}

          <div className="wizard-nav">
            {idx > 0 ? <button className="btn btn-ghost" onClick={() => go(steps[idx - 1])}>← Back</button> : <span />}
            {step !== 'review' && <button className="btn btn-primary" onClick={() => go(steps[idx + 1])} disabled={saving && false}>Continue →</button>}
          </div>
        </div>
        <SummaryCard
          title={product.name}
          loading={saving}
          quote={preview}
          rows={[
            ['Billing', cfg.term === 'annual' ? `Annual (save ${product.annualDiscountPct}%)` : 'Monthly'],
            [product.unit === 'server' ? 'Servers' : 'Mailboxes', String(cfg.quantity ?? '—')],
            ...(product.unit === 'tenant' ? [['Tenants', String(Math.ceil((cfg.quantity || 0) / (product.mailboxesPerUnit || 1)))] as [string, string]] : []),
            ['Domains', `${(cfg.domains ?? []).length} of ${needDomains}`],
          ]}
        />
      </div>
    </div>
  );
}

/* ---------------- Step 1: setup ---------------- */

function SetupStep({ product, cfg, update, needDomains, discount, err }: { product: Product; cfg: any; update: (p: any) => void; needDomains: number; discount: number; err: (f: string) => string | undefined }) {
  const [calc, setCalc] = useState(false);
  const [custom, setCustom] = useState(!product.qtyPresets.includes(cfg.quantity));
  const isServer = product.unit === 'server';
  const qtyLabel = isServer ? 'How many raw SMTP servers do you need?' : 'How many mailboxes would you like?';
  return (
    <>
      <div className="card card-pad stack">
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <div className="section-title"><div className="icon-dot">✉</div><h3>{qtyLabel}</h3></div>
          {!isServer && <button className="link-btn small" onClick={() => setCalc(true)}>🧮 Help me decide</button>}
        </div>
        <div className="tiles">
          {product.qtyPresets.map((n) => (
            <button key={n} type="button" className={`tile ${!custom && cfg.quantity === n ? 'selected' : ''}`} onClick={() => { setCustom(false); update({ quantity: n }); }}>
              <span className="radio" /><div className="big">{n}</div><div className="small muted">{unitWord(isServer ? 'server' : 'mailbox', n)}</div>
            </button>
          ))}
          <div className={`tile ${custom ? 'selected' : ''}`} onClick={() => setCustom(true)}>
            <div className="small muted" style={{ marginBottom: 6 }}>Custom</div>
            <input aria-label="Custom quantity" className={`input ${err('quantity') ? 'invalid' : ''}`} type="number" min={product.minQty} max={product.maxQty} value={cfg.quantity ?? ''} onFocus={() => setCustom(true)} onChange={(e) => update({ quantity: Math.max(0, Math.floor(Number(e.target.value))) })} />
          </div>
        </div>
        {err('quantity') && <span className="field-error">{err('quantity')}</span>}
        {product.unit === 'tenant' && <Banner tone="info">Azure is billed per tenant. {cfg.quantity || 0} mailboxes need <b>{Math.ceil((cfg.quantity || 0) / (product.mailboxesPerUnit || 1))} tenant(s)</b> with up to {product.mailboxesPerUnit} mailboxes each.</Banner>}
        {isServer && <Banner tone="ok" icon="⚡">Each server comes with a dedicated IP. Build as many SMTP inboxes as you need on it with Cloudlead’s free SMTP builder.</Banner>}
      </div>

      <div className="card card-pad stack">
        <div className="section-title"><div className="icon-dot">📅</div><h3>Billing</h3></div>
        <Seg value={cfg.term ?? 'monthly'} onChange={(v) => update({ term: v })} options={product.billingTerms.map((t) => ({ value: t, label: t === 'monthly' ? 'Monthly' : <>Annual <span className="badge ok" style={{ marginLeft: 6 }}>Save {discount}%</span></> }))} />
        <p className="small muted">
          {cfg.term === 'annual'
            ? `${money(Math.round(product.monthlyPriceCents * (1 - discount / 100)))} per ${product.unit} per month, charged once a year (${money(Math.round(product.monthlyPriceCents * (1 - discount / 100)) * 12)} per ${product.unit} per year).`
            : `${money(product.monthlyPriceCents)} per ${product.unit} per month, charged monthly. Cancel any time before renewal.`}
        </p>
      </div>

      <div className="card card-pad stack">
        <div className="section-title"><div className="icon-dot">🔗</div><h3>{isServer ? 'Domains per server' : 'Mailboxes per domain'}</h3></div>
        <p className="small muted">{isServer ? 'Spreading sending across several domains per server protects deliverability.' : 'Fewer mailboxes per domain spreads risk and protects deliverability. 2 to 3 is a common choice.'}</p>
        <div className="calc-box">
          <div className="accent">
            <div className="small muted">Ratio</div>
            <select aria-label="Ratio" className="select" style={{ marginTop: 6, fontWeight: 700, textAlign: 'center' }} value={cfg.ratio} onChange={(e) => update({ ratio: Number(e.target.value) })}>
              {product.allowedRatios.map((r) => <option key={r} value={r}>{isServer ? `${r} per server` : `${r} : 1`}</option>)}
            </select>
          </div>
          <div><div className="small muted">{isServer ? 'Servers' : 'Mailboxes'}</div><div className="big">{cfg.quantity || 0}</div><div className="tiny muted">selected</div></div>
          <div><div className="small muted">Domains</div><div className="big">{needDomains}</div><div className="tiny muted">will be registered</div></div>
        </div>
        <p className="small">💡 {isServer
          ? <>{cfg.quantity || 0} server(s) × {cfg.ratio} domains = <b>{needDomains} new domains</b>.</>
          : <>{cfg.quantity || 0} mailboxes ÷ {cfg.ratio} per domain = <b>{needDomains} new domain{needDomains === 1 ? '' : 's'}</b> (rounded up).</>}
        </p>
      </div>
      {calc && <Calculator onClose={() => setCalc(false)} onUse={(n) => { setCustom(!product.qtyPresets.includes(n)); update({ quantity: n }); setCalc(false); }} />}
    </>
  );
}

/* ---------------- Step 2: domains ---------------- */

function DomainsStep({ cfg, update, needDomains, priceCents }: { cfg: any; update: (p: any) => void; needDomains: number; priceCents: number }) {
  const [query, setQuery] = useState(cfg.primaryDomain ?? '');
  const [results, setResults] = useState<{ domain: string; priceCents: number }[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const selected: string[] = cfg.domains ?? [];

  const search = async (more = false) => {
    if (query.trim().length < 2) { setErr('Type at least 2 characters.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ results: any[]; nextOffset: number | null }>('/domains/search', { body: { query, offset: more ? next ?? 0 : 0, exclude: more ? results.map((x) => x.domain) : [], primaryDomain: query } });
      setResults(more ? [...results, ...r.results] : r.results);
      setNext(r.nextOffset);
      setSearched(true);
      if (!more) update({ primaryDomain: query });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const toggle = (d: string) => {
    if (selected.includes(d)) update({ domains: selected.filter((x) => x !== d) });
    else if (selected.length < needDomains) update({ domains: [...selected, d] });
  };

  return (
    <>
      <PrimaryDomainWarning />
      <div className="card card-pad stack">
        <div className="section-title"><div className="icon-dot">🌐</div><div><h3>Find your new .com domains</h3><p className="small muted">Enter your company name or main website. We’ll suggest similar names and check each one live.</p></div></div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); search(false); }}>
          <div className="input-group" style={{ flex: 1 }}>
            <input aria-label="Company name or main domain" className="input" placeholder="e.g. talenthire or talenthire.com" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="suffix">.com</span>
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy && !results.length ? 'Checking…' : 'Search'}</button>
        </form>
        {err && <span className="field-error">{err}</span>}
        <div className="spread small"><span className="muted">Only names confirmed available right now are shown. We check again just before payment.</span><span className="badge">{selected.length} / {needDomains} selected</span></div>
        {busy && !results.length && <div className="domain-grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}</div>}
        {searched && !busy && results.length === 0 && <div className="empty">No available names found for that search. Try a shorter or different word.</div>}
        {results.length > 0 && (
          <>
            <div className="domain-grid">
              {results.map((r) => {
                const on = selected.includes(r.domain);
                return (
                  <button key={r.domain} type="button" className={`domain-opt ${on ? 'on' : ''}`} onClick={() => toggle(r.domain)} disabled={!on && selected.length >= needDomains} aria-pressed={on}>
                    <span className="check">{on ? '✓' : ''}</span><span className="dname">{r.domain}</span><span className="small muted">{money(r.priceCents)}/yr</span>
                  </button>
                );
              })}
            </div>
            {next !== null && <div style={{ textAlign: 'center' }}><button className="btn btn-secondary" onClick={() => search(true)} disabled={busy}>{busy ? 'Checking…' : '+ Find more'}</button></div>}
          </>
        )}
      </div>

      <div className="card card-pad stack">
        <div className="spread"><h3>Selected domains</h3><span className="small muted">{selected.length} of {needDomains}</span></div>
        {selected.length === 0 ? <p className="small muted">Nothing selected yet.</p> : (
          <div className="row wrap">{selected.map((d) => <span key={d} className="chip">✓ {d}<button aria-label={`Remove ${d}`} onClick={() => toggle(d)}>×</button></span>)}</div>
        )}
        <div className="spread" style={{ background: 'var(--brand-50)', padding: 14, borderRadius: 12 }}>
          <div><div className="strong">Domain pricing</div><div className="small muted">{selected.length} × {money(priceCents)} / year · renews yearly</div></div>
          <div className="price" style={{ fontSize: 22 }}>{money(selected.length * priceCents)} <small>/ year</small></div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Step 3: senders ---------------- */

const blankPersona = (): Persona => ({ id: Math.random().toString(36).slice(2, 10), firstName: '', lastName: '', domains: 'all' });

function PersonasStep({ cfg, update, order, quantity, ratio }: { cfg: any; update: (p: any) => void; order: Order; quantity: number; ratio: number }) {
  const personas: Persona[] = cfg.personas ?? [];
  const domains: string[] = cfg.domains ?? [];
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const totalBoxes = personas.reduce((s, p) => s + (p.domains === 'all' ? domains.length : p.domains.filter((d) => domains.includes(d)).length), 0);
  const suggested = domains.length ? Math.ceil(quantity / domains.length) : ratio;

  useEffect(() => {
    if (personas.length === 0) update({ personas: Array.from({ length: Math.min(suggested, 20) }, blankPersona) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (i: number, patch: Partial<Persona>) => update({ personas: personas.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const addBulk = () => {
    const rows = bulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [first, ...rest] = l.split(/[\s,]+/);
      return { ...blankPersona(), firstName: first ?? '', lastName: rest.join(' ') };
    });
    const keep = personas.filter((p) => p.firstName || p.lastName);
    update({ personas: [...keep, ...rows] });
    setBulk(false); setBulkText('');
  };

  return (
    <>
      <div className="card card-pad stack">
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <div className="section-title"><div className="icon-dot">👤</div><div><h3>Who will the emails come from?</h3><p className="small muted">Add the sender names your recipients will see, and choose which domains each sender gets a mailbox on.</p></div></div>
          <span className={`badge ${totalBoxes === quantity ? 'ok' : 'warn'}`}>{totalBoxes} of {quantity} mailboxes</span>
        </div>
        <Banner tone="info">Tip: {domains.length} domains × {suggested} senders on all domains = <b>{domains.length * suggested} mailboxes</b>{domains.length * suggested !== quantity ? ` (you are buying ${quantity}; assign some senders to fewer domains)` : ''}.</Banner>
        <div className="row wrap">
          <Field label="Email address format">
            <select className="select" value={cfg.addressPattern ?? 'first.last'} onChange={(e) => update({ addressPattern: e.target.value })}>
              <option value="first.last">first.last@domain.com</option>
              <option value="first">first@domain.com</option>
              <option value="firstlast">firstlast@domain.com</option>
              <option value="flast">flast@domain.com</option>
              <option value="first_last">first_last@domain.com</option>
            </select>
          </Field>
        </div>
      </div>

      {personas.map((p, i) => (
        <div key={p.id} className="persona stack">
          <div className="spread">
            <div className="row"><div className="avatar">{(p.firstName[0] ?? '?').toUpperCase()}{(p.lastName[0] ?? '').toUpperCase()}</div><span className="strong">{p.firstName || p.lastName ? `${p.firstName} ${p.lastName}` : `Sender ${i + 1}`}</span></div>
            <button className="btn btn-ghost btn-sm" onClick={() => update({ personas: personas.filter((_, j) => j !== i) })} aria-label={`Remove sender ${i + 1}`}>Remove</button>
          </div>
          <div className="grid grid-3">
            <Field label="First name"><input className="input" value={p.firstName} onChange={(e) => set(i, { firstName: e.target.value })} /></Field>
            <Field label="Last name"><input className="input" value={p.lastName} onChange={(e) => set(i, { lastName: e.target.value })} /></Field>
            <Field label="Mailboxes on"><MultiSelect options={domains} value={p.domains} onChange={(v) => set(i, { domains: v })} /></Field>
          </div>
        </div>
      ))}
      <div className="row wrap">
        <button className="btn btn-secondary" onClick={() => update({ personas: [...personas, blankPersona()] })}>+ Add sender</button>
        <button className="btn btn-ghost" onClick={() => setBulk(true)}>Paste a list of names</button>
      </div>

      {order.mailboxes.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Mailboxes that will be created</h3><span className="small muted">{order.mailboxes.length} total</span></div>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 320 }}>
            <table className="table"><thead><tr><th>#</th><th>Sender</th><th>Email</th></tr></thead>
              <tbody>{order.mailboxes.map((m, i) => <tr key={m.address}><td className="muted">{i + 1}</td><td>{m.firstName} {m.lastName}</td><td className="mono">{m.address}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      <p className="small muted">Profile photos can be added after your mailboxes are created.</p>

      {bulk && (
        <Modal title="Paste sender names" subtitle="One name per line, e.g. “Sonal Shah”" onClose={() => setBulk(false)}>
          <div className="stack">
            <textarea className="textarea" rows={8} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={'Sonal Shah\nKedar Tapikar\nAmol Kale'} />
            <p className="small muted">Each sender is added to all domains. You can change that afterwards.</p>
            <div className="wizard-nav"><button className="btn btn-ghost" onClick={() => setBulk(false)}>Cancel</button><button className="btn btn-primary" onClick={addBulk}>Add senders</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Step 4: DNS ---------------- */

function DnsStep({ cfg, update, err, platform }: { cfg: any; update: (p: any) => void; err: (f: string) => string | undefined; platform: string }) {
  const auto = cfg.autoDns !== false;
  return (
    <>
      <div className="card card-pad stack">
        <div className="section-title"><div className="icon-dot">↪</div><div><h3>Forwarding website</h3><p className="small muted">People who type one of your new domains into a browser will be sent here. Usually your main website.</p></div></div>
        <Field label="Forward visitors to" error={err('forwardingUrl')} hint="Optional, but recommended: it makes your sending domains look legitimate.">
          <input className={`input ${err('forwardingUrl') ? 'invalid' : ''}`} placeholder="yourcompany.com" value={cfg.forwardingUrl ?? ''} onChange={(e) => update({ forwardingUrl: e.target.value })} />
        </Field>
      </div>
      <div className="card card-pad stack">
        <div className="spread">
          <div className="section-title"><div className="icon-dot">⚙</div><div><h3>Automatic DNS setup</h3><p className="small muted">We create and verify the records your mailboxes need to land in the inbox.</p></div></div>
          <Switch on={auto} onChange={(v) => update({ autoDns: v })} label="Automatic DNS setup" />
        </div>
        {auto ? (
          <ul className="features">
            <li>MX records for {platform === 'google' ? 'Google Workspace' : platform === 'smtp' ? 'your SMTP mailboxes' : 'Microsoft'}</li>
            <li>SPF and DKIM so receivers trust your messages</li>
            <li>DMARC policy for reporting</li>
            {cfg.forwardingUrl && <li>Redirect to {cfg.forwardingUrl}</li>}
          </ul>
        ) : <Banner tone="warn">You will need to add the DNS records yourself. We will show you the exact records after setup. Mistakes here are the most common cause of emails landing in spam.</Banner>}
        <p className="small muted">You will see each record’s status on your order page. We only show a record as done once the DNS provider confirms it.</p>
      </div>
    </>
  );
}

/* ---------------- Step 5: contact ---------------- */

const CONTACT_FIELDS: { key: keyof Contact; label: string; span?: boolean; placeholder?: string; auto?: string }[] = [
  { key: 'firstName', label: 'First name', auto: 'given-name' }, { key: 'lastName', label: 'Last name', auto: 'family-name' },
  { key: 'company', label: 'Company (optional)', auto: 'organization' }, { key: 'email', label: 'Email', auto: 'email' },
  { key: 'phone', label: 'Phone (with country code)', placeholder: '+1 415 555 0100', auto: 'tel' }, { key: 'country', label: 'Country code', placeholder: 'US', auto: 'country' },
  { key: 'address1', label: 'Street address', span: true, auto: 'address-line1' }, { key: 'address2', label: 'Apartment, suite (optional)', span: true, auto: 'address-line2' },
  { key: 'city', label: 'City', auto: 'address-level2' }, { key: 'state', label: 'State / province', auto: 'address-level1' }, { key: 'postalCode', label: 'ZIP / postal code', auto: 'postal-code' },
];

function ContactStep({ cfg, update, err }: { cfg: any; update: (p: any) => void; err: (f: string) => string | undefined }) {
  const c = cfg.contact ?? {};
  return (
    <div className="card card-pad stack">
      <div className="section-title"><div className="icon-dot">🪪</div><div><h3>Domain owner details</h3><p className="small muted">Domains are registered in your name. Registrars require these details; privacy protection keeps them out of the public WHOIS where available.</p></div></div>
      <div className="grid grid-2">
        {CONTACT_FIELDS.map((f) => (
          <div key={f.key} style={f.span ? { gridColumn: '1 / -1' } : undefined}>
            <Field label={f.label} error={err(`contact.${f.key}`)}>
              <input className={`input ${err(`contact.${f.key}`) ? 'invalid' : ''}`} autoComplete={f.auto} placeholder={f.placeholder} value={c[f.key] ?? ''} onChange={(e) => update({ contact: { ...c, [f.key]: e.target.value } })} />
            </Field>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Step 6: review ---------------- */

function ReviewStep({ cfg, update, order, product, preview, onIssues, flush }: { cfg: any; update: (p: any) => void; order: Order; product: Product; preview: Quote | null; onIssues: (i: Issue[]) => void; flush: () => Promise<void> }) {
  const [, setPaid] = useState<Order | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { flush().then(() => setReady(true)); }, [flush]);
  return (
    <>
      <div className="card">
        <div className="card-head"><div className="section-title"><PlatformMark platform={product.platform} size={32} /><h3>{product.name}</h3></div><span className="badge">{cfg.term === 'annual' ? 'Billed annually' : 'Billed monthly'}</span></div>
        <div className="card-pad grid grid-3">
          <div><div className="small muted">{product.unit === 'server' ? 'Servers' : 'Mailboxes'}</div><div className="strong">{cfg.quantity}</div></div>
          <div><div className="small muted">New domains</div><div className="strong">{(cfg.domains ?? []).length}</div></div>
          <div><div className="small muted">Forwarding to</div><div className="strong">{cfg.forwardingUrl || '—'}</div></div>
        </div>
      </div>

      {order.mailboxes.length > 0 ? (
        <div className="card">
          <div className="card-head"><h3>Mailboxes</h3><span className="small muted">{order.mailboxes.length} ready to set up</span></div>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 300 }}>
            <table className="table"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Domain</th></tr></thead>
              <tbody>{order.mailboxes.map((m, i) => <tr key={m.address}><td className="muted">{i + 1}</td><td>{m.firstName} {m.lastName}</td><td className="mono">{m.address}</td><td className="muted">{m.domain}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card card-pad stack"><h3>Domains</h3><div className="row wrap">{(cfg.domains ?? []).map((d: string) => <span key={d} className="chip">{d}</span>)}</div></div>
      )}

      <div className="card card-pad stack">
        <h3>Cost summary</h3>
        {preview ? <CostBreakdown quote={preview} /> : <Spinner label="Calculating…" />}
      </div>

      <PrimaryDomainWarning />

      <div className="card card-pad stack">
        <h3>Before you pay</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }} className="small">{PURCHASE_TERMS.map((t) => <li key={t}>{t}</li>)}</ul>
        <label className="checkbox"><input type="checkbox" checked={!!cfg.acceptedTerms} onChange={(e) => update({ acceptedTerms: e.target.checked })} /><span>I agree to these terms and understand the billing schedule above.</span></label>
      </div>

      {ready && <CheckoutPanel order={order} onIssues={onIssues} onPaid={setPaid} />}
    </>
  );
}
