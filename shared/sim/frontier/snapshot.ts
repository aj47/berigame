import { HOME_MAP } from "./homeMap";
import { COMMANDS } from "./engine";
import { ISLAND_SHRINES, shrineRestored, shrineXpBonusPercent } from './shrines';
import {
  DISCIPLINES,
  DISCIPLINE_PERKS,
  FRONTIER,
  FRONTIER_RECIPES,
  ORDERS,
  PIECES,
  PLOTS,
  PORTS,
  QUESTS,
  REGIONS,
  RESOURCE_PATCHES,
  SPECIES,
} from "./catalog";
import {
  claimStatus,
  newProfile,
  questProgress,
  type EntityMap,
} from "./model";
export function frontierSnapshot(
  publicRows: Iterable<{ kind: string; data: string }>,
  privateRows: Iterable<{ kind: string; data: string }>,
  identity: string,
  now: number,
) {
  const objects = Array.from(publicRows).map((row) => ({
    kind: row.kind,
    value: JSON.parse(row.data),
  }));
  const privateObjects = Array.from(privateRows).map((row) => ({
    kind: row.kind,
    value: JSON.parse(row.data),
  }));
  const profile: EntityMap["profile"] =
    privateObjects.find((r) => r.kind === "profile" && r.value.id === identity)
      ?.value ?? newProfile(identity);
  const of = <K extends keyof EntityMap>(kind: K) =>
    objects
      .filter((r) => r.kind === kind)
      .map((r) => r.value) as EntityMap[K][];
  const claims = of("claim");
  return {
    commands: COMMANDS,
    homeMap: HOME_MAP,
    enabled: objects.find((r) => r.kind === "config")?.value.enabled ?? false,
    pausedAt: objects.find((r) => r.kind === "config")?.value.pausedAt ?? 0,
    profile,
    shrines: ISLAND_SHRINES.map(shrine => ({ ...shrine, restored: shrineRestored(profile, shrine.id) })),
    shrineXpBonusPercent: shrineXpBonusPercent(profile),
    plots: PLOTS.map((plot) => {
      const c = claims.find((c) => c.id === plot.id);
      return {
        ...plot,
        claim: c ?? null,
        status: c ? claimStatus(c, now) : "available",
      };
    }),
    drops: of("drop"),
    buildings: of("building"),
    creatures: of("creature"),
    boats: of("boat"),
    crops: of("crop"),
    containers: privateObjects
      .filter((r) => r.kind === "container")
      .map((r) => r.value) as EntityMap["container"][],
    quests: questProgress(profile),
    regions: REGIONS,
    ports: PORTS,
    resources: RESOURCE_PATCHES.map(node => ({ ...node, ...of("resource").find(row => row.id === node.id) })),
    recipes: FRONTIER_RECIPES,
    pieces: PIECES,
    species: SPECIES,
    disciplines: DISCIPLINES,
    disciplinePerks: DISCIPLINE_PERKS,
    orders: ORDERS,
    rules: FRONTIER,
  };
}
export type FrontierSnapshot = ReturnType<typeof frontierSnapshot>;
