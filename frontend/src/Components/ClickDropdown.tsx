import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserInputStore } from "../store";
import HarvestDropdownAction from "./HarvestDropdownAction";
import BerryGiantInteraction from "./BerryGiantInteraction";
import PlayerInteraction from "./PlayerInteraction";
import GroundPickupActions from "./GroundPickupActions";
import { useGameActions } from "../spacetime/actions";

const ClickDropdown = () => {
  const { setTarget } = useGameActions();
  const selected = useUserInputStore((state: any) => state.clickedOtherObject);
  const setSelected = useUserInputStore(
    (state: any) => state.setClickedOtherObject,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 80 });
  useLayoutEffect(() => {
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      const x = selected?.e?.clientX ?? window.innerWidth / 2;
      const y = selected?.e?.clientY ?? window.innerHeight / 2;
      setPosition({
        left: Math.max(
          12,
          Math.min(x, window.innerWidth - (rect?.width ?? 220) - 12),
        ),
        top: Math.max(
          12,
          Math.min(y, window.innerHeight - (rect?.height ?? 200) - 12),
        ),
      });
    };
    place();
    // Live interactions can grow after joining, spending bait, or ending an expedition.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", place);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); };
  }, [selected]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setSelected(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [setSelected]);
  if (!selected) return null;
  return (
    <div
      className={`click-dropdown${selected.berryGiantExpeditionId !== undefined ? ' berry-giant-dropdown' : ''}`}
      ref={ref}
      style={position}
      role="group"
      aria-label={selected.playerChoices && !selected.playerHex ? 'Choose player' : `Actions for ${selected.connectionId}`}
    >
      <div className="context-heading">
        <span>{selected.connectionId}</span>
        <button
          className="close-button"
          onClick={() => setSelected(null)}
          aria-label="Close actions"
        >
          ×
        </button>
      </div>
      {selected.playerChoices ? (
        <PlayerInteraction selected={selected} />
      ) : selected.berryGiantExpeditionId !== undefined ? (
        <BerryGiantInteraction key={String(selected.berryGiantExpeditionId)} expeditionId={selected.berryGiantExpeditionId} onClose={() => setSelected(null)} />
      ) : selected.harvestNodeId !== undefined ? (
        <HarvestDropdownAction nodeId={selected.harvestNodeId} onClose={() => setSelected(null)} />
      ) : selected.dropdownOptions?.map((option: any, index: number) => (
        <button
          className="context-action"
          key={index}
          onClick={option.onClick}
          disabled={option.disabled}
        >
          {option.label}
          <span aria-hidden="true">›</span>
        </button>
      ))}
      {selected.groundTiles?.length > 0 && <GroundPickupActions tiles={selected.groundTiles} selectedId={selected.groundItemId} onClose={() => {
        // A slow pickup response must not dismiss a different menu opened meanwhile.
        if (useUserInputStore.getState().clickedOtherObject === selected) setSelected(null);
      }} />}
      {selected.walkTile && <button className="context-action context-walk" onClick={() => {
        const { x, z } = selected.walkTile;
        setSelected(null);
        void setTarget(x, z);
      }}>Walk here<span aria-hidden="true">›</span></button>}
    </div>
  );
};
export default ClickDropdown;
