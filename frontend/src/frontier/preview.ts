import { FRONTIER, PIECES } from "../../../shared/sim/frontier/catalog";
import type { FrontierSnapshot } from "../../../shared/sim/frontier/snapshot";
import type { BuildDraft } from "./FrontierPanel";

/** Immediate visual checks. The reducer also checks permissions, costs and escape routes. */
export function previewIssue(
  state: FrontierSnapshot,
  draft: BuildDraft,
  players: readonly { x: number; z: number; region: string }[],
): string | undefined {
  if (!draft.point) return "Tap the ground to preview placement.";
  const plot = state.plots.find((p) => p.id === draft.plot);
  if (!plot?.claim) return "Choose an owned plot.";
  const { x, z } = draft.point,
    size = FRONTIER.sizes[plot.claim.tier];
  if (x < plot.x || z < plot.z || x >= plot.x + size || z >= plot.z + size)
    return "Outside the buildable area.";
  if (
    state.buildings.some(
      (b) =>
        b.id !== draft.moving &&
        b.region === plot.region &&
        b.x === x &&
        b.z === z &&
        PIECES[b.piece].layer === PIECES[draft.piece].layer,
    )
  )
    return "That building layer is occupied.";
  if (
    [...players, ...state.creatures].some(
      (p) => p.region === plot.region && p.x === x && p.z === z,
    )
  )
    return "A character or creature is standing here.";
}
