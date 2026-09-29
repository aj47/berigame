import React from "react";
import { useProgressStore } from "../spacetime/stores/progressStore";

/** Level-up / keepsake popup: a short banner under the goal chip (plays a fanfare via FxLayer). */
const MilestoneBanner = () => {
  const banner = useProgressStore((s) => s.banner);
  if (!banner) return null;
  return (
    <div key={banner.seq} className={`milestone-banner ${banner.kind}`} role="status" aria-live="polite">
      <span className="milestone-star" aria-hidden="true">{banner.kind === "level" ? "★" : "✿"}</span>
      <div>
        <strong>{banner.title}</strong>
        <span>{banner.detail}</span>
      </div>
    </div>
  );
};
export default MilestoneBanner;
