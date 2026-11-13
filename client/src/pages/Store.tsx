import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, type Order, type Product } from '../lib/api';
import { money } from '../lib/format';
import { Banner, PlatformMark, PrimaryDomainWarning, Seg, Spinner } from '../components/ui';

export function StorePage() {
  const { catalog } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<'fresh' | 'prewarmed'>('fresh');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!catalog) return <div className="page"><Spinner label="Loading products…" /></div>;
  const fresh = catalog.products.filter((p) => p.category === 'fresh' || p.category === 'server');
  const server = fresh.filter((p) => p.category === 'server');
  const mailbox = fresh.filter((p) => p.category === 'fresh');
  const prewarmed = catalog.products.filter((p) => p.category === 'prewarmed');

  const start = async (journey: 'fresh' | 'prewarmed', productCode?: string) => {
    setBusy(productCode ?? journey); setErr(null);
    try {
      const r = await api<{ order: Order }>('/orders', { body: { journey, productCode } });
      nav(journey === 'fresh' ? `/store/order/${r.order.id}` : `/store/prewarmed/${r.order.id}`);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  };

  return (
    <div className="page">
      <div className="stack" style={{ gap: 24 }}>
        <div className="hero">
          <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 8, maxWidth: 640 }}>
              <span className="badge accent">Sending infrastructure</span>
              <h1>Buy domains, mailboxes and SMTP servers in minutes</h1>
              <p className="muted">Pick a provider, choose how many inboxes you need, and we register the domains, set up DNS and create every mailbox for you.</p>
            </div>
            <Seg value={tab} onChange={setTab} options={[{ value: 'fresh', label: 'Fresh setup' }, { value: 'prewarmed', label: 'Pre-warmed' }]} />
          </div>
        </div>

        {err && <Banner tone="err">{err}</Banner>}

        {tab === 'fresh' ? (
          <>
            {server.map((p) => (
              <FeaturedServer key={p.code} p={p} busy={busy === p.code} onStart={() => start('fresh', p.code)} />
            ))}
            <div className="spread"><h2>Mailboxes on new domains</h2><span className="muted small">Save {catalog.pricing.annualDiscountPct}% with annual billing</span></div>
            <div className="grid grid-4">
              {mailbox.map((p) => <ProductCard key={p.code} p={p} busy={busy === p.code} onStart={() => start('fresh', p.code)} />)}
            </div>
            <PrimaryDomainWarning />
            <p className="small muted">New .com domains are {money(catalog.pricing.domainPriceCents)} per year. Every domain you can select has just been checked live and is available.</p>
          </>
        ) : (
          <div className="grid grid-2">
            <div className="card card-pad stack">
              <div className="row"><div className="icon-dot">🔥</div><h2>Pre-warmed mailboxes</h2></div>
              <p className="muted">Inboxes on domains that already have a sending history. Skip the warm-up wait and launch your campaigns on day one.</p>
              <ul className="features">
                <li>Domains and inboxes already warmed for weeks</li>
                <li>Realistic sender identities included</li>
                <li>Google Workspace and Microsoft 365</li>
                <li>Monthly or annual billing</li>
              </ul>
              <div className="grid grid-2">
                {prewarmed.map((p) => (
                  <div key={p.code} className="kpi">
                    <div className="row"><PlatformMark platform={p.platform} size={30} /><span className="strong small">{p.name.replace('Pre-warmed ', '')}</span></div>
                    <div className="small muted" style={{ marginTop: 6 }}>from <b className="price" style={{ fontSize: 18 }}>{money(Math.min(...(p.priceTiers ?? []).map((t) => t.monthly_price_cents)))}</b> / mailbox / month</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary btn-lg" disabled={!!busy || prewarmed.length === 0} onClick={() => start('prewarmed')}>{busy === 'prewarmed' ? 'Opening…' : 'Browse pre-warmed domains →'}</button>
            </div>
            <div className="card card-pad stack">
              <h3>Fresh or pre-warmed?</h3>
              <p className="small muted"><b>Fresh</b> mailboxes are brand new. They cost less and you control every name and domain, but they need a few weeks of gradual warm-up before full volume.</p>
              <p className="small muted"><b>Pre-warmed</b> mailboxes already have a sending reputation. They cost more but you can send right away, which suits urgent launches.</p>
              <PrimaryDomainWarning />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function priceLine(p: Product) {
  const unit = p.unit === 'mailbox' ? 'mailbox' : p.unit === 'tenant' ? 'tenant' : 'server';
  return <><span className="price">{money(p.monthlyPriceCents)}</span> <small className="muted">/ {unit} / month</small></>;
}

function ProductCard({ p, busy, onStart }: { p: Product; busy: boolean; onStart: () => void }) {
  return (
    <div className="product-card">
      {p.badge && <span className="badge corner">{p.badge}</span>}
      <div className="row"><PlatformMark platform={p.platform} /><div><h3>{p.name}</h3><p className="small muted">{p.tagline}</p></div></div>
      <div>{priceLine(p)}</div>
      {p.unit === 'tenant' && <p className="small muted">Up to {p.mailboxesPerUnit} mailboxes per tenant</p>}
      <ul className="features">{p.features.slice(0, 4).map((f) => <li key={f}>{f}</li>)}</ul>
      <div style={{ flex: 1 }} />
      <button className="btn btn-primary btn-block" disabled={busy} onClick={onStart}>{busy ? 'Opening…' : 'Get started'}</button>
    </div>
  );
}

function FeaturedServer({ p, busy, onStart }: { p: Product; busy: boolean; onStart: () => void }) {
  return (
    <div className="product-card featured" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 24 }}>
      {p.badge && <span className="badge corner">{p.badge}</span>}
      <div className="stack" style={{ flex: '1 1 380px', gap: 10 }}>
        <div className="row"><PlatformMark platform={p.platform} /><div><h2>{p.name}</h2><p className="small muted">{p.tagline}</p></div></div>
        <p className="muted small">{p.description}</p>
        <ul className="features" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '6px 18px' }}>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>
      <div className="stack" style={{ flex: '0 1 240px', gap: 10 }}>
        <div>{priceLine(p)}</div>
        <p className="small muted">Compare with shared SMTP mailboxes, which are billed per inbox.</p>
        <button className="btn btn-primary btn-lg" disabled={busy} onClick={onStart}>{busy ? 'Opening…' : 'Buy raw SMTP server'}</button>
      </div>
    </div>
  );
}
