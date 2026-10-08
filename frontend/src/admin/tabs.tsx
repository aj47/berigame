import React, { useMemo, useState } from 'react';
import type { PlayerRow, Snapshot } from './types';
import { BarChart, HBars, LineChart, compact } from './charts';
import { ago, dayLabel, duration, num, pct } from './format';

const C = {
  human: 'var(--series-1)', agent: 'var(--series-2)', one: 'var(--series-1)', two: 'var(--series-3)',
  minted: 'var(--div-pos)', burned: 'var(--div-neg)',
};

type WithPlayer = { data: Snapshot; onPlayer: (id: string) => void };

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="adm-tile"><span className="adm-tile-label">{label}</span><span className="adm-tile-value">{value}</span>{sub && <span className="adm-tile-sub">{sub}</span>}</div>;
}

function Card({ title, children, wide, note }: { title: string; children: React.ReactNode; wide?: boolean; note?: React.ReactNode }) {
  return <section className={`adm-card${wide ? ' wide' : ''}`}><h2>{title}</h2>{note && <p className="adm-card-note">{note}</p>}{children}</section>;
}

export function Kind({ agent }: { agent: boolean }) {
  return <span className={`adm-kind ${agent ? 'agent' : 'human'}`}>{agent ? 'Agent' : 'Human'}</span>;
}

function Name({ id, name, agent, onPlayer }: { id: string; name: string; agent?: boolean; onPlayer: (id: string) => void }) {
  return <button className="adm-link" onClick={() => onPlayer(id)}>{name}{agent !== undefined && <> <Kind agent={agent} /></>}</button>;
}

// ---------------------------------------------------------------------------- Overview

export function OverviewTab({ data, onPlayer }: WithPlayer) {
  const g = data.game;
  const today = g.series[g.series.length - 1];
  const yesterday = g.series[g.series.length - 2];
  const newPlayers = g.series.reduce((s, p) => s + p.newPlayers, 0);
  const recent = g.players.filter((p) => p.online).slice(0, 12);
  return <>
    <div className="adm-tiles">
      <Tile label="Online now" value={g.world.online} sub={`${g.world.onlineAgents} agents · ${g.world.online - g.world.onlineAgents} humans`} />
      <Tile label="DAU" value={g.active.dau} sub={yesterday ? `${yesterday.dau} yesterday` : undefined} />
      <Tile label="WAU" value={g.active.wau} sub={`DAU/WAU ${pct(g.active.dau, g.active.wau)}`} />
      <Tile label="MAU" value={g.active.mau} sub={`DAU/MAU ${pct(g.active.dau, g.active.mau)}`} />
      <Tile label="New today" value={today?.newPlayers ?? 0} sub={`${newPlayers} in ${g.days} days`} />
      <Tile label="Characters" value={num(g.world.characters)} />
      <Tile label="Play time today" value={`${today?.playHours ?? 0} h`} sub={today?.dau ? `${duration(Math.round((today.totals.playSeconds) / today.dau))} per player` : undefined} />
      <Tile label="Coin supply" value={compact(g.economy.coins.total)} sub={`${g.economy.coins.holders} holders`} />
    </div>
    <div className="adm-grid">
      <Card title="Daily active players" note="Distinct characters online or acting each UTC day.">
        <BarChart data={g.series.map((p) => ({ label: dayLabel(p.day), values: [p.humans, p.agents] }))} series={[{ name: 'Humans', color: C.human }, { name: 'Agents', color: C.agent }]} />
      </Card>
      <Card title="New players" note="First connection of a character (from the funnel table, so older days are complete).">
        <BarChart data={g.series.map((p) => ({ label: dayLabel(p.day), values: [p.newPlayers] }))} series={[{ name: 'New players', color: C.one }]} />
      </Card>
      <Card title="Hours played" note="Online time, sampled once a minute.">
        <LineChart data={g.series.map((p) => ({ label: dayLabel(p.day), value: p.playHours }))} color={C.one} name="Hours played" />
      </Card>
      <Card title="Where players are now">
        <HBars rows={Object.entries(g.world.onlineByRegion).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} color={C.one} />
        <p className="adm-muted adm-small">{g.world.deadNow} respawning · {g.world.glowing} carrying a glowing load · admission {g.world.requireAdmission ? 'on' : 'off'}</p>
      </Card>
      <Card title="Online right now" wide>
        {recent.length ? <table className="adm-table"><thead><tr><th>Player</th><th>Region</th><th>Tile</th><th>HP</th><th>Today</th><th>Coins</th><th>Session</th></tr></thead>
          <tbody>{recent.map((p) => <tr key={p.id}>
            <td><Name id={p.id} name={p.name} agent={p.agent} onPlayer={onPlayer} /></td><td>{p.region}</td><td>{p.x},{p.z}</td>
            <td>{p.dead ? 'down' : `${p.hp}/${p.maxHp}`}</td>
            <td>{p.today ? `${p.today.harvests} harvests · ${p.today.crafts} crafts · ${p.today.kills} kills` : '—'}</td>
            <td>{num(p.coins)}</td><td>{duration(p.today?.playSeconds ?? 0)}</td>
          </tr>)}</tbody></table> : <div className="adm-muted">Nobody is online.</div>}
      </Card>
    </div>
  </>;
}

// ---------------------------------------------------------------------------- Players

type SortKey = 'name' | 'lastSeen' | 'firstJoin' | 'playSeconds' | 'sessions' | 'coins' | 'vaultValue' | 'carried' | 'kills' | 'deaths' | 'activeDays' | 'regionXp' | 'groveXp';
const COLUMNS: { key: SortKey; label: string; render: (p: PlayerRow) => React.ReactNode }[] = [
  { key: 'lastSeen', label: 'Last seen', render: (p) => (p.online ? <span className="adm-online">online</span> : ago(p.lastSeen)) },
  { key: 'firstJoin', label: 'Joined', render: (p) => ago(p.firstJoin) },
  { key: 'sessions', label: 'Sessions', render: (p) => p.sessions },
  { key: 'playSeconds', label: 'Played', render: (p) => duration(p.playSeconds) },
  { key: 'activeDays', label: 'Active days', render: (p) => p.activeDays },
  { key: 'coins', label: 'Coins', render: (p) => num(p.coins) },
  { key: 'vaultValue', label: 'Vault', render: (p) => num(p.vaultValue) },
  { key: 'carried', label: 'Carried', render: (p) => num(p.carried) },
  { key: 'groveXp', label: 'Grove XP', render: (p) => num(p.groveXp) },
  { key: 'regionXp', label: 'Region XP', render: (p) => num(p.regionXp) },
  { key: 'kills', label: 'Kills', render: (p) => p.kills },
  { key: 'deaths', label: 'Deaths', render: (p) => p.deaths },
];

export function PlayersTab({ data, onPlayer }: WithPlayer) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'humans' | 'agents' | 'today'>('all');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'lastSeen', desc: true });
  const [limit, setLimit] = useState(100);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.game.players.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.id.startsWith(q))
      && (filter === 'all' || (filter === 'online' && p.online) || (filter === 'humans' && !p.agent) || (filter === 'agents' && p.agent) || (filter === 'today' && p.today)));
    const value = (p: PlayerRow) => (sort.key === 'lastSeen' && p.online ? Number.MAX_SAFE_INTEGER : p[sort.key] ?? 0);
    return filtered.sort((a, b) => {
      const x = value(a), y = value(b);
      const order = typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y);
      return sort.desc ? -order : order;
    });
  }, [data, query, filter, sort]);
  const header = (key: SortKey, label: string) => <th key={key} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
    <button onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}>{label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}</button>
  </th>;
  return <section className="adm-card wide">
    <div className="adm-filters">
      <input type="search" placeholder="Search name or id" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="adm-seg">{(['all', 'online', 'today', 'humans', 'agents'] as const).map((f) => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div>
      <span className="adm-muted">{rows.length} of {data.game.playersTotal}{data.game.playersTotal > data.game.players.length ? ` (newest ${data.game.players.length} loaded)` : ''}</span>
    </div>
    <div className="adm-scroll">
      <table className="adm-table adm-players">
        <thead><tr>{header('name', 'Player')}<th>Step</th><th>Energy</th>{COLUMNS.map((c) => header(c.key, c.label))}</tr></thead>
        <tbody>{rows.slice(0, limit).map((p) => <tr key={p.id} onClick={() => onPlayer(p.id)} className="adm-row-link">
          <td><button className="adm-link" onClick={(e) => { e.stopPropagation(); onPlayer(p.id); }}>{p.name}</button> <Kind agent={p.agent} /></td>
          <td>{p.lastStep}</td>
          <td>{p.energy ? <span className={`adm-band ${p.energy.band}`}>{p.energy.band}</span> : '—'}</td>
          {COLUMNS.map((c) => <td key={c.key}>{c.render(p)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {rows.length > limit && <button className="adm-more" onClick={() => setLimit((l) => l + 200)}>Show more</button>}
  </section>;
}

// ---------------------------------------------------------------------------- Activity

const METRICS: { key: keyof Snapshot['game']['series'][number]['totals']; label: string }[] = [
  { key: 'harvests', label: 'Harvests' }, { key: 'gathered', label: 'Items gathered' }, { key: 'crafts', label: 'Crafts' },
  { key: 'trades', label: 'Trades' }, { key: 'deposits', label: 'Vault deposits' }, { key: 'chats', label: 'Chat messages' },
  { key: 'kills', label: 'PvP kills' }, { key: 'deaths', label: 'Deaths' }, { key: 'sessions', label: 'Sessions' },
];

export function ActivityTab({ data }: { data: Snapshot }) {
  const g = data.game;
  const actions = new Map<string, number>();
  for (const p of g.series) for (const [k, v] of Object.entries(p.actions)) actions.set(k, (actions.get(k) ?? 0) + v);
  const totals = (key: (typeof METRICS)[number]['key']) => g.series.reduce((s, p) => s + p.totals[key], 0);
  const joined = g.funnel[0]?.reached ?? 0;
  return <>
    <div className="adm-grid three">
      {METRICS.map((m) => <Card key={m.key} title={`${m.label} · ${compact(totals(m.key))}`}>
        <BarChart height={120} data={g.series.map((p) => ({ label: dayLabel(p.day), values: [p.totals[m.key]] }))} series={[{ name: m.label, color: C.one }]} />
      </Card>)}
    </div>
    <div className="adm-grid">
      <Card title="What players do outside the Grove" note={`Region, boss and vault actions in the last ${g.days} days.`}>
        <HBars rows={[...actions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([label, value]) => ({ label, value }))} color={C.two} />
      </Card>
      <Card title="New-player funnel" note="Furthest milestone each character has reached, all time. The note is how many stopped there.">
        <HBars rows={g.funnel.map((f) => ({ label: f.step, value: f.reached, note: `${pct(f.reached, joined)} · ${f.stopped} stopped` }))} color={C.one} />
      </Card>
      <Card title="Retention by join day" wide note="Share of each day's new characters active again exactly 1, 3 and 7 days later. Blank cells have not happened yet.">
        <div className="adm-scroll"><table className="adm-table adm-cohorts">
          <thead><tr><th>Joined</th><th>New</th><th>Day 1</th><th>Day 3</th><th>Day 7</th></tr></thead>
          <tbody>{[...g.cohorts].reverse().map((c) => <tr key={c.day}><td>{dayLabel(c.day)}</td><td>{c.size}</td>
            {(['d1', 'd3', 'd7'] as const).map((k) => {
              const v = c.returned[k];
              const share = v === null || !c.size ? null : v / c.size;
              return <td key={k} className="adm-heat" style={share === null ? undefined : { ['--heat' as string]: String(Math.round(share * 100)) }}>
                {share === null ? '' : `${Math.round(share * 100)}% (${v})`}</td>;
            })}</tr>)}</tbody>
        </table></div>
      </Card>
    </div>
  </>;
}

// ---------------------------------------------------------------------------- Economy

export function EconomyTab({ data, onPlayer }: WithPlayer) {
  const e = data.game.economy;
  const [itemSort, setItemSort] = useState<'total' | 'value'>('total');
  const drift = e.walletTotal - e.ledgerTotal;
  const minted = e.coinDays.reduce((s, d) => s + d.minted, 0), burned = e.coinDays.reduce((s, d) => s + d.burned, 0);
  return <>
    <div className="adm-tiles">
      <Tile label="Coin supply" value={num(e.coins.total)} sub={`${e.coins.holders} holders`} />
      <Tile label="Median wallet" value={num(e.coins.median)} sub={`p90 ${num(e.coins.p90)} · max ${num(e.coins.max)}`} />
      <Tile label="Top 10% hold" value={pct(e.coins.top10Share, 1)} sub={`Gini ${e.coins.gini.toFixed(2)}`} />
      <Tile label={`Minted (${data.game.days}d)`} value={num(minted)} sub={`burned ${num(burned)} · net ${num(minted - burned)}`} />
      <Tile label="Wealth (coins + items)" value={num(e.wealth.total)} sub={`Gini ${e.wealth.gini.toFixed(2)}`} />
      <Tile label="Ledger check" value={drift === 0 ? 'Balanced' : `${drift > 0 ? '+' : ''}${num(drift)}`} sub={drift === 0 ? `${num(e.ledgerEntries)} entries` : 'wallets differ from the coin ledger'} />
      <Tile label="Land claims" value={e.claims.total} sub={Object.entries(e.claims.byStatus).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none'} />
      <Tile label="Energy" value={`${e.energy.tired ?? 0} tired`} sub={`${e.energy.rested ?? 0} rested · ${e.energy.normal ?? 0} normal`} />
    </div>
    <div className="adm-grid">
      <Card title="Coin supply" note="Total coins in wallets at the end of each UTC day, rebuilt from the coin ledger.">
        <LineChart data={e.coinDays.map((d) => ({ label: dayLabel(d.day), value: d.supply }))} color={C.one} name="Coin supply" />
      </Card>
      <Card title="Coins created and removed" note="Created above zero, removed below. Player trades move coins and are not counted.">
        <BarChart data={e.coinDays.map((d) => ({ label: dayLabel(d.day), values: [d.minted, -d.burned] }))} series={[{ name: 'Created', color: C.minted }, { name: 'Removed', color: C.burned }]} />
      </Card>
      <Card title="Sources and sinks, all time">
        <table className="adm-table"><thead><tr><th>Reason</th><th>Created</th><th>Removed</th><th>Entries</th></tr></thead>
          <tbody>{e.reasons.map((r) => <tr key={r.reason}><td>{r.reason}</td><td>{num(r.minted)}</td><td>{num(r.burned)}</td><td>{num(r.entries)}</td></tr>)}</tbody></table>
        {!e.reasons.length && <div className="adm-muted">No coins have moved yet.</div>}
      </Card>
      <Card title="Richest players">
        <table className="adm-table"><thead><tr><th>Player</th><th>Coins</th><th>Vault items</th></tr></thead>
          <tbody>{e.richest.filter((r) => r.coins || r.vaultValue).map((r) => <tr key={r.id}><td><Name id={r.id} name={r.name} agent={r.agent} onPlayer={onPlayer} /></td><td>{num(r.coins)}</td><td>{num(r.vaultValue)}</td></tr>)}</tbody></table>
      </Card>
      <Card title="Items in the world" wide note="Every stack by where it is held. Value uses the load-glow item values.">
        <div className="adm-filters"><div className="adm-seg">{(['total', 'value'] as const).map((k) => <button key={k} className={itemSort === k ? 'active' : ''} onClick={() => setItemSort(k)}>by {k}</button>)}</div></div>
        <div className="adm-scroll"><table className="adm-table">
          <thead><tr><th>Item</th><th>Bags</th><th>Vaults</th><th>Storage</th><th>Ground</th><th>Total</th><th>Value</th></tr></thead>
          <tbody>{[...e.items].sort((a, b) => b[itemSort] - a[itemSort]).map((i) => <tr key={i.itemId}><td>{i.name}</td><td>{num(i.bags)}</td><td>{num(i.vaults)}</td><td>{num(i.storage)}</td><td>{num(i.ground)}</td><td><b>{num(i.total)}</b></td><td>{num(i.value)}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <Card title="Latest coin movements" wide>
        <div className="adm-scroll"><table className="adm-table">
          <thead><tr><th>When</th><th>Player</th><th>Amount</th><th>Reason</th></tr></thead>
          <tbody>{e.recentLedger.map((l) => <tr key={l.id}><td>{ago(l.at)}</td><td><Name id={l.owner} name={l.name ?? l.owner.slice(0, 8)} onPlayer={onPlayer} /></td>
            <td className={l.amount < 0 ? 'adm-neg' : 'adm-pos'}>{l.amount > 0 ? '+' : ''}{num(l.amount)}</td><td>{l.reason}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </div>
  </>;
}

// ---------------------------------------------------------------------------- Gateway

export function GatewayTab({ data }: { data: Snapshot }) {
  const gw = data.gateway;
  const active = (kind: string) => gw.sessions.filter((s) => s.kind === kind && s.state === 'active').reduce((n, s) => n + s.n, 0);
  return <>
    <div className="adm-tiles">
      <Tile label="Agent API sessions" value={active('agent')} sub={`${num(gw.sessions.filter((s) => s.kind === 'agent').reduce((n, s) => n + (s.actions ?? 0), 0))} actions`} />
      <Tile label="Browser sessions" value={active('human')} sub={`${gw.renewals} returning browsers`} />
      <Tile label="Open invites" value={gw.invites.reduce((n, i) => n + i.n, 0)} sub={gw.invites.map((i) => `${i.n} ${i.kind}`).join(' · ') || 'none'} />
      <Tile label="Accounts" value={gw.accounts.total} sub={`${gw.accounts.new7d} new this week · ${gw.accounts.seen7d} seen`} />
    </div>
    <div className="adm-grid">
      <Card title="Joins per day" note="Gateway sign-ins (agents and browsers). The gateway keeps 7 days.">
        <BarChart data={gw.daily.map((d) => ({ label: d.day.slice(5), values: [d.joins] }))} series={[{ name: 'Joins', color: C.one }]} />
      </Card>
      <Card title="API requests per day">
        <BarChart data={gw.daily.map((d) => ({ label: d.day.slice(5), values: [d.requests] }))} series={[{ name: 'Requests', color: C.two }]} />
      </Card>
      <Card title="Sessions by state">
        <table className="adm-table"><thead><tr><th>Kind</th><th>State</th><th>Sessions</th><th>Actions</th></tr></thead>
          <tbody>{gw.sessions.map((s) => <tr key={`${s.kind}-${s.state}`}><td>{s.kind}</td><td>{s.state}</td><td>{s.n}</td><td>{num(s.actions ?? 0)}</td></tr>)}</tbody></table>
        {!gw.sessions.length && <div className="adm-muted">No live sessions.</div>}
      </Card>
      <Card title="Sign-in accounts">
        <HBars rows={gw.accounts.byProvider.map((p) => ({ label: p.provider, value: p.n }))} color={C.one} />
        <p className="adm-muted adm-small">{gw.accounts.withCharacter} linked to a character · {gw.accounts.seen1d} seen today</p>
      </Card>
    </div>
  </>;
}
