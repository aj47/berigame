import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, ENERGY_SEASON_MS, ENERGY_START_MAX } from '../energy';
import {
  AGENT_EVERY_MS, CANDIDATES, HARVEST_MS, HOUR, HUMAN_EVERY_MS, LIVE_RULES, OLD_RULES,
  agent, evaluate, human, liveMeter, modelMeter, newcomer, nonstop, reconnecting, run, sleeper, table,
} from './energyPace';

const old = evaluate(OLD_RULES);
const live = evaluate(LIVE_RULES);

describe('energy at an AI seat\'s pace (energyPace.ts)', () => {
  it('reproduces the beta on the old rules: ~176 harvests an hour, never below ~56%, 1.8x a human', () => {
    // The snapshot seat's meter was 5,748 points: about 0.58 days old.
    const born = -Math.round(((5748 - ENERGY_START_MAX) / (ENERGY_MAX - ENERGY_START_MAX)) * ENERGY_SEASON_MS);
    const day = run(agent('snapshot seat', born), modelMeter(OLD_RULES, born, 0), 1);
    expect(day.harvests / 24).toBeGreaterThan(170);
    expect(day.harvests / 24).toBeLessThan(185);
    expect(day.minFraction).toBeGreaterThan(0.53);
    expect(day.minFraction).toBeLessThan(0.6);
    expect(day.tiredCount).toBe(0);
    expect(old.agentVsHuman).toBeGreaterThan(1.7);
    expect(old.agentVsHuman).toBeLessThan(1.9);
  });

  it('the model, given the live constants, pays exactly what energy.ts pays', () => {
    const profiles = [human('human', HUMAN_EVERY_MS), human('keen', AGENT_EVERY_MS), agent(), reconnecting(), sleeper(), nonstop(), newcomer(AGENT_EVERY_MS)];
    for (const p of profiles) expect(run(p, modelMeter(LIVE_RULES, p.born, 0), 3), p.name).toEqual(run(p, liveMeter(p.born, 0), 3));
  });

  it('a 24/7 seat earns at most half a human\'s value per online hour once its meter runs down, within 10 hours', () => {
    expect(live.agentVsHuman).toBeLessThanOrEqual(0.5);
    expect(live.agentTiredAfterH).toBeLessThan(10);
  });

  it('humans in 2-hour sessions keep every unit, at the measured pace and at a seat\'s pace', () => {
    expect(live.humanPerH).toBe(old.humanPerH);
    expect(live.keenHumanPerH).toBe(old.keenHumanPerH);
    const days = 7, keen = human('keen', AGENT_EVERY_MS);
    expect(run(keen, liveMeter(keen.born, 0), days).tiredCount).toBe(0);
  });

  it('a newcomer\'s first 2-hour session is never tired, and a first login lasts hours', () => {
    expect(live.newcomerMinFraction).toBeGreaterThan(0.3);
    expect(live.newcomerTiredAfterH).toBeGreaterThan(4);
    expect(live.newcomerHumanTiredAfterH).toBeGreaterThan(24);
  });

  it('a literal nonstop gatherer keeps a quarter of its nonstop rate', () => {
    expect(live.nonstopPerH).toBeLessThanOrEqual((HOUR / HARVEST_MS) / 4);
  });

  it('of the candidates, only refilling while logged out meets the target, survives reconnects and costs humans nothing', () => {
    const rows = CANDIDATES.map((c) => evaluate(c));
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ENERGY_PACE_TABLE) console.log(table([old, ...rows]));
    const fits = rows.filter((r) => r.agentVsHuman <= 0.5 && r.reconnectingVsHuman <= 0.5
      && r.humanPerH === old.humanPerH && r.keenHumanPerH === old.keenHumanPerH && r.newcomerTiredAfterH > 4);
    expect(fits.map((r) => r.rules)).toEqual(['C: refill only logged out']);
    expect(live).toEqual({ ...rows[2], rules: 'live' });
  });
});
