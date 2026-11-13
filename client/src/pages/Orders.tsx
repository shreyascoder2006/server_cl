import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Order } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { Banner, Spinner, StatusBadge } from '../components/ui';
import { CostBreakdown } from '../components/Checkout';

interface Row { id: string; journey: string; status: string; productName: string; quantity: number; totalDueCents: number | null; createdAt: string }

export function OrdersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const nav = useNavigate();
  useEffect(() => { api<{ orders: Row[] }>('/orders').then((r) => setRows(r.orders)); }, []);
  const open = (r: Row) => nav(['draft', 'awaiting_payment'].includes(r.status) ? (r.journey === 'fresh' ? `/store/order/${r.id}` : `/store/prewarmed/${r.id}`) : `/orders/${r.id}`);
  return (
    <div className="page page-narrow">
      <div className="spread" style={{ marginBottom: 20 }}><h1>My orders</h1><Link className="btn btn-primary" to="/store">+ New order</Link></div>
      {!rows ? <Spinner label="Loading…" /> : rows.length === 0 ? (
        <div className="card empty"><h3>No orders yet</h3><p>Your infrastructure purchases will show up here.</p><p style={{ marginTop: 12 }}><Link className="btn btn-primary" to="/store">Browse infrastructure</Link></p></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Order</th><th>Product</th><th>Qty</th><th>Status</th><th className="right">Total</th><th>Created</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => open(r)}>
                <td className="mono">{r.id.slice(0, 12)}</td><td className="strong">{r.productName}</td><td>{r.quantity || '—'}</td>
                <td><StatusBadge status={r.status} /></td><td className="right">{money(r.totalDueCents)}</td><td className="small muted">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => api<{ order: Order }>(`/orders/${id}`).then((r) => { if (!stop) setOrder(r.order); }).catch((e) => setErr(e.message));
    load();
    const t = setInterval(() => { if (order && ['submitted', 'cancelled', 'failed'].includes(order.status)) return; load(); }, 4000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (err) return <div className="page"><Banner tone="err">{err}</Banner></div>;
  if (!order) return <div className="page"><Spinner label="Loading order…" /></div>;
  const cfg = order.config;
  const head: Record<string, [string, 'ok' | 'info' | 'warn' | 'err']> = {
    payment_authorized: ['Payment received. Setup is starting.', 'ok'],
    submitting: ['Payment received. We are setting everything up.', 'info'],
    provider_pending: ['Payment received. Your infrastructure is being provisioned; this usually takes 24 to 48 hours.', 'info'],
    submitted: ['All set up requests have been completed.', 'ok'],
    needs_review: ['Payment received. Part of your setup needs a manual check by our team; we will follow up shortly.', 'warn'],
    failed: ['Payment received, but part of the setup could not be completed. Our team has been notified and will fix it.', 'err'],
    cancelled: ['This order was cancelled.', 'warn'],
  };
  const h = head[order.status];

  return (
    <div className="page page-narrow stack" style={{ gap: 20 }}>
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div><Link to="/orders" className="small">← My orders</Link><h1 style={{ marginTop: 6 }}>{order.productName}</h1><p className="small muted mono">{order.id}</p></div>
        <StatusBadge status={order.status} />
      </div>
      {sp.get('new') && <Banner tone="ok"><b>Thank you!</b> Your order is confirmed.</Banner>}
      {h && <Banner tone={h[1]}>{h[0]}</Banner>}

      <div className="card">
        <div className="card-head"><h3>Setup progress</h3>{['submitting', 'provider_pending'].includes(order.status) && <span className="spinner" />}</div>
        <div className="card-pad">
          {order.progress.length === 0 ? <p className="small muted">Setup starts once payment is confirmed.</p> : (
            <ul className="timeline">{order.progress.map((p) => (
              <li key={p.key}><span className={`status-dot ${p.status}`} /><span style={{ flex: 1 }}>{p.label}{p.error && <div className="tiny muted">{p.error}</div>}</span><StatusBadge status={p.status} /></li>
            ))}</ul>
          )}
        </div>
      </div>

      {order.mailboxes.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Mailboxes</h3><span className="small muted">{order.mailboxes.length}</span></div>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 320 }}>
            <table className="table"><thead><tr><th>Name</th><th>Email</th></tr></thead><tbody>{order.mailboxes.map((m) => <tr key={m.address}><td>{m.firstName} {m.lastName}</td><td className="mono">{m.address}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}
      {(cfg.domains?.length || cfg.picks?.length) ? (
        <div className="card card-pad stack"><h3>Domains</h3><div className="row wrap">{(cfg.domains ?? cfg.picks.map((p: any) => p.domain)).map((d: string) => <span key={d} className="chip">{d}</span>)}</div></div>
      ) : null}
      {order.quote && <div className="card card-pad stack"><h3>Billing</h3><CostBreakdown quote={order.quote} /></div>}
      <div className="card card-pad stack">
        <h3>History</h3>
        <ul className="timeline">{order.events.map((e, i) => <li key={i}><span className="small muted" style={{ width: 160 }}>{fmtDate(e.created_at)}</span><span className="small">{e.note ?? e.to_status}</span></li>)}</ul>
      </div>
    </div>
  );
}
