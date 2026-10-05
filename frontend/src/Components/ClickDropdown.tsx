import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserInputStore } from "../store";
import HarvestDropdownAction from "./HarvestDropdownAction";
import BerryGiantInteraction from "./BerryGiantInteraction";
import PlayerInteraction from "./PlayerInteraction";
import GroundPickupActions from "./GroundPickupActions";
import { useGameActions } from "../spacetime/actions";
import { Plane, Vector3, type Ray } from 'three';
import { homeLocation, isHomeRegion } from '../../../shared/sim/frontier/homeMap';
import { regionLand } from '../../../shared/sim/frontier/regions';
import type { Location, RegionId } from '../../../shared/sim/frontier/catalog';

const ground = new Plane(new Vector3(0, 1, 0), 0);
/** Home scenes share world coordinates; distant islands retain their local grid. */
function walkDestination(selected: { walkTile?: { x: number; z: number }; e?: { ray?: Ray } }, region: RegionId): Location | null {
  const hit = selected.e?.ray?.intersectPlane(ground, new Vector3());
  const point = selected.walkTile ?? (hit ? { x: Math.round(hit.x + 25), z: Math.round(hit.z + 25) } : null);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const destination = isHomeRegion(region) ? homeLocation(point) : { region, ...point };
  return regionLand(destination.region, destination) ? destination : null;
}

const ClickDropdown = ({ region = 'bramblewild' }: { region?: string }) => {
  const { setTarget, frontier } = useGameActions();
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
  const destination = walkDestination(selected, region as RegionId);
  // A clicked pile carries island coordinates, so Meadows can still offer it.
  const islandGround = selected.groundItemId !== undefined ? isHomeRegion(region)
    : region === 'bramblewild' && (!selected.groundRegion || selected.groundRegion === 'bramblewild');
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
        <HarvestDropdownAction nodeId={selected.harvestNodeId} region={region} onClose={() => setSelected(null)} />
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
      {islandGround && selected.groundTiles?.length > 0 && <GroundPickupActions tiles={selected.groundTiles} selectedId={selected.groundItemId} region={region} onClose={() => {
        // A slow pickup response must not dismiss a different menu opened meanwhile.
        if (useUserInputStore.getState().clickedOtherObject === selected) setSelected(null);
      }} />}
      {destination && <button className="context-action context-walk" onClick={() => {
        const { x, z } = destination;
        setSelected(null);
        if (region === 'bramblewild' && destination.region === 'bramblewild') void setTarget(x, z);
        else if (isHomeRegion(region)) void frontier({ action: 'walk', id: destination.region, x, z });
        else void frontier({ action: region === 'sea' ? 'sail' : 'move', x, z });
      }}>Walk here<span aria-hidden="true">›</span></button>}
    </div>
  );
};
export default ClickDropdown;
