import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Goal } from "@sim";

/** How long a first-time tip stays up unless tapped away. */
export const TIP_MS = 7000;
export const CELEBRATION_MS = 5200;

export interface TipSpec {
  text: string;
  /** CSS selectors to point at, first visible one wins. */
  targets: string[];
}

/** What each goal step's first-time tip says and which HUD element it points at. */
export function tipFor(goal: Goal): TipSpec {
  const slot = goal.action && "slot" in goal.action ? goal.action.slot : -1;
  const slotTarget = slot >= 0 ? [`.hotbar-slot[data-slot="${slot}"]`] : [];
  switch (goal.id) {
    case "pick-berry":
      return { text: "Tap your goal to walk to a berry tree and pick it", targets: [".goal-chip"] };
    case "eat-berry":
      return { text: "Tap the berry in your quick bar to eat it and heal", targets: [...slotTarget, ".goal-chip"] };
    case "find-stick":
      return { text: "Keep picking: about 1 harvest in 4 turns up a sturdy stick", targets: [".goal-chip"] };
    case "wield-stick":
      return { text: "Tap your stick to wield it: it hits twice as hard", targets: [...slotTarget, ".goal-chip"] };
    case "reach-coast":
      return { text: "The dark ring on your map is the bramble hedge. Push through to the Coast", targets: [".minimap", ".goal-chip"] };
    case "gather-coast":
      return { text: "Driftwood and tide rocks are the squares near the map's edge", targets: [".minimap", ".goal-chip"] };
    case "make-club":
      return { text: "You have everything: tap to make a stone club", targets: [".goal-chip"] };
    case "wield-club":
      return { text: "Tap your stone club to wield it", targets: [...slotTarget, ".goal-chip"] };
    case "reach-boulders":
      return { text: "The grey L past the Coast's south-east corner is the Boulders. Your club gets you over", targets: [".minimap", ".goal-chip"] };
    case "face-giant":
      return { text: "Hit the Giant together. When a red square appears under you, step out of it", targets: [".goal-chip"] };
    case "gather-obsidian":
      return { text: "Obsidian outcrops are the dark squares at the Boulders' far ends", targets: [".minimap", ".goal-chip"] };
    default:
      return { text: goal.hint, targets: [".goal-chip"] };
  }
}

function findTarget(targets: string[]): DOMRect | null {
  for (const sel of targets) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return r;
  }
  return null;
}

/** A short pulse ring and pointer bubble on the HUD element a new step is about. */
export const OnboardingTip = ({ goal, onDone }: { goal: Goal; onDone: () => void }) => {
  const spec = useMemo(() => tipFor(goal), [goal.id]);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const place = () => setRect(findTarget(spec.targets));
    place();
    const timer = window.setInterval(place, 400);
    window.addEventListener("resize", place);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", place);
    };
  }, [spec]);
  useEffect(() => {
    const timer = window.setTimeout(onDone, TIP_MS);
    const dismiss = () => onDone();
    window.addEventListener("pointerdown", dismiss);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [onDone]);
  if (!rect) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const below = rect.top + rect.height / 2 < vh / 2;
  const cx = rect.left + rect.width / 2;
  const width = Math.min(240, vw - 24);
  const left = Math.max(12, Math.min(cx - width / 2, vw - width - 12));
  const arrowX = Math.max(14, Math.min(cx - left, width - 14));
  const bubble: React.CSSProperties = below
    ? { left, top: rect.bottom + 14, width }
    : { left, bottom: vh - rect.top + 14, width };
  return (
    <div className="onboarding-tip-layer" aria-hidden="false">
      <div
        className="onboarding-pulse"
        style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div
        className={`onboarding-tip ${below ? "below" : "above"}`}
        style={{ ...bubble, ["--arrow-x" as string]: `${arrowX}px` }}
        role="status"
      >
        <span className="onboarding-tip-new">New</span> {spec.text}
      </div>
    </div>
  );
};

const COLORS = ["#f4cb63", "#e0573f", "#4f9a6d", "#4F46E5", "#f7f1e3", "#EF4444", "#22C55E"];

/** First Day complete: a CSS confetti burst and a short banner. */
export const Celebration = ({ onDone }: { onDone: () => void }) => {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        color: COLORS[i % COLORS.length],
        dx: Math.round(Math.cos((i / 36) * Math.PI * 2) * (120 + ((i * 37) % 110))),
        dy: Math.round(Math.sin((i / 36) * Math.PI * 2) * (90 + ((i * 53) % 90)) - 60),
        rot: (i * 97) % 720,
        delay: (i % 6) * 30,
      })),
    [],
  );
  useEffect(() => {
    const timer = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return (
    <div className="celebration" role="status" aria-live="polite">
      <div className="confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <i
            key={i}
            style={{
              background: p.color,
              ["--dx" as string]: `${p.dx}px`,
              ["--dy" as string]: `${p.dy}px`,
              ["--rot" as string]: `${p.rot}deg`,
              animationDelay: `${p.delay}ms`,
            }}
          />
        ))}
      </div>
      <div className="celebration-banner">
        <span className="eyebrow">First Day complete</span>
        <strong>You made it to the Coast!</strong>
        <small>Next: gather driftwood and flint for a stone club</small>
      </div>
    </div>
  );
};
