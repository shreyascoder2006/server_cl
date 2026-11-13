import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, newKey, type Issue, type Order, type Quote } from '../lib/api';
import { cadenceLabel, money } from '../lib/format';
import { Banner, Spinner } from './ui';

export function SummaryCard({ title, rows, quote, loading }: { title: string; rows: [string, string][]; quote: Quote | null; loading?: boolean }) {
  return (
    <div className="card summary">
      <div className="card-head"><h3>Order summary</h3>{loading && <span className="spinner" aria-label="Updating" />}</div>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <div className="strong">{title}</div>
        <div>{rows.map(([k, v]) => <div key={k} className="summary-line"><span className="muted">{k}</span><span>{v}</span></div>)}</div>
        {quote ? (
          <>
            <div className="hr" />
            {quote.lines.map((l) => (
              <div key={l.key} className="summary-line"><span><span>{l.label}</span><br /><span className="tiny muted">{l.detail}</span></span><span className="strong">{money(l.amountCents)}</span></div>
            ))}
            {quote.taxCents > 0 && <div className="summary-line"><span className="muted">Tax ({quote.taxPct}%)</span><span>{money(quote.taxCents)}</span></div>}
            <div className="summary-total"><span className="strong">Due today</span><span className="amt">{money(quote.dueTodayCents)}</span></div>
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              <span className="tiny muted strong" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>Then</span>
              {quote.recurring.map((r) => <div key={r.label} className="summary-line small"><span>{r.label}</span><span className="strong">{money(r.amountCents)} <span className="muted">{cadenceLabel[r.cadence]}</span></span></div>)}
            </div>
          </>
        ) : <p className="small muted">Prices appear once your setup is complete.</p>}
      </div>
    </div>
  );
}

export function CostBreakdown({ quote }: { quote: Quote }) {
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Item</th><th>Details</th><th>Billing</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.key}><td className="strong">{l.label}</td><td className="muted small">{l.detail}</td><td><span className="badge grey">{l.cadence === 'monthly' ? 'Monthly' : l.cadence === 'one_time' ? 'One-time' : 'Yearly'}</span></td><td className="right strong">{money(l.amountCents)}</td></tr>
            ))}
            {quote.taxCents > 0 && <tr><td>Tax</td><td className="muted small">{quote.taxPct}%</td><td /><td className="right">{money(quote.taxCents)}</td></tr>}
            <tr><td colSpan={3} className="strong">Total due today</td><td className="right"><span className="price" style={{ fontSize: 22, color: 'var(--brand-600)' }}>{money(quote.dueTodayCents)}</span></td></tr>
          </tbody>
        </table>
      </div>
      <Banner tone="info">
        <div className="stack" style={{ gap: 4 }}>
          <b>What you pay after today</b>
          {quote.recurring.map((r) => <span key={r.label}>{r.label}: <b>{money(r.amountCents)}</b> {cadenceLabel[r.cadence]}</span>)}
          {quote.notes.map((n) => <span key={n} className="small">{n}</span>)}
        </div>
      </Banner>
    </div>
  );
}

export const PURCHASE_TERMS = [
  'Subscriptions renew automatically at the end of each billing period until cancelled.',
  'Cancelling mid-period stops the next renewal; the current period is not refunded.',
  'More mailboxes cannot be added to a domain after purchase; buy a new domain instead.',
  'Mailbox names cannot be changed after they are created.',
  'Setup usually completes within 24 to 48 hours after payment.',
  'Domains are registered in your name and renew yearly.',
];

/** Starts checkout (server re-validates and re-prices), then shows the payment step. */
export function CheckoutPanel({ order, onIssues, onPaid }: { order: Order; onIssues: (i: Issue[]) => void; onPaid: (o: Order) => void }) {
  const { catalog } = useApp();
  const nav = useNavigate();
  const [state, setState] = useState<'idle' | 'starting' | 'awaiting' | 'paying'>(order.status === 'awaiting_payment' ? 'awaiting' : 'idle');
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(order.totalDueCents);
  const [key] = useState(() => `co_${newKey()}`);

  const start = async () => {
    setState('starting'); setErr(null);
    try {
      const r = await api<{ order: Order; payment: { amountCents: number; redirectUrl?: string } }>(`/orders/${order.id}/checkout`, { method: 'POST', headers: { 'Idempotency-Key': key } });
      setAmount(r.payment.amountCents);
      if (r.payment.redirectUrl) { window.location.href = r.payment.redirectUrl; return; }
      setState('awaiting');
    } catch (e: any) {
      setState('idle');
      setErr(e.message);
      if (Array.isArray(e.details)) onIssues(e.details);
    }
  };

  const simulate = async (outcome: 'success' | 'fail') => {
    setState('paying'); setErr(null);
    try {
      const r = await api<{ order: Order }>(`/dev/simulate-payment/${order.id}`, { body: { outcome } });
      if (r.order.status === 'awaiting_payment') { setErr('The (simulated) payment was declined. No charge was made. You can try again.'); setState('awaiting'); return; }
      onPaid(r.order);
      nav(`/orders/${order.id}?new=1`);
    } catch (e: any) { setErr(e.message); setState('awaiting'); }
  };

  return (
    <div className="stack">
      {err && <Banner tone="err">{err}</Banner>}
      {state === 'idle' || state === 'starting' ? (
        <button className="btn btn-primary btn-lg btn-block" onClick={start} disabled={state === 'starting'}>
          {state === 'starting' ? <Spinner label="Re-checking availability and prices…" /> : '🔒 Continue to secure payment'}
        </button>
      ) : (
        <div className="card card-pad stack" style={{ borderColor: 'var(--brand-100)' }}>
          <div className="spread"><h3>Payment</h3><span className="price" style={{ fontSize: 22 }}>{money(amount)}</span></div>
          {catalog?.environment.paymentGateway === 'mock' ? (
            <>
              <Banner tone="warn">This is the <b>simulated checkout</b> used for local testing. In production the secure payment page opens here, and nothing is ordered from providers until payment is confirmed.</Banner>
              <div className="grid grid-2">
                <button className="btn btn-success btn-lg" disabled={state === 'paying'} onClick={() => simulate('success')}>{state === 'paying' ? 'Processing…' : 'Simulate successful payment'}</button>
                <button className="btn btn-danger btn-lg" disabled={state === 'paying'} onClick={() => simulate('fail')}>Simulate declined payment</button>
              </div>
            </>
          ) : <Spinner label="Waiting for payment confirmation…" />}
        </div>
      )}
    </div>
  );
}
