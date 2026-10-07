import { useEffect, useState } from 'react';
import {
  SPIRE_GATE, SPIRE_GATE_RANGE, SPIRE_MAX_PARTY, SpireMemberState, SpireMode, SpireStage, TICK_MS, bossConfigOr, chebyshev,
} from '@sim';
import { useInventoryRows, useMyPlayer, usePlayersByHex, useTick } from '../../spacetime/hooks';
import { useGameActions } from '../../spacetime/actions';
import { approachWorldInteraction } from '../../frontier/worldInteraction';
import { useBossStore, type SpireRunRow } from '../bossStore';
import { spireActiveRuns, spireLobbies } from '../selectors';
import { loadSpireScene } from './loadSpireScene';
import { clock, runMembers } from './SpireHud';
import '../bosses.css';

/**
 * The lobby panel (FINAL_SPEC 7.3, `data-testid="spire-lobby"`): your party
 * (keys, distance, Start, Leave, the lobby countdown), open public parties
 * with Join and Quick join, and Open. Shown while `useBossStore.lobbyOpen` or
 * a Lobby membership; calls `loadSpireScene()` on mount so the scene chunk
 * arrives during the lobby. Open, join and start walk to the gate first.
 * CORE_SCOPE: every party is public; no practice, kick or queue.
 */
export type SpireLobbyPanelProps = Record<string, never>;

export const SPIRE_KEY_ID = 'spire_key';
export const NO_KEY_REASON = 'Needs a spire key: 3 obsidian + 1 gleamshell';
export const FULL_MESSAGE = 'The Sunken Spire is full right now. Try again in a minute';
export const SEALED_MESSAGE = 'The Sunken Spire is sealed';
const GATE = { region: 'bramblewild' as const, x: SPIRE_GATE.x, z: SPIRE_GATE.z };

/** Walk within range of the gate, then act (the reducers refuse from farther away). */
const atGate = (perform: () => void) => approachWorldInteraction(GATE, perform, SPIRE_GATE_RANGE);

export default function SpireLobbyPanel(_props: SpireLobbyPanelProps) {
  const me = useMyPlayer();
  const tick = useTick();
  const players = usePlayersByHex();
  const inventory = useInventoryRows();
  const { spireOpen, spireJoin, spireStart, spireLeave } = useGameActions();
  const config = bossConfigOr(useBossStore((s) => s.config));
  const runs = useBossStore((s) => s.runs);
  const members = useBossStore((s) => s.members);
  const myRun = useBossStore((s) => s.myRun);
  const myMember = useBossStore((s) => s.myMember);
  const meHex = useBossStore((s) => s.meHex);
  const lobbyOpen = useBossStore((s) => s.lobbyOpen);
  const [hidden, setHidden] = useState(false);

  // Fetch the Spire scene's chunk now, well before the teleport.
  useEffect(() => { loadSpireScene().catch(() => { /* A failed preload is fetched again when the scene mounts. */ }); }, []);

  const keys = inventory.reduce((n, r) => n + (r.itemId === SPIRE_KEY_ID ? r.quantity : 0), 0);
  const inLobby = !!myMember && !!myRun && (myRun.stage === SpireStage.Lobby || myRun.stage === SpireStage.Queued);
  // A forfeit (Left) frees you at once: the server deletes that row when you open or join again (spireMembershipProblem).
  const stillFighting = !!myMember && myRun?.stage === SpireStage.Active && myMember.state !== SpireMemberState.Left;
  const active = spireActiveRuns({ runs });
  const full = active >= config.spireMaxRuns;
  const lobbies = spireLobbies({ runs }).filter((r) => r.isPublic && r.mode === SpireMode.Normal && r.id !== myRun?.id);
  const close = () => { useBossStore.getState().setLobbyOpen(false); if (inLobby) setHidden(true); };

  if (hidden && inLobby && !lobbyOpen) {
    return <section className="spire-lobby" data-testid="spire-lobby" aria-label="Sunken Spire party">
      <header><h2>Spire party {myRun!.partySize}/{SPIRE_MAX_PARTY}</h2><button type="button" onClick={() => setHidden(false)}>Show</button></header>
    </section>;
  }

  const openProblem = !config.spireOpen ? SEALED_MESSAGE : inLobby || stillFighting ? 'You are already in a Spire party' : keys < 1 ? NO_KEY_REASON : null;
  const joinProblem = !config.spireOpen ? SEALED_MESSAGE : inLobby || stillFighting ? 'You are already in a Spire party' : keys < 1 ? NO_KEY_REASON : null;

  return <section className="spire-lobby" data-testid="spire-lobby" aria-label="Sunken Spire">
    <header>
      <h2>The Sunken Spire</h2>
      <button type="button" aria-label="Close" onClick={close}>×</button>
    </header>
    {!config.spireOpen && <p className="spire-reason">{SEALED_MESSAGE}</p>}
    {config.spireOpen && full && <p className="spire-note" data-testid="spire-capacity">{FULL_MESSAGE}</p>}
    {config.spireOpen && !full && <p className="spire-note">{active} {active === 1 ? 'party' : 'parties'} inside · room for {config.spireMaxRuns - active} more</p>}

    {inLobby && myRun && <YourParty run={myRun} tick={tick} leader={myRun.leader.toHexString() === meHex} meHex={meHex} myKeys={keys}
      players={players} members={runMembers(members, myRun.id)} full={full}
      onStart={() => atGate(() => { void spireStart(); })} onLeave={() => { void spireLeave(); }} />}

    {stillFighting && <>
      <p className="spire-note">Your party is still fighting inside.</p>
      <div className="spire-actions"><button type="button" onClick={() => { void spireLeave(); }}>Give up its reward</button></div>
    </>}

    {!inLobby && !stillFighting && <>
      <h3>Open parties</h3>
      {lobbies.length === 0 ? <p className="spire-note">No party is waiting.</p> : <ul>
        {lobbies.map((r) => {
          const leader = players.get(r.leader.toHexString())?.name || 'Someone';
          const roomy = r.partySize < SPIRE_MAX_PARTY;
          return <li key={String(r.id)}>
            <span>{leader}'s party · {r.partySize}/{SPIRE_MAX_PARTY}</span>
            <button type="button" disabled={!!joinProblem || !roomy} onClick={() => atGate(() => { void spireJoin(r.id); })}>
              {roomy ? 'Join' : 'Full'}
            </button>
          </li>;
        })}
      </ul>}
      <div className="spire-actions">
        <button type="button" disabled={!!joinProblem || lobbies.length === 0} onClick={() => atGate(() => { void spireJoin(0n); })}>Quick join</button>
        <button type="button" className="is-primary" disabled={!!openProblem} onClick={() => atGate(() => { void spireOpen(); })}>Open a party</button>
      </div>
      {openProblem && config.spireOpen && <p className="spire-reason" data-testid="spire-open-reason">{openProblem}</p>}
      <p className="spire-note">Every member needs a spire key; each is spent when the party starts.{me && chebyshev(me, SPIRE_GATE) > SPIRE_GATE_RANGE ? ' You will walk to the gate first.' : ''}</p>
    </>}
  </section>;
}

function YourParty({ run, tick, leader, meHex, myKeys, players, members, full, onStart, onLeave }: {
  run: SpireRunRow; tick: number; leader: boolean; meHex: string | null; myKeys: number; full: boolean;
  players: Map<string, { name: string; x: number; z: number; online?: boolean; region?: string }>;
  members: [string, { slot: number }][]; onStart: () => void; onLeave: () => void;
}) {
  const left = ((run.endTick - tick) * TICK_MS) / 1000;
  return <>
    <h3>Your party</h3>
    <ul aria-label="Your party">
      {members.map(([hex]) => {
        const p = players.get(hex);
        const mine = hex === meHex;
        const away = !p || (p.region && p.region !== 'bramblewild') ? 'away' : chebyshev(p, SPIRE_GATE) <= SPIRE_GATE_RANGE ? 'at the gate' : `${chebyshev(p, SPIRE_GATE)} tiles away`;
        return <li key={hex}>
          <span><span className={`spire-online${p?.online !== false && p ? ' is-on' : ''}`} />{p?.name || 'Someone'}{run.leader.toHexString() === hex ? ' (leader)' : ''}</span>
          <span>{mine ? (myKeys > 0 ? 'key ✓' : 'key ✗') : 'key ?'} · {away}</span>
        </li>;
      })}
    </ul>
    <p className="spire-note">{run.stage === SpireStage.Queued ? 'Queued' : `Breaks up in ${clock(left)}`}</p>
    <div className="spire-actions">
      {leader && <button type="button" className="is-primary" disabled={full} onClick={onStart}>Start</button>}
      <button type="button" onClick={onLeave}>Leave</button>
    </div>
    {leader && full && <p className="spire-reason">{FULL_MESSAGE}</p>}
    {!leader && <p className="spire-note">The leader starts the run when everyone is at the gate.</p>}
  </>;
}
