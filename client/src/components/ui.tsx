import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { PLATFORM_ICON } from '../lib/format';

export function Banner({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'ok' | 'err' | 'danger-strong'; icon?: ReactNode; children: ReactNode }) {
  const def = { info: 'ℹ', warn: '⚠', ok: '✓', err: '✕', 'danger-strong': '⛔' }[tone];
  return <div className={`banner ${tone}`} role={tone === 'err' ? 'alert' : undefined}><span className="b-icon" aria-hidden>{icon ?? def}</span><div>{children}</div></div>;
}

export function PrimaryDomainWarning() {
  return (
    <Banner tone="danger-strong" icon="⛔">
      <strong>Never send cold emails via your primary domain.</strong> Use dedicated secondary domains for outreach, so your main
      domain’s reputation and your team’s everyday email stay safe.
    </Banner>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="row" style={{ gap: 8 }}><span className="spinner" aria-hidden />{label && <span className="muted small">{label}</span>}</span>;
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  const auto = useId();
  const el = isValidElement(children) ? (children as ReactElement<any>) : null;
  const isControl = !!el && typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type);
  const id = htmlFor ?? (isControl ? el!.props.id ?? auto : undefined);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isControl && !el!.props.id ? cloneElement(el!, { id, 'aria-invalid': error ? true : undefined }) : children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div><h2 style={{ color: '#fff' }}>{title}</h2>{subtitle && <p className="small" style={{ opacity: .85 }}>{subtitle}</p>}</div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function PlatformMark({ platform, size = 44 }: { platform: string; size?: number }) {
  const colors: Record<string, [string, string]> = {
    google: ['#fef3f2', '#dc2626'], microsoft: ['#eff6ff', '#2563eb'], azure: ['#ecfeff', '#0891b2'], smtp: ['#f5f3ff', '#7c3aed'], smtp_server: ['#ecfdf5', '#059669'],
  };
  const [bg, fg] = colors[platform] ?? ['#f1f5f9', '#334155'];
  return <div className="product-logo" style={{ background: bg, color: fg, width: size, height: size, fontWeight: 800 }} aria-hidden>{PLATFORM_ICON[platform] ?? '•'}</div>;
}

export function MultiSelect({ options, value, onChange, allLabel = 'All domains' }: { options: string[]; value: 'all' | string[]; onChange: (v: 'all' | string[]) => void; allLabel?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const selected = value === 'all' ? options : value;
  const label = value === 'all' ? allLabel : value.length === 0 ? 'Choose domains…' : value.length === 1 ? value[0] : `${value.length} domains`;
  const toggle = (d: string) => {
    const next = selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d];
    onChange(next.length === options.length ? 'all' : next);
  };
  return (
    <div className="ms" ref={ref}>
      <button type="button" className="ms-btn" onClick={() => setOpen(!open)} aria-expanded={open}><span>{label}</span><span aria-hidden>▾</span></button>
      {open && (
        <div className="ms-menu">
          <label><input type="checkbox" checked={value === 'all'} onChange={() => onChange(value === 'all' ? [] : 'all')} /> {allLabel}</label>
          <div className="hr" />
          {options.map((d) => <label key={d}><input type="checkbox" checked={selected.includes(d)} onChange={() => toggle(d)} /> {d}</label>)}
        </div>
      )}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t); }, [msg]);
  return { toast: setMsg, node: msg ? <div className="toast" role="status">{msg}</div> : null };
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    draft: ['Draft', 'grey'], awaiting_payment: ['Awaiting payment', 'warn'], payment_authorized: ['Paid', 'ok'], submitting: ['Setting up', ''],
    provider_pending: ['Provisioning', ''], submitted: ['Submitted', 'ok'], needs_review: ['Under review', 'warn'], failed: ['Needs attention', 'err'], cancelled: ['Cancelled', 'grey'],
    succeeded: ['Done', 'ok'], pending: ['In progress', 'warn'], unknown: ['Unclear, checking', 'err'],
  };
  const [label, tone] = map[status] ?? [status, 'grey'];
  return <span className={`badge ${tone}`}>{label}</span>;
}
