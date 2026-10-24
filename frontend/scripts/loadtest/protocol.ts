/** Messages between the load-test orchestrator (run.ts) and its worker processes (worker.ts). */

export type SubscribeMode = 'full' | 'interest';

export interface WorkerConfig {
  worker: number;
  uri: string;
  db: string;
  mode: SubscribeMode;
  /** Global bot indexes this worker runs, with a saved token if there is one. */
  bots: Array<{ index: number; token?: string }>;
  batch: number;
  batchMs: number;
  connectTimeoutMs: number;
  /** Mean ms between two decisions of one bot (uniform in 0.5x..1.5x). */
  thinkMs: number;
  /** Owner token for scattering new characters out of the Grove with SQL; empty disables it. */
  ownerToken: string;
  /** Wire compression the clients ask for (the browser uses gzip). */
  compression: 'gzip' | 'none';
  /** Interest mode: the player block as `<chunk>x<radius>` (default shared/sim/interest.ts PLAYER_BLOCK). */
  playerBlock?: string;
  /**
   * Interest mode, cell trees: `sdk` (default) decodes everything like a browser; `sink` subscribes each bot's cells
   * on a second connection whose updates are counted, not decoded (worker.ts), so one machine can drive thousands
   * of clients at the full tick rate.
   */
  view?: 'sdk' | 'sink';
  /** Clients in the whole run (all workers). */
  totalBots?: number;
}

export interface BotConnected { type: 'connected'; index: number; ok: boolean; error?: string; token?: string; ms: number }
export interface WorkerReady { type: 'ready'; worker: number }

export interface WorkerResult {
  type: 'result';
  worker: number;
  measuredMs: number;
  /** Per connected client over the measure window. */
  clients: Array<{ index: number; wireIn: number; rawIn: number; msgsIn: number; wireOut: number; msgsOut: number; alive: boolean }>;
  /** arrival - tickStartedAt for every world update every client saw, in ms. */
  tickLagMs: number[];
  /** Wall-clock arrival (ms) of each tickLagMs sample, same order. */
  tickLagAt: number[];
  /** One observer client per worker: [tick, tickStartedAtMs, arrivalMs]. */
  ticks: Array<[number, number, number]>;
  /** Reducer round trip (call -> result), ms, by reducer, for successes. */
  rttMs: Record<string, number[]>;
  /** Reducer outcomes: `${reducer}: ${error}` -> count, `${reducer}: ok` -> count. */
  outcomes: Record<string, number>;
  /** setTarget call -> first own position change seen, ms. */
  moveEffectMs: number[];
  /** Disconnects during the measure window. */
  drops: number;
  /** Interest-mode resubscriptions during the window. */
  resubscribes: number;
  /** Row callbacks per table (`player.update`, `player_pos.insert`, ...) seen by this worker's observer client. */
  rowEvents?: Record<string, number>;
  /** Worker process CPU over the window (user+system ms). */
  cpuMs: number;
  /** Event-loop delay p95 in ms (load generator saturation). */
  loopDelayP95Ms: number;
}

export type FromWorker = BotConnected | WorkerReady | WorkerResult;
export type ToWorker = { type: 'measure' } | { type: 'stop' };
