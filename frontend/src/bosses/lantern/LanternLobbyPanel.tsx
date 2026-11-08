import { useEffect, useState } from 'react';
import {
  LANTERN_BAIT, LANTERN_ENTRY_FEE, LANTERN_GATE, LANTERN_GATE_RANGE, LANTERN_MAX_PARTY, SpireMemberState, SpireStage, TICK_MS,
  chebyshev, lanternConfigOr, lanternEntryRejection,
} from '@sim';
import { useInventoryRows, useMyPlayer, usePlayersByHex, useTick } from '../../spacetime/hooks';
import { useGameActions } from '../../spacetime/actions';
import { useFrontierCoins } from '../../frontier/useFrontier';
import { approachWorldInteraction } from '../../frontier/worldInteraction';
import { useBossStore, type LanternMemberRow, type LanternRunRow } from '../bossStore';
import { lanternActiveRuns, lanternLobbies } from '../selectors';
import { clock } from '../spire/SpireHud';
import { loadLanternScene } from './loadLanternScene';
import '../bosses.css';

/**
 * The Fen Gate's lobby panel (`data-testid="lantern-lobby"`), the Spire's
 * lobby on the lantern tables: your party (bait, distance, Start, Leave, the
 * lobby countdown), open parties with Join and Quick join, and Open. Shown
 * while `useBossStore.lanternLobbyOpen` or a Lobby membership; preloads the
 * Drowned Hollow's scene chunk. Open, join and start walk to the gate first.
 */
export type LanternLobbyPanelProps = Record<string, never>;

export const LANTERN_SEALED_MESSAGE = 'The Drowned Hollow is sealed';
export const LANTERN_FULL_MESSAGE = 'The Drowned Hollow is full right now. Try again in a minute';
export const LANTERN_NEEDS = `Every member needs a stone club or better, a Fen Bait (1 gleamshell + 1 obsidian + 2 driftwood, Crafting 1) and ${LANTERN_ENTRY_FEE} coins; the bait and coins are spent when the party starts.`;
const ALREADY = 'You are already in a Lanternmaw party';
const GATE = { region: 'bramblewild' as const, x: LANTERN_GATE.x, z: LANTERN_GATE.z };

const atGate = (perform: () => void) => approachWorldInteraction(GATE, perform, LANTERN_GATE_RANGE);

/** The members of a lantern run, by slot. */
export function lanternRunMembers(members: ReadonlyMap<string, LanternMemberRow>, runId: bigint | undefined): [string, LanternMemberRow][] {
  if (runId === undefined) return [];
  return [...members].filter(([, m]) => m.runId === runId).sort((a, b) => a[1].slot - b[1].slot);
}

export default function LanternLobbyPanel(_props: LanternLobbyPanelProps) {
  const me = useMyPlayer();
  const tick = useTick();
  const players = usePlayersByHex();
  const inventory = useInventoryRows();
  const coins = useFrontierCoins();
  const { lanternOpen, lanternJoin, lanternStart, lanternLeave } = useGameActions();
  const config = lanternConfigOr(useBossStore((s) => s.lanternConfig));
  const runs = useBossStore((s) => s.lanternRuns);
  const members = useBossStore((s) => s.lanternMembers);
  const myRun = useBossStore((s) => s.myLanternRun);
  const myMember = useBossStore((s) => s.myLanternMember);
  const meHex = useBossStore((s) => s.meHex);
  const lobbyOpen = useBossStore((s) => s.lanternLobbyOpen);
  const [hidden, setHidden] = useState(false);

  useEffect(() => { loadLanternScene().catch(() => { /* fetched again when the scene mounts */ }); }, []);

  // The server's own entry check, on what this client knows: weapon, bait, coins.
  const entry = lanternEntryRejection(inventory.map((r) => ({ itemId: r.itemId, quantity: r.quantity })), coins, me?.weapon ?? '');
  const inLobby = !!myMember && !!myRun && myRun.stage === SpireStage.Lobby;
  const stillFighting = !!myMember && myRun?.stage === SpireStage.Active && myMember.state !== SpireMemberState.Left;
  const active = lanternActiveRuns({ lanternRuns: runs });
  const full = active >= config.lanternMaxRuns;
  const lobbies = lanternLobbies({ lanternRuns: runs }).filter((r) => r.id !== myRun?.id);
  const close = () => { useBossStore.getState().setLanternLobbyOpen(false); if (inLobby) setHidden(true); };

  if (hidden && inLobby && !lobbyOpen) {
    return <section className="spire-lobby lantern-lobby" data-testid="lantern-lobby" aria-label="Lanternmaw party">
      <header><h2>Fen party {myRun!.partySize}/{LANTERN_MAX_PARTY}</h2><button type="button" onClick={() => setHidden(false)}>Show</button></header>
    </section>;
  }

  const problem = !config.lanternOpen ? LANTERN_SEALED_MESSAGE : inLobby || stillFighting ? ALREADY : entry;

  return <section className="spire-lobby lantern-lobby" data-testid="lantern-lobby" aria-label="Lanternmaw">
    <header>
      <h2>The Fen Gate</h2>
      <button type="button" aria-label="Close" onClick={close}>×</button>
    </header>
    {!config.lanternOpen && <p className="spire-reason" data-testid="lantern-sealed">{LANTERN_SEALED_MESSAGE}</p>}
    {config.lanternOpen && full && <p className="spire-note" data-testid="lantern-capacity">{LANTERN_FULL_MESSAGE}</p>}
    {config.lanternOpen && !full && <p className="spire-note">{active} {active === 1 ? 'party' : 'parties'} below · room for {config.lanternMaxRuns - active} more</p>}

    {inLobby && myRun && <YourParty run={myRun} tick={tick} leader={myRun.leader.toHexString() === meHex} meHex={meHex} ready={!entry}
      players={players} members={lanternRunMembers(members, myRun.id)} full={full}
      onStart={() => atGate(() => { void lanternStart(); })} onLeave={() => { void lanternLeave(); }} />}
    {inLobby && entry && <p className="spire-reason" data-testid="lantern-entry-reason">{entry}</p>}

    {stillFighting && <>
      <p className="spire-note">Your party is still fighting below.</p>
      <div className="spire-actions"><button type="button" onClick={() => { void lanternLeave(); }}>Give up its reward</button></div>
    </>}

    {!inLobby && !stillFighting && <>
      <h3>Open parties</h3>
      {lobbies.length === 0 ? <p className="spire-note">No party is waiting.</p> : <ul>
        {lobbies.map((r) => {
          const leader = players.get(r.leader.toHexString())?.name || 'Someone';
          const roomy = r.partySize < LANTERN_MAX_PARTY;
          return <li key={String(r.id)}>
            <span>{leader}'s party · {r.partySize}/{LANTERN_MAX_PARTY}</span>
            <button type="button" disabled={!!problem || !roomy} onClick={() => atGate(() => { void lanternJoin(r.id); })}>{roomy ? 'Join' : 'Full'}</button>
          </li>;
        })}
      </ul>}
      <JoinById disabled={!!problem} onJoin={(id) => atGate(() => { void lanternJoin(id); })} />
      <div className="spire-actions">
        <button type="button" disabled={!!problem || lobbies.length === 0} onClick={() => atGate(() => { void lanternJoin(0n); })}>Quick join</button>
        <button type="button" className="is-primary" disabled={!!problem} onClick={() => atGate(() => { void lanternOpen(); })}>Open a party</button>
      </div>
      {problem && config.lanternOpen && <p className="spire-reason" data-testid="lantern-open-reason">{problem}</p>}
      <p className="spire-note" data-testid="lantern-needs">{LANTERN_NEEDS}{me && chebyshev(me, LANTERN_GATE) > LANTERN_GATE_RANGE ? ' You will walk to the gate first.' : ''}</p>
    </>}
  </section>;
}

/** Join a party by its run id (a friend reads it out from their panel). */
function JoinById({ disabled, onJoin }: { disabled: boolean; onJoin: (id: bigint) => void }) {
  const [text, setText] = useState('');
  const id = /^\d{1,19}$/.test(text.trim()) ? BigInt(text.trim()) : 0n;
  return <form className="spire-actions" onSubmit={(e) => { e.preventDefault(); if (id > 0n && !disabled) onJoin(id); }}>
    <input aria-label="Party id" inputMode="numeric" placeholder="Party id" value={text} onChange={(e) => setText(e.target.value)} size={8} />
    <button type="submit" disabled={disabled || id === 0n}>Join by id</button>
  </form>;
}

function YourParty({ run, tick, leader, meHex, ready, players, members, full, onStart, onLeave }: {
  run: LanternRunRow; tick: number; leader: boolean; meHex: string | null; ready: boolean; full: boolean;
  players: Map<string, { name: string; x: number; z: number; online?: boolean; region?: string }>;
  members: [string, { slot: number }][]; onStart: () => void; onLeave: () => void;
}) {
  const left = ((run.endTick - tick) * TICK_MS) / 1000;
  return <>
    <h3>Your party <small data-testid="lantern-party-id">#{String(run.id)}</small></h3>
    <ul aria-label="Your party">
      {members.map(([hex]) => {
        const p = players.get(hex);
        const mine = hex === meHex;
        const away = !p || (p.region && p.region !== 'bramblewild') ? 'away' : chebyshev(p, LANTERN_GATE) <= LANTERN_GATE_RANGE ? 'at the gate' : `${chebyshev(p, LANTERN_GATE)} tiles away`;
        return <li key={hex}>
          <span><span className={`spire-online${p?.online !== false && p ? ' is-on' : ''}`} />{p?.name || 'Someone'}{run.leader.toHexString() === hex ? ' (leader)' : ''}</span>
          <span>{mine ? (ready ? 'ready ✓' : 'not ready ✗') : `${LANTERN_BAIT.name} ?`} · {away}</span>
        </li>;
      })}
    </ul>
    <p className="spire-note">Breaks up in {clock(left)}</p>
    <div className="spire-actions">
      {leader && <button type="button" className="is-primary" disabled={full} onClick={onStart}>Start</button>}
      <button type="button" onClick={onLeave}>Leave</button>
    </div>
    {leader && full && <p className="spire-reason">{LANTERN_FULL_MESSAGE}</p>}
    {!leader && <p className="spire-note">The leader starts the run when everyone is at the gate.</p>}
  </>;
}
