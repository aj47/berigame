import { memo } from 'react';
import type { ClatterhornRow } from '../bossStore';

export interface ClatterhornModelProps {
  /** The clatterhorn row; nothing is drawn while Closed or missing. */
  row: ClatterhornRow | null;
  /** The world tick the row belongs to (tickClock). */
  tick: number;
  /** Click or menu "Attack Clatterhorn". */
  onAttack: () => void;
}

/**
 * The beetle (FINAL_SPEC 7.2): procedural low-poly model posed from
 * `row.state`, the HP bar, click guards and menu, with ClatterTelegraph and
 * the runner BulletLayer as children. Pure for tests.
 *
 * WP0 stub with the final props (owned by WP8).
 */
export function ClatterhornModel(_props: ClatterhornModelProps): null {
  return null;
}

export type ClatterhornProps = Record<string, never>;

/** Reads `useBossStore(s => s.clatter)`; mounted by RenderOnlineUsers next to the Giant (WP9). */
function ClatterhornConnected(_props: ClatterhornProps): null {
  return null;
}

const Clatterhorn = memo(ClatterhornConnected);
export default Clatterhorn;
