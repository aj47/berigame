#!/usr/bin/env node
/**
 * Admin-only funnel summary of the private `play_stats` table (docs/ANALYTICS.md).
 *
 *   node scripts/analytics-funnel.mjs [--server <url|nickname>] [--db berigame] [--since-days N] [--json]
 *   node scripts/analytics-funnel.mjs --file dump.json     # summarise a saved `spacetime sql --format json` dump
 *
 * Private tables are only readable by the database owner, so run this with the
 * `spacetime` CLI logged in as the identity that published the module.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const STEPS = ['join', 'berry', 'stick', 'hedge', 'coast', 'craft'];
const MILESTONE_COLUMNS = {
  berry: 'first_berry_at', stick: 'first_stick_at', hedge: 'reached_hedge_at', coast: 'reached_coast_at', craft: 'first_craft_at',
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Decode one SATS-JSON value into micros / numbers / strings / null. */
function decode(v) {
  if (Array.isArray(v)) {
    // Option: [0, value] = some, [1, []] = none.
    if (v.length === 2 && (v[0] === 0 || v[0] === 1) && (Array.isArray(v[1]) || typeof v[1] !== 'object')) {
      if (v[0] === 1 && Array.isArray(v[1]) && v[1].length === 0) return null;
      if (v[0] === 0) return decode(v[1]);
    }
    if (v.length === 1) return decode(v[0]); // identity / timestamp wrappers
  }
  return v;
}

export function rowsFromSqlJson(result) {
  const table = Array.isArray(result) ? result[0] : result;
  const names = table.schema.elements.map((e) => e.name.some ?? e.name);
  return table.rows.map((row) => Object.fromEntries(row.map((v, i) => [names[i], decode(v)])));
}

const pct = (n, d) => (d === 0 ? '-' : `${((100 * n) / d).toFixed(1)}%`);
const minutes = (micros) => Number(micros) / 60e6;
const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(rows, { sinceMicros = 0 } = {}) {
  const players = rows.filter((r) => Number(r.first_join_at) >= sinceMicros);
  const total = players.length;
  const reached = Object.fromEntries(STEPS.map((s) => [s, 0]));
  const timeTo = Object.fromEntries(STEPS.slice(1).map((s) => [s, []]));
  const quitAt = Object.fromEntries(STEPS.map((s) => [s, 0]));
  let deaths = 0, died = 0, sessions = 0;
  const playMinutes = [];
  for (const r of players) {
    reached.join += 1;
    for (const s of STEPS.slice(1)) {
      const at = r[MILESTONE_COLUMNS[s]];
      if (at !== null && at !== undefined) {
        reached[s] += 1;
        timeTo[s].push(minutes(Number(at) - Number(r.first_join_at)));
      }
    }
    quitAt[STEPS.includes(r.last_step) ? r.last_step : 'join'] += 1;
    deaths += Number(r.deaths);
    if (Number(r.deaths) > 0) died += 1;
    sessions += Number(r.sessions);
    playMinutes.push(minutes(r.total_play_micros));
  }
  return {
    players: total,
    funnel: STEPS.map((s, i) => ({
      step: s,
      players: reached[s],
      ofAll: pct(reached[s], total),
      ofPrevious: i === 0 ? '-' : pct(reached[s], reached[STEPS[i - 1]]),
      medianMinutesFromJoin: i === 0 ? 0 : Number(median(timeTo[s]).toFixed(1)),
    })),
    furthestStep: STEPS.map((s) => ({ step: s, players: quitAt[s], share: pct(quitAt[s], total) })),
    deaths: { total: deaths, playersWhoDied: died, perPlayer: total ? Number((deaths / total).toFixed(2)) : 0 },
    sessions: {
      total: sessions,
      perPlayer: total ? Number((sessions / total).toFixed(2)) : 0,
      medianPlayMinutesPerPlayer: Number(median(playMinutes).toFixed(1)),
    },
  };
}

function printText(s) {
  console.log(`Players: ${s.players}\n`);
  console.log('Funnel (reached step)');
  console.table(s.funnel);
  console.log('Furthest step reached (where players stopped)');
  console.table(s.furthestStep);
  console.log(`Deaths: ${s.deaths.total} total, ${s.deaths.playersWhoDied} players died, ${s.deaths.perPlayer} per player`);
  console.log(`Sessions: ${s.sessions.total} total, ${s.sessions.perPlayer} per player, median play time ${s.sessions.medianPlayMinutesPerPlayer} min/player (finished sessions only)`);
}

function main() {
  const file = arg('--file');
  let json;
  if (file) {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    const cli = process.env.SPACETIME_CLI ?? 'spacetime';
    const args = ['sql'];
    const server = arg('--server');
    if (server) args.push('-s', server);
    args.push(arg('--db', 'berigame'), 'SELECT * FROM play_stats', '--format', 'json');
    json = JSON.parse(execFileSync(cli, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  }
  const days = Number(arg('--since-days', '0'));
  const sinceMicros = days > 0 ? (Date.now() - days * 86_400_000) * 1000 : 0;
  const summary = summarize(rowsFromSqlJson(json), { sinceMicros });
  if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else printText(summary);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
