import { useMemo, useState } from 'react';
import { Modal, Seg } from './ui';

/**
 * Mailbox quantity calculator. Estimates only, using common B2B cold-email
 * assumptions that are shown to the customer.
 */
export const CALC = {
  sendDaysPerWeek: 5,
  emailsPerMailboxPerDay: 25,
  replyRate: 0.035,
  interestedShare: 0.5,
  meetingsPerInterested: 1 / 3,
  rotationBuffer: 1.25,
  emailsPerLead: 4,
};

export function mailboxesForWeeklyEmails(weekly: number) {
  const daily = weekly / CALC.sendDaysPerWeek;
  return Math.max(1, Math.ceil((daily / CALC.emailsPerMailboxPerDay) * CALC.rotationBuffer));
}

export function goalPlan(meetingsPerWeek: number) {
  const interested = Math.ceil(meetingsPerWeek / CALC.meetingsPerInterested);
  const replies = interested / CALC.interestedShare;
  const weeklyEmails = Math.ceil(replies / CALC.replyRate);
  const leads = Math.ceil(weeklyEmails / CALC.emailsPerLead);
  return { interested, weeklyEmails, dailyEmails: Math.ceil(weeklyEmails / CALC.sendDaysPerWeek), leads, mailboxes: mailboxesForWeeklyEmails(weeklyEmails) };
}

export function Calculator({ onUse, onClose }: { onUse: (n: number) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'goal' | 'volume'>('goal');
  const [meetings, setMeetings] = useState(10);
  const [weekly, setWeekly] = useState(3000);
  const goal = useMemo(() => goalPlan(Math.max(1, meetings)), [meetings]);
  const volMailboxes = mailboxesForWeeklyEmails(Math.max(1, weekly));
  const suggested = mode === 'goal' ? goal.mailboxes : volMailboxes;

  return (
    <Modal title="Mailbox calculator" subtitle="Get a suggested mailbox count in seconds" onClose={onClose}>
      <div className="stack" style={{ gap: 20 }}>
        <Seg value={mode} onChange={setMode} options={[{ value: 'goal', label: '🎯 By meetings goal' }, { value: 'volume', label: '📈 By sending volume' }]} />
        {mode === 'goal' ? (
          <div className="stack">
            <h3>How many meetings do you want per week?</h3>
            <div className="tiles">
              {[5, 10, 25, 50].map((n) => (
                <button key={n} type="button" className={`tile ${meetings === n ? 'selected' : ''}`} onClick={() => setMeetings(n)}><span className="radio" /><div className="big">{n}</div><div className="small muted">meetings</div></button>
              ))}
              <div className={`tile ${![5, 10, 25, 50].includes(meetings) ? 'selected' : ''}`}><div className="small muted">Custom</div><input aria-label="Custom meetings" className="input" type="number" min={1} max={1000} value={meetings} onChange={(e) => setMeetings(Number(e.target.value) || 1)} /></div>
            </div>
          </div>
        ) : (
          <div className="stack">
            <h3>How many emails do you plan to send per week?</h3>
            <div className="tiles">
              {[1000, 3000, 5000, 10000].map((n) => (
                <button key={n} type="button" className={`tile ${weekly === n ? 'selected' : ''}`} onClick={() => setWeekly(n)}><span className="radio" /><div className="big">{n / 1000}K</div><div className="small muted">emails</div></button>
              ))}
              <div className={`tile ${![1000, 3000, 5000, 10000].includes(weekly) ? 'selected' : ''}`}><div className="small muted">Custom</div><input aria-label="Custom weekly emails" className="input" type="number" min={50} max={1000000} value={weekly} onChange={(e) => setWeekly(Number(e.target.value) || 50)} /></div>
            </div>
          </div>
        )}

        <div className="card" style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-100)' }}>
          <div className="card-pad grid grid-4" style={{ textAlign: 'center' }}>
            <div><div className="price" style={{ color: 'var(--brand-600)' }}>{suggested}</div><div className="small muted">mailboxes</div></div>
            <div><div className="price">{(mode === 'goal' ? goal.weeklyEmails : weekly).toLocaleString()}</div><div className="small muted">emails / week</div></div>
            <div><div className="price">{Math.ceil((mode === 'goal' ? goal.weeklyEmails : weekly) / CALC.sendDaysPerWeek).toLocaleString()}</div><div className="small muted">emails / day</div></div>
            <div><div className="price">{CALC.emailsPerMailboxPerDay}</div><div className="small muted">per mailbox / day</div></div>
          </div>
        </div>

        <div className="stack small" style={{ gap: 6 }}>
          <b>How we got there</b>
          {mode === 'goal' ? (
            <>
              <span>✓ About {goal.interested} interested replies a week (1 in 3 becomes a meeting)</span>
              <span>✓ About {goal.weeklyEmails.toLocaleString()} emails a week ({CALC.replyRate * 100}% reply rate, half of replies are interested)</span>
              <span>✓ About {goal.leads.toLocaleString()} new leads a week (each gets a {CALC.emailsPerLead}-email sequence)</span>
            </>
          ) : (
            <span>✓ {weekly.toLocaleString()} emails over {CALC.sendDaysPerWeek} sending days at {CALC.emailsPerMailboxPerDay} emails per mailbox per day</span>
          )}
          <span>✓ Includes a 25% buffer so you can rotate and rest mailboxes</span>
        </div>
        <p className="banner info small">These are estimates based on typical B2B cold outreach. Your results depend on targeting, list quality and messaging.</p>
        <div className="wizard-nav">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onUse(suggested)}>Use {suggested} mailboxes →</button>
        </div>
      </div>
    </Modal>
  );
}
