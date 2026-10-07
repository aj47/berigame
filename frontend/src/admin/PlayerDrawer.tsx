import React, { useEffect, useState } from 'react';
import type { PlayerDetail } from './types';
import { adminFetch } from './api';
import { BarChart } from './charts';
import { ago, dateTime, dayLabel, duration, num } from './format';
import { Kind } from './tabs';

const COUNTERS = ['harvests', 'gathered', 'crafts', 'trades', 'deposits', 'chats', 'kills', 'deaths'] as const;

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="adm-facts">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
}

function Slots({ slots }: { slots: { itemId: string; quantity: number }[] }) {
  if (!slots.length) return <div className="adm-muted">Empty.</div>;
  return <div className="adm-slots">{slots.map((s, i) => <span key={`${s.itemId}-${i}`}>{s.itemId.replace(/_/g, ' ')} <b>×{s.quantity}</b></span>)}</div>;
}

export function PlayerDrawer({ id, token, onClose }: { id: string; token: string; onClose: () => void }) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setDetail(null); setError('');
    adminFetch<PlayerDetail>('/api/admin/player', token, { identity: id })
      .then((d) => { if (live) setDetail(d); }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [id, token]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const g = detail?.game;
  const activity = g ? [...g.activity].reverse() : [];
  const actionTotals = new Map<string, number>();
  for (const day of g?.activity ?? []) for (const [k, v] of Object.entries(day.actions)) actionTotals.set(k, (actionTotals.get(k) ?? 0) + v);

  return <div className="adm-drawer-backdrop" onClick={onClose}>
    <aside className="adm-drawer" role="dialog" aria-modal="true" aria-label="Player details" onClick={(e) => e.stopPropagation()}>
      <header>
        <div>
          <h2>{g?.name ?? 'Loading…'} {g?.grant && <Kind agent={g.grant.agent} />}</h2>
          <code className="adm-muted adm-small">{id}</code>
        </div>
        <button className="adm-ghost" onClick={onClose} aria-label="Close">✕</button>
      </header>
      {error && <div className="adm-error" role="alert">{error}</div>}
      {g && <div className="adm-drawer-body">
        <section>
          <Facts rows={[
            ['Status', g.online ? <span className="adm-online">online ({g.connections} tab{g.connections === 1 ? '' : 's'})</span> : `offline, last seen ${ago(g.lastSeen)}`],
            ['Where', `${g.region} · ${g.x},${g.z}`],
            ['Health', g.dead ? 'down' : `${g.hp}/${g.maxHp}${g.weapon ? ` · wielding ${g.weapon}` : ''}`],
            ['Joined', g.stats ? `${dateTime(g.stats.firstJoin)} (${ago(g.stats.firstJoin)})` : '—'],
            ['Sessions', g.stats ? `${g.stats.sessions} · ${duration(g.stats.playSeconds)} played` : '—'],
            ['Funnel step', g.stats?.lastStep ?? '—'],
            ['Deaths', g.stats?.deaths ?? 0],
            ['Energy', g.energy ? `${g.energy.band} · ${num(g.energy.points)}/${num(g.energy.max)}` : 'never gathered'],
            ['Permit', g.grant ? `${g.grant.agent ? 'agent' : 'browser'} · combat ${g.grant.combat ? 'on' : 'off'} · chat ${g.grant.chat ? 'on' : 'off'} · expires ${ago(g.grant.expiresAt).replace(' ago', '')}` : 'none'],
            ['Account', detail.gateway.account ? `${detail.gateway.account.logins.join(', ') || 'linked'} · seen ${ago(detail.gateway.account.seenAt)}` : 'anonymous'],
          ]} />
        </section>
        {g.stats && <section><h3>Milestones</h3>
          <Facts rows={Object.entries(g.stats.milestones).map(([k, v]) => [k, v ? dateTime(v) : '—'])} />
        </section>}
        <section><h3>Daily activity</h3>
          {activity.length ? <>
            <BarChart height={130} data={activity.map((d) => ({ label: dayLabel(d.day), values: [Math.round(d.playSeconds / 60)] }))} series={[{ name: 'Minutes online', color: 'var(--series-1)' }]} />
            <div className="adm-scroll"><table className="adm-table">
              <thead><tr><th>Day</th><th>Online</th>{COUNTERS.map((c) => <th key={c}>{c}</th>)}<th>Region actions</th></tr></thead>
              <tbody>{g.activity.map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{duration(d.playSeconds)}</td>{COUNTERS.map((c) => <td key={c}>{d[c] || ''}</td>)}
                <td className="adm-small">{Object.entries(d.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}</td></tr>)}</tbody>
            </table></div>
          </> : <div className="adm-muted">No daily activity recorded yet.</div>}
        </section>
        <section><h3>Progress</h3>
          <Facts rows={[
            ['Grove skills', g.skills ? `foraging ${num(g.skills.foraging)} · beachcombing ${num(g.skills.beachcombing)} · crafting ${num(g.skills.crafting)}` : '—'],
            ['Region XP', g.profile ? Object.entries(g.profile.xp).map(([k, v]) => `${k} ${num(v)}`).join(' · ') : '—'],
            ['Quests', g.profile?.quests.length ? g.profile.quests.join(', ') : 'none'],
            ['Discoveries', g.profile?.discoveries.length ? g.profile.discoveries.join(', ') : 'none'],
            ['Companion', g.profile?.companion || 'none'],
            ['Lifetime actions', actionTotals.size ? [...actionTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') : '—'],
          ]} />
        </section>
        <section><h3>Bag · value {num(g.bagValue)}</h3><Slots slots={g.bag} /></section>
        {g.containers.map((c) => <section key={c.id}><h3>{c.id.startsWith('vault-') ? 'Vault' : c.id} · value {num(c.value)}</h3><Slots slots={c.slots} /></section>)}
        {g.claims.length > 0 && <section><h3>Land claims</h3>
          <Facts rows={g.claims.map((c) => [c.id, `tier ${c.tier} · ${c.status} · paid until ${dateTime(c.paidUntil)}`])} />
        </section>}
        <section><h3>Coins · {num(g.profile?.coins ?? 0)}</h3>
          {g.ledger.length ? <div className="adm-scroll"><table className="adm-table">
            <thead><tr><th>When</th><th>Amount</th><th>Reason</th></tr></thead>
            <tbody>{g.ledger.map((l) => <tr key={l.id}><td>{dateTime(l.at)}</td><td className={l.amount < 0 ? 'adm-neg' : 'adm-pos'}>{l.amount > 0 ? '+' : ''}{num(l.amount)}</td><td>{l.reason}</td></tr>)}</tbody>
          </table></div> : <div className="adm-muted">No coin movements.</div>}
        </section>
        {g.chat.length > 0 && <section><h3>Recent chat</h3>
          <ul className="adm-chat">{g.chat.map((m, i) => <li key={i}><span className="adm-muted">{ago(m.at)}</span> {m.text}</li>)}</ul>
        </section>}
        {g.profile?.notes.length ? <section><h3>Recent notices</h3><ul className="adm-chat">{g.profile.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></section> : null}
      </div>}
    </aside>
  </div>;
}
