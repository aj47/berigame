import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { MeshBasicMaterial, RingGeometry, type Group, type Mesh } from 'three';
import { useSpacetimeDB } from 'spacetimedb/react';
import {
  CLATTER_DIR8, CLATTER_GLADE, CLATTER_REACH, ClatterState, TICK_MS, clatterSwarmBullets, tileToWorld,
} from '@sim';
import { useGameActions } from '../../spacetime/actions';
import { useMyPlayerSelector, useTick } from '../../spacetime/hooks';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { tickClock } from '../../spacetime/tickClock';
import { useUserInputStore } from '../../store';
import { holdState, isDirectAttackClick } from '../../Components/3D/tapAssist';
import { performOnIsland } from '../../frontier/worldInteraction';
import BulletLayer, { type BulletSource } from '../BulletLayer';
import { useBossStore, type ClatterhornRow } from '../bossStore';
import ClatterTelegraph, { telegraphLead } from './ClatterTelegraph';
import { CLATTER_HIPS, CLATTER_WING_HINGE, clatterMaterials, clatterParts } from './clatterGeometry';
import { useClatterFxStore, type ClatterHit } from './clatterFx';
import { connectionPlayerSource, setClatterPlayerSource } from './clatterPlayers';
import './clatterhorn.css';

export interface ClatterhornModelProps {
  /** The clatterhorn row; nothing is drawn while Closed or missing. */
  row: ClatterhornRow | null;
  /** The world tick the row belongs to (tickClock). */
  tick: number;
  /** Click or menu "Attack Clatterhorn". */
  onAttack: () => void;
}

/** The dash from the old to the new centre on a charge's landing row. */
export const DASH_MS = 300;
/** Rolling onto its back. */
export const FLIP_ROLL_MS = 400;
const FLINCH_MS = 380;
const GLADE_BOX = { boxX0: CLATTER_GLADE.x0 - 1, boxZ0: CLATTER_GLADE.z0 - 1, boxX1: CLATTER_GLADE.x1 + 1, boxZ1: CLATTER_GLADE.z1 + 1 };

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const noRaycast = () => null;
const dustRing = new RingGeometry(0.6, 1, 20).rotateX(-Math.PI / 2);
const dustMat = new MeshBasicMaterial({ color: '#d9c8a6', transparent: true, opacity: 0, depthWrite: false });

/** "1,250" */
const fmt = (n: number) => Math.max(0, Math.round(n)).toLocaleString('en-US');

/** The HP-bar line (pure, for tests). */
export function clatterBarText(row: Pick<ClatterhornRow, 'state' | 'hp' | 'maxHp' | 'challengers' | 'stateUntilTick'>, tick: number): string {
  if (row.state === ClatterState.Burrowed) {
    const s = Math.max(0, Math.ceil(((row.stateUntilTick - tick) * TICK_MS) / 1000));
    return `Clatterhorn has burrowed · back in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  if (row.state === ClatterState.Dormant) return 'Clatterhorn sleeps in its glade';
  const c = row.challengers;
  return `Clatterhorn · ${fmt(row.hp)}/${fmt(row.maxHp)} · ${c} challenger${c === 1 ? '' : 's'}`;
}

/** The click menu's one option (pure, for tests). */
export function clatterMenuOption(state: number): { label: string; disabled: boolean } {
  return state === ClatterState.Burrowed
    ? { label: 'Clatterhorn has burrowed away', disabled: true }
    : { label: 'Attack Clatterhorn', disabled: false };
}

/**
 * The beetle (FINAL_SPEC 7.2): procedural low-poly model posed from
 * `row.state`, the HP bar, click guards and menu, with ClatterTelegraph and
 * the runner BulletLayer as children. Pure for tests.
 */
export function ClatterhornModel(props: ClatterhornModelProps) {
  if (!props.row || props.row.state === ClatterState.Closed) return null;
  return <Beetle {...props} row={props.row} />;
}

interface Seen {
  fromX: number; fromZ: number; toX: number; toZ: number; dashAt: number;
  x: number; z: number; yaw: number; flip: number; flipAt: number; unflipAt: number; spinAt: number; windupAt: number; windKey: string;
  curl: number; open: number; state: number; yawTarget?: number;
}

function Beetle({ row, tick, onAttack }: ClatterhornModelProps & { row: ClatterhornRow }) {
  const root = useRef<Group>(null);
  const yawG = useRef<Group>(null);
  const flipG = useRef<Group>(null);
  const body = useRef<Group>(null);
  const model = useRef<Group>(null);
  const mound = useRef<Group>(null);
  const wingL = useRef<Group>(null);
  const wingR = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const dust = useRef<Mesh>(null);
  const live = useRef(row);
  live.current = row;
  const [wx, , wz] = tileToWorld(row);
  const seen = useRef<Seen>({
    fromX: wx, fromZ: wz, toX: wx, toZ: wz, dashAt: -Infinity, x: wx, z: wz,
    yaw: Math.atan2(CLATTER_DIR8[row.dir & 7][0], CLATTER_DIR8[row.dir & 7][1]),
    flip: row.state === ClatterState.Flipped ? 1 : 0, flipAt: -Infinity, unflipAt: -Infinity, spinAt: -Infinity, windupAt: -Infinity, windKey: '',
    curl: row.state === ClatterState.Dormant ? 1 : 0, open: 0, state: row.state,
  });
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const oneClickAttack = useSettingsStore((s) => s.oneClickAttack);
  const hit = useClatterFxStore((s) => s.hit);
  const p = clatterParts();
  const m = clatterMaterials();

  // Row transitions: the dash on a landing, flips, spins and back-dated windups.
  useEffect(() => {
    const s = seen.current;
    const now = performance.now(), period = tickClock.period;
    const [x, , z] = tileToWorld(row);
    if (x !== s.toX || z !== s.toZ) {
      if (s.state === ClatterState.ChargeWindup) {
        // Land with the avatars, which trail the server by a tick.
        s.fromX = s.x; s.fromZ = s.z; s.dashAt = now + period - DASH_MS;
      } else {
        s.fromX = x; s.fromZ = z; s.x = x; s.z = z; s.dashAt = -Infinity;
      }
      s.toX = x; s.toZ = z;
    }
    if (row.state === ClatterState.Flipped && s.state !== ClatterState.Flipped) s.flipAt = s.state === ClatterState.ChargeWindup ? now + period : now;
    if (row.state !== ClatterState.Flipped && s.state === ClatterState.Flipped) s.unflipAt = now;
    if (s.state === ClatterState.SpinWindup && row.state !== ClatterState.SpinWindup) s.spinAt = now + period - 200;
    const windup = row.state === ClatterState.ChargeWindup || row.state === ClatterState.SpinWindup || row.state === ClatterState.DrumWindup;
    const key = windup ? `${row.state}:${row.stateUntilTick}:${row.x}:${row.z}` : '';
    if (key && key !== s.windKey) {
      s.windupAt = now - Math.max(0, tickClock.tick - (row.stateUntilTick - telegraphLead(row))) * period;
    }
    s.windKey = key;
    if (row.state === ClatterState.ChargeWindup) {
      const d = CLATTER_DIR8[row.dir & 7];
      s.yawTarget = Math.atan2(d[0], d[1]);
    }
    s.state = row.state;
  }, [row]);

  useFrame((state, delta) => {
    const r = root.current, yg = yawG.current, fg = flipG.current, bd = body.current, md = model.current;
    if (!r || !yg || !fg || !bd || !md) return;
    const s = seen.current, g = live.current;
    const now = performance.now(), period = tickClock.period, t = state.clock.elapsedTime;
    const reduced = useSettingsStore.getState().reduceMotion;
    const fx = useClatterFxStore.getState();

    // Position: hold at the start until the dash, then rush to the new centre.
    const dk = clamp01((now - s.dashAt) / DASH_MS);
    const dashing = dk > 0 && dk < 1;
    s.x = s.fromX + (s.toX - s.fromX) * smooth(dk);
    s.z = s.fromZ + (s.toZ - s.fromZ) * smooth(dk);
    r.position.set(s.x, 0, s.z);

    // Facing: toward the telegraphed lane, smoothly; the spin adds a full turn over 2 ticks.
    const want = s.yawTarget ?? s.yaw;
    let dy = want - s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    s.yaw += dy * Math.min(1, delta * 8);
    const sk = clamp01((now - s.spinAt) / (2 * period));
    yg.rotation.y = s.yaw + (sk > 0 && sk < 1 ? smooth(sk) * Math.PI * 2 : 0);

    const burrowed = g.state === ClatterState.Burrowed;
    md.visible = !burrowed;
    const mo = mound.current;
    if (mo) mo.visible = burrowed;

    // Pose targets by state.
    const wk = clamp01((now - s.windupAt) / (Math.max(1, telegraphLead(g)) * period));
    let pitch = Math.sin(t * 1.4) * 0.015, lift = Math.sin(t * 1.8) * 0.02, open = 0, scrape = 0, beat = 0;
    const curlTarget = g.state === ClatterState.Dormant ? 1 : 0;
    s.curl += (curlTarget - s.curl) * Math.min(1, delta * 2.5);
    if (g.state === ClatterState.ChargeWindup) {
      pitch = -0.22 * wk; lift = 0.06 * wk;
      scrape = reduced ? 0 : Math.sin(now * 0.025) * 0.45 * wk;
      if (!reduced) bd.position.x = Math.sin(now * 0.07) * 0.025 * wk;
    } else bd.position.x = 0;
    if (g.state === ClatterState.SpinWindup) { open = 0.55 * wk; lift = -0.08 * wk; }
    if (g.state === ClatterState.DrumWindup || g.state === ClatterState.Drumming) {
      const k = g.state === ClatterState.Drumming ? 1 : wk;
      open = 0.55 * k; beat = reduced ? 0 : Math.abs(Math.sin(now * 0.03)) * 0.35 * k;
      lift = -0.04 + (reduced ? 0 : Math.abs(Math.sin(now * 0.03)) * 0.04);
    }
    if (sk > 0 && sk < 1) open = Math.max(open, 0.45 * (1 - sk));
    s.open += (open - s.open) * Math.min(1, delta * 10);

    // Flip: roll onto the back once the landing shows, legs wiggling, belly glowing gold.
    if (g.state === ClatterState.Flipped) s.flip = clamp01((now - s.flipAt) / FLIP_ROLL_MS);
    else s.flip = Math.min(s.flip, 1 - clamp01((now - s.unflipAt) / (FLIP_ROLL_MS * 1.6)));
    const fk = smooth(s.flip);
    fg.rotation.z = Math.PI * fk;
    fg.position.y = 1.5 * fk + (1 - fk) * (lift - 0.32 * s.curl);
    const glow = g.state === ClatterState.Flipped ? (reduced ? 1.1 : 0.9 + 0.5 * Math.sin(now * 0.012)) * fk : 0;
    m.belly.emissiveIntensity = glow;

    // A flinch on a landed swing.
    const since = now - fx.flinchAt;
    if (!reduced && since >= 0 && since < FLINCH_MS) pitch += Math.sin(since / 45) * 0.05 * (1 - since / FLINCH_MS);
    bd.rotation.x = pitch + 0.18 * s.curl;

    const wl = wingL.current, wr = wingR.current;
    if (wl && wr) {
      const a = s.open + beat;
      wl.rotation.z = a; wr.rotation.z = -a;
      wl.rotation.x = -0.35 * a; wr.rotation.x = -0.35 * a;
    }
    const legsNow = legs.current;
    for (let i = 0; i < 6; i++) {
      const leg = legsNow[i];
      if (!leg) continue;
      const side = i < 3 ? 1 : -1, j = i % 3;
      const phase = (j + (side > 0 ? 0 : 1)) * 2.1;
      const walk = dashing ? Math.sin(now * 0.06 + phase) * 0.5 : 0;
      const wiggle = fk > 0.5 && !reduced ? Math.sin(now * 0.03 + phase) * 0.5 : 0;
      leg.rotation.y = (j === 0 ? 0.55 : j === 2 ? -0.5 : 0) * side + walk + (j === 0 ? scrape * side : 0);
      leg.rotation.z = side * (0.95 * s.curl + 0.6 * fk + wiggle);
    }

    // Dust behind the dash.
    const d = dust.current;
    if (d) {
      const dustK = clamp01((now - s.dashAt) / (DASH_MS + 500));
      const on = dustK > 0 && dustK < 1 && useSettingsStore.getState().graphics !== 'low';
      d.visible = on;
      if (on) {
        d.position.set(s.fromX - s.x, 0.05, s.fromZ - s.z);
        const size = 0.8 + dustK * 1.6;
        d.scale.set(size, size, size);
        dustMat.opacity = 0.6 * (1 - dustK);
      }
    }
  });

  const attack = () => {
    const st = live.current.state;
    if (st !== ClatterState.Burrowed && st !== ClatterState.Closed) onAttack();
    setClickedOtherObject(null);
  };
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    const option = clatterMenuOption(live.current.state);
    if (!option.disabled && isDirectAttackClick(e, useSettingsStore.getState().oneClickAttack)) { attack(); return; }
    setClickedOtherObject({ connectionId: 'Clatterhorn', e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() }, dropdownOptions: [
      { label: option.label, disabled: option.disabled, onClick: attack },
    ] });
  };

  const burrowed = row.state === ClatterState.Burrowed;
  const swarm = row.state === ClatterState.DrumWindup || row.state === ClatterState.Drumming;
  const source = useRunnerSource(row, swarm);

  return (
    <group name="clatterhorn-root">
      <group ref={root} name="clatterhorn" position={[wx, 0, wz]} onClick={onClick} userData={{ berigameClatterhorn: row.id, hoverTarget: {
        title: 'Clatterhorn',
        action: oneClickAttack && !burrowed ? 'Click to attack · hold for options' : 'Click for Clatterhorn options',
        click: 'action', radius: 2.1,
        detail: burrowed ? 'Burrowed' : row.state === ClatterState.Dormant ? 'Asleep in its glade' : row.state === ClatterState.Flipped ? 'On its back: double damage!' : `Reach ${CLATTER_REACH} tiles`,
        tone: burrowed ? 'muted' : 'ready',
      } }}>
        <group ref={yawG} name="clatter-yaw">
          <group ref={flipG} name="clatter-flip">
            <group ref={model}>
              <group ref={body}>
                <mesh geometry={p.body} material={m.shell} castShadow />
                <mesh geometry={p.belly} material={m.belly} />
                <mesh position={[-0.2, 0.86, 1.6]} material={m.eye}><boxGeometry args={[0.1, 0.07, 0.05]} /></mesh>
                <mesh position={[0.2, 0.86, 1.6]} material={m.eye}><boxGeometry args={[0.1, 0.07, 0.05]} /></mesh>
                <group ref={wingL} position={CLATTER_WING_HINGE[0] as [number, number, number]}><mesh geometry={p.wingL} material={m.shell} castShadow /></group>
                <group ref={wingR} position={CLATTER_WING_HINGE[1] as [number, number, number]}><mesh geometry={p.wingR} material={m.shell} castShadow /></group>
              </group>
              {[1, -1].flatMap((side) => CLATTER_HIPS.map(([hx, hy, hz], j) => {
                const i = (side > 0 ? 0 : 3) + j;
                return (
                  <group key={i} ref={(g) => { legs.current[i] = g; }} position={[hx * side, hy, hz]}>
                    <mesh geometry={side > 0 ? p.legL : p.legR} material={m.legs} />
                  </group>
                );
              }))}
            </group>
          </group>
          <group ref={mound} visible={false}><mesh geometry={p.mound} material={m.legs} /></group>
        </group>
        <mesh ref={dust} visible={false} geometry={dustRing} material={dustMat} raycast={noRaycast} />
        {/* Fills the silhouette for clicks; the handler is on the group, so the visible-only event filter keeps it. */}
        <mesh position={[0, 0.8, 0]} visible={false}><boxGeometry args={[3, 1.8, 3]} /><meshBasicMaterial /></mesh>
        {hit && <ClatterDamage key={hit.seq} hit={hit} />}
        <ClatterBar row={row} tick={tick} />
      </group>
      <ClatterTelegraph row={row} tick={tick} />
      {swarm && <BulletLayer source={source} palette="runner" />}
    </group>
  );
}

/** A stable per-frame source of the swarm's runners (rebuilt only when the swarm changes). */
function useRunnerSource(row: ClatterhornRow, swarm: boolean): () => BulletSource | null {
  const ref = useRef<BulletSource | null>(null);
  const key = swarm ? `${row.state === ClatterState.DrumWindup ? row.stateUntilTick : row.swarmTick}:${row.swarmSide}:${row.swarmFree}` : '';
  const last = useRef('');
  if (key !== last.current) {
    last.current = key;
    ref.current = key ? { bullets: clatterSwarmBullets(row), ...GLADE_BOX } : null;
  }
  return useCallback(() => ref.current, []);
}

/** Your blow's number over the beetle: gold while it lies flipped (x2). */
function ClatterDamage({ hit }: { hit: ClatterHit }) {
  const remaining = () => Math.max(0, hit.at + hit.delayMs - performance.now());
  const [visible, setVisible] = useState(() => remaining() === 0);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), remaining());
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit]);
  if (!visible) return null;
  return (
    <Html position={[0, 2.4, 0]} center zIndexRange={[6, 4]} style={{ pointerEvents: 'none' }}>
      <div className={`damage-number ${hit.flipped ? 'clatter-crit' : 'stick-damage'} ${hit.seq % 2 ? 'animation1' : 'animation2'}`} data-testid="clatter-damage">
        {hit.flipped ? `${hit.damage}!` : hit.damage}
      </div>
    </Html>
  );
}

/** Name, HP and challengers over its shell; Z z z while dormant; the countdown while burrowed. */
function ClatterBar({ row, tick }: { row: ClatterhornRow; tick: number }) {
  const text = clatterBarText(row, tick);
  const awake = row.state !== ClatterState.Burrowed && row.state !== ClatterState.Dormant;
  return (
    <Html position={[0, row.state === ClatterState.Burrowed ? 1.6 : 2.9, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
      <div className="giant-hp clatter-hp" data-testid="clatter-hp">
        {row.state === ClatterState.Dormant && <div className="giant-zzz" aria-hidden="true">Z z z</div>}
        <div className="giant-hp-name">
          {text}
          {row.state === ClatterState.Flipped && <span className="clatter-x2" data-testid="clatter-x2">x2</span>}
        </div>
        {awake && (
          <div className="giant-hp-bar" role="meter" aria-label="Clatterhorn" aria-valuenow={row.hp} aria-valuemax={row.maxHp}>
            <div className="giant-hp-fill clatter-hp-fill" style={{ width: `${(row.hp / Math.max(1, row.maxHp)) * 100}%` }} />
          </div>
        )}
      </div>
    </Html>
  );
}

export type ClatterhornProps = Record<string, never>;

/** Reads `useBossStore(s => s.clatter)`; mounted by RenderOnlineUsers next to the Giant (WP9). */
function ClatterhornConnected(_props: ClatterhornProps) {
  const row = useBossStore((s) => s.clatter);
  if (!row || row.state === ClatterState.Closed) return null;
  return <ClatterhornLive row={row} />;
}

const selectRegion = (p: { region?: string } | null) => p?.region;

function ClatterhornLive({ row }: { row: ClatterhornRow }) {
  const { attackClatterhorn } = useGameActions();
  const { getConnection } = useSpacetimeDB();
  const region = useMyPlayerSelector(selectRegion as any) as string | undefined;
  const tick = useTick();
  useEffect(() => setClatterPlayerSource(connectionPlayerSource(getConnection)), [getConnection]);
  const live = useRef(row);
  live.current = row;
  const attack = useCallback(() => {
    // The glade is in Bramblewild; from the Meadows cross the boundary first.
    performOnIsland(region, live.current, () => { void attackClatterhorn(); }, CLATTER_REACH);
  }, [region, attackClatterhorn]);
  return <ClatterhornModel row={row} tick={tick} onAttack={attack} />;
}

const Clatterhorn = memo(ClatterhornConnected);
export default Clatterhorn;
