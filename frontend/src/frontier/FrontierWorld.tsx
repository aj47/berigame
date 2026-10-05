import { createTerrainGeometry, terrainMaterial } from "../Components/3D/islandTerrainArt";
import { meadowField } from "../../../shared/sim/frontier/regions";
import { linear } from "../Components/3D/nodes/lowPoly";
import { homePoint, isHomeRegion, MEADOW_OFFSET } from "../../../shared/sim/frontier/homeMap";
import MeadowScenery, { ResourceModel } from "./MeadowScenery";
import MeadowTownSquare from "./MeadowTownSquare";
import IslandShrines3D from './IslandShrines3D';
import { approachWorldInteraction } from "./worldInteraction";
import { openSettlement } from "./navigation";
import { plotName } from "./panelModel";
import { resourceHover, resourceTitle } from "./resourcePresentation";
import { meadowTrailDistance } from "./meadowPathArt";
import { holdState, isDirectAttackClick, MOUSE_TAP_RADIUS, TOUCH_TAP_RADIUS, openMenuNear } from "../Components/3D/tapAssist";
import { PlayerState } from "@sim";
import { useUserInputStore } from "../store";
import { previewIssue } from "./preview";
import { BUILDING_SIDES, buildingSideAt } from "../../../shared/sim/frontier/building";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute, Group, Vector3 } from "three";
import { avatarGroup } from "../animation/avatarRegistry";
import { useSettingsStore } from "../spacetime/stores/settingsStore";
import { useFrontier } from "./useFrontier";
import { avatarFrontierState } from './avatarFrontierState';
import { useInventoryRows, useMyPlayer, usePlayers } from "../spacetime/hooks";
import { useGameActions } from "../spacetime/actions";
import {
  PIECES,
  SPECIES,
  FRONTIER,
  type RegionId,
} from "../../../shared/sim/frontier/catalog";
import { regionLand, distance } from "../../../shared/sim/frontier/regions";
import type {
  Building,
  Creature,
  Boat,
  Profile,
} from "../../../shared/sim/frontier/model";
import type { BuildDraft } from "./FrontierPanel";
import type { Command } from "../../../shared/sim/frontier/engine";
import PlayerAvatar from "../Components/3D/PlayerAvatar";
import CameraController from "../Components/3D/CameraController";
import { useAppearanceByHex } from "../Components/3D/RenderOnlineUsers";
import { AvatarOverlay } from "../Components/3D/AvatarOverlay";
import AvatarDecals from "../Components/3D/AvatarDecals";
import AnimationCulling from "../Components/3D/AnimationCulling";
import { AdventureAssetView } from "../Components/3D/AdventureModels";
import { WebGLContextWatch } from "../Components/3D/webgl";
import { FacingArrow, FADING_PIECES, isCentred, PieceMesh, RoofMesh } from "./pieceArt";
import { CREATURE_HEIGHT, CreatureModel, type CreatureMotion } from "./creatureArt";
import { can } from "../../../shared/sim/frontier/model";
import { pieceClickable, pieceHoverAction, pieceUses, type PieceUse } from "./pieceActions";
const Box = ({
  at = [0, 0, 0],
  size = [1, 1, 1],
  color = "#ab875e",
  opacity = 1,
}: {
  at?: [number, number, number];
  size?: [number, number, number];
  color?: string;
  opacity?: number;
}) => (
  <mesh position={at} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial
      color={color}
      transparent={opacity < 1}
      opacity={opacity}
      roughness={0.9}
    />
  </mesh>
);
export function PieceModel({ piece, ghost = false, cutaway = false, edge = false }: { piece: string; ghost?: boolean; cutaway?: boolean; edge?: boolean }) {
  const look = ghost ? "ghost" : cutaway && (piece === "roof" || FADING_PIECES.has(piece)) ? "fade" : "normal";
  return <group position={[0, 0, edge && PIECES[piece]?.edge ? .5 : 0]}><PieceMesh piece={piece} look={look} /></group>;
}
export function Animal({ creature, showLabel, disabled = false, profile }: { creature: Creature; showLabel: boolean; disabled?: boolean; profile?: Profile }) {
  const ref = useRef<Group>(null);
  const motion = useRef<CreatureMotion>({ speed: 0 });
  const def = SPECIES.find((s) => s.id === creature.species);
  const name = def?.name ?? creature.species;
  const oneClickAttack = useSettingsStore(s => s.oneClickAttack);
  const me = useMyPlayer();
  const myId = me?.identity.toHexString() ?? '';
  const { frontier } = useGameActions();
  const setSelected = useUserInputStore((s: any) => s.setClickedOtherObject);
  const hostile = !!def && !def.tameable;
  const mine = !!creature.owner && creature.owner === myId;
  const attackable = hostile && creature.restUntil <= Date.now() && me?.state === PlayerState.Alive;
  const live = useRef({ creature, alive: me?.state === PlayerState.Alive, mounted: true });
  live.current = { creature, alive: me?.state === PlayerState.Alive, mounted: true };
  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, []);
  /** Walk beside the creature first, then send the command. */
  const approach = (command: Command, reach = 1) => {
    setSelected(null);
    approachWorldInteraction(live.current.creature, () => {
      const current = live.current;
      if (!current.mounted || !current.alive) return;
      // A creature defeated or resting by the time you arrive is no longer a target.
      if (command.action === 'attack' && current.creature.restUntil > Date.now()) return;
      void frontier(command);
    }, reach);
  };
  const options = () => {
    const c = live.current.creature, resting = c.restUntil > Date.now();
    if (hostile) return [{ label: resting ? `${name} is resting` : `Attack ${name}`, disabled: resting || !live.current.alive, onClick: () => approach({ action: 'attack', id: c.id }) }];
    if (mine) return [
      { label: `Use ${name}'s ability`, disabled: !c.trained, onClick: () => approach({ action: 'ability' }) },
      ...(!c.trained ? [{ label: `Train ${name} (harness)`, onClick: () => approach({ action: 'train', id: c.id }) }] : []),
    ];
    if (c.owner) return [{ label: `${name} is someone's companion`, disabled: true, onClick: () => {} }];
    const observed = !!profile?.observed.includes(c.species);
    return [
      { label: observed ? `Watch the ${name} again` : `Observe the ${name}`, onClick: () => approach({ action: 'observe', id: c.id }, 4) },
      { label: observed ? `Offer taming feed` : 'Offer feed (observe first)', disabled: !observed, onClick: () => approach({ action: 'tame', id: c.id }) },
    ];
  };
  const onClick = (e: any) => {
    if (disabled || e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    const attackNow = hostile && useSettingsStore.getState().oneClickAttack && live.current.alive
      && live.current.creature.restUntil <= Date.now();
    if (hostile && isDirectAttackClick(e, attackNow)) {
      approach({ action: 'attack', id: live.current.creature.id });
      return;
    }
    // Choose first; the action walks over from wherever the creature is by then.
    setSelected({ connectionId: name, e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() }, dropdownOptions: options() });
  };
  const facing = useRef(0);
  useFrame((_, dt) => {
    const group = ref.current;
    if (!group) return;
    const tx = creature.x - 25, tz = creature.z - 25;
    const dx = tx - group.position.x, dz = tz - group.position.z;
    const step = Math.min(1, dt * 6);
    group.position.x += dx * step;
    group.position.z += dz * step;
    const speed = Math.hypot(dx, dz) * step / Math.max(dt, 1e-3);
    motion.current.speed += (speed - motion.current.speed) * Math.min(1, dt * 8);
    // Face the way it is walking; turn the short way round.
    if (Math.hypot(dx, dz) > .05) facing.current = Math.atan2(dx, dz);
    let turn = facing.current - group.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    group.rotation.y += turn * Math.min(1, dt * 8);
  });
  const tile = homePoint(creature, creature.region);
  const hover = disabled || !def ? null : hostile ? {
    title: name, action: oneClickAttack && attackable ? 'Click to attack' : 'Click for combat options',
    detail: creature.restUntil > Date.now() ? 'Resting' : attackable && oneClickAttack ? 'Hold for combat options' : 'Hostile wildlife',
    click: oneClickAttack && attackable ? 'action' : 'panel', radius: .7, tile,
  } : {
    title: mine ? `${name} · your companion` : name, action: mine ? 'Click for companion options' : creature.owner ? 'A companion' : 'Click to observe or befriend',
    detail: def.utility, click: 'panel', radius: .7, tile,
  };
  return (
    <group ref={ref} position={[creature.x - 25, 0, creature.z - 25]} onClick={onClick} userData={{ hoverTarget: hover }}>
      <CreatureModel species={creature.species} color={def?.color} motion={motion} tamed={!!creature.owner} ownerColor={mine ? '#e4574a' : '#6c8fd6'} />
      {showLabel && <Html style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]} position={[0, (CREATURE_HEIGHT[creature.species] ?? 1) + .5, 0]} center>
        <span className="frontier-label">
          {name}
          {creature.owner ? " ♡" : ""}
        </span>
      </Html>}
    </group>
  );
}
/** Wildlife and companions on Bramblewild itself, drawn in the home scene's own frame. */
export function BramblewildCreatures({ disabled = false }: { disabled?: boolean }) {
  const state = useFrontier(), self = useMyPlayer();
  const showWorldLabels = useSettingsStore(s => s.showWorldLabels);
  if (!self) return null;
  const me = homePoint(self, self.region || 'bramblewild');
  return <>
    {state.creatures
      .filter((c) => c.region === 'bramblewild' && distance(me, c) < 35)
      .map((c) => <Animal key={c.id} creature={c} profile={state.profile} showLabel={showWorldLabels && distance(me, c) < 10} disabled={disabled} />)}
  </>;
}
function Skiff({ boat, showLabel }: { boat: Boat; showLabel: boolean }) {
  return (
    <group position={[boat.x - 25, 0.12, boat.z - 25]}>
      <mesh scale={[1, 1, 1.7]} rotation={[0, Math.PI / 4, 0]}>
        <cylinderGeometry args={[1, 0.7, 0.5, 4]} />
        <meshStandardMaterial color="#98744e" />
      </mesh>
      <Box at={[0, 1.3, 0]} size={[0.1, 2.6, 0.1]} color="#67543b" />
      <mesh position={[0.7, 1.8, 0]}>
        <planeGeometry args={[1.3, 1.7]} />
        <meshStandardMaterial color="#f8edce" side={2} />
      </mesh>
      {showLabel && <Html style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]} position={[0, 3, 0]} center>
        <span className="frontier-label">Skiff · {boat.crew.length}/4</span>
      </Html>}
    </group>
  );
}
export function FrontierScene({
  draft,
  onDraft,
  embedded = false,
}: {
  draft: BuildDraft | null;
  onDraft: (d: BuildDraft | null) => void;
  embedded?: boolean;
}) {
  const state = useFrontier(),
    self = useMyPlayer()!,
    players = usePlayers(),
    actions = useGameActions(),
    appearances = useAppearanceByHex();
  const avatarFrontier = avatarFrontierState(state);
  const inventoryRows = useInventoryRows();
  const hasAxe = inventoryRows.some(slot => slot.itemId === 'axe' && slot.quantity > 0);
  const showWorldLabels = useSettingsStore(s => s.showWorldLabels);
  const { scene, camera, gl } = useThree();
  const [playerRef, setPlayerRef] = useState<any>();
  const region = (embedded ? "settlement" : self.region || "bramblewild") as RegionId;
  const worldMe = homePoint(self, self.region || "bramblewild");
  const me = embedded ? { ...self, x: worldMe.x - MEADOW_OFFSET.x, z: worldMe.z - MEADOW_OFFSET.z } : self;
  const def = state.regions[region];
  const identity = me.identity.toHexString();
  const plotLabelPosition = useMemo<NonNullable<React.ComponentProps<typeof Html>['calculatePosition']>>(() => {
    const marker = new Vector3(), player = new Vector3();
    return (object, camera, size) => {
      object.getWorldPosition(marker).project(camera);
      let x = (marker.x + 1) * size.width / 2;
      const y = (1 - marker.y) * size.height / 2;
      const avatar = avatarGroup(identity);
      if (avatar) {
        avatar.getWorldPosition(player); player.y += 1.2; player.project(camera);
        const px = (player.x + 1) * size.width / 2, py = (1 - player.y) * size.height / 2;
        // Keep the nearest plot action beside the body as the camera or player moves.
        if (Math.abs(x - px) < 135 && Math.abs(y - py) < 110) x = px + (x < px ? -135 : 135);
      }
      return [Math.max(75, Math.min(size.width - 75, x)), y];
    };
  }, [identity]);
  const pieces = state.buildings.filter((b) => b.region === region);
  const terrain = useMemo(() => {
    if(region === 'settlement') return createTerrainGeometry(meadowField, meadowTrailDistance,128,MEADOW_OFFSET,1,false);
    const vertices: number[] = [], colors: number[] = [];
    for (let z = 0; z < 128; z++)
      for (let x = 0; x < 128; x++)
        if (regionLand(region, { x, z })) {
          const a = x - 25.5,
            b = z - 25.5;
          const coast = [[-1,0],[1,0],[0,-1],[0,1],[-2,0],[2,0],[0,-2],[0,2]].some(([dx,dz]) => !regionLand(region,{x:x+dx,z:z+dz}));
          const patch = .5 + .25 * Math.sin((x + MEADOW_OFFSET.x) * .38 + Math.sin((z + MEADOW_OFFSET.z) * .23)) + .25 * Math.sin((z + MEADOW_OFFSET.z) * .51 - (x + MEADOW_OFFSET.x) * .14);
          const tint = linear(0x4b803c).lerp(linear(0x73a44c), patch);
          const road = Math.abs(x - def.spawn.x) < 1 || (x <= 102 && Array.from({length:6}, (_,i) => Math.abs(z - (6+i*19))).some(d => d < 1));
          if (coast) tint.lerp(linear(0xecd099), .85);
          else if (road) tint.lerp(linear(0xc7ad7b), .83);
          for(let i=0;i<6;i++) tint.toArray(colors,colors.length);
          vertices.push(
            a,
            0,
            b,
            a,
            0,
            b + 1,
            a + 1,
            0,
            b + 1,
            a,
            0,
            b,
            a + 1,
            0,
            b + 1,
            a + 1,
            0,
            b,
          );
        }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [region]);
  useEffect(() => () => terrain.dispose(), [terrain]);
  const around = pieces.filter((b) => distance(me, b) <= 35),
    aboard = state.boats.find((b) =>
      b.crew.includes(me.identity.toHexString()),
    );
  // Roofs fade while you are on your plot; walls also fade once you step indoors.
  const myPlot = state.plots.find(p => p.region === region && p.claim && me.x >= p.x && me.z >= p.z
    && me.x < p.x + FRONTIER.sizes[p.claim.tier] && me.z < p.z + FRONTIER.sizes[p.claim.tier]);
  const indoors = myPlot && pieces.some(b => b.claim === myPlot.id && b.x === me.x && b.z === me.z && (b.piece === "roof" || b.piece === "floor")) ? myPlot.id : undefined;
  const roofsByClaim = new Map<string, Building[]>();
  for (const b of around) if (b.piece === "roof") roofsByClaim.set(b.claim, [...roofsByClaim.get(b.claim) ?? [], b]);
  const buildableClaims = new Set(state.plots.filter(p => p.claim && can(p.claim, identity, 1)).map(p => p.id));
  const hasSeed = inventoryRows.some(slot => slot.owner.toHexString() === identity && slot.itemId === "carrot_seed" && slot.quantity > 0);
  const usesFor = (b: Building) => pieceUses(b, { canBuild: buildableClaims.has(b.claim), crop: state.crops.find(c => c.id === b.id), hasSeed, now: Date.now() });
  /** Use actions walk beside the piece first, like resources and creatures. */
  const actOnPiece = (b: Building, use: PieceUse) => {
    useUserInputStore.getState().setClickedOtherObject(null);
    const at = { region: b.region, x: b.x, z: b.z };
    if (use.kind === "storage") approachWorldInteraction(at, () => openSettlement("Storage", b.claim, b.id));
    else if (use.kind === "craft") approachWorldInteraction(at, () => openSettlement("Craft"));
    else if (use.kind === "plant") approachWorldInteraction(at, () => void actions.frontier({ action: "plant", id: b.id }), 1);
    else if (use.kind === "harvest") approachWorldInteraction(at, () => void actions.frontier({ action: "harvest_crop", id: b.id }), 1);
    else approachWorldInteraction(at, () => {}, 1);
  };
  const pieceMenu = (e: any, b: Building) => {
    if (draft || e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    const close = () => useUserInputStore.getState().setClickedOtherObject(null);
    const rotation = (b.rotation + 1) % 4;
    const builder = buildableClaims.has(b.claim) && (self.region || "bramblewild") === region;
    useUserInputStore.getState().setClickedOtherObject({
      connectionId: b.label || PIECES[b.piece]?.name || "Building",
      e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() },
      dropdownOptions: [
        ...usesFor(b).map(use => ({ label: use.label, disabled: "disabled" in use && use.disabled, onClick: () => actOnPiece(b, use) })),
        ...(builder ? [
          { label: PIECES[b.piece]?.edge ? `Turn to ${BUILDING_SIDES[rotation]} side` : `Rotate ↻ · face ${BUILDING_SIDES[rotation]}`, onClick: () => {
            close();
            void actions.frontier({ action: "move_building", id: b.id, x: b.x, z: b.z, rotation });
          } },
          { label: "Move", onClick: () => { close(); onDraft({ plot: b.claim, piece: b.piece, moving: b.id, rotation: b.rotation, point: { x: b.x, z: b.z }, valid: true }); } },
          { label: "Dismantle · 75% materials", onClick: () => { close(); void actions.frontier({ action: "dismantle", id: b.id }); } },
        ] : []),
      ],
    });
  };
  const nearbyPlots = state.plots.filter(p => p.region === region && distance(me, p.marker) < 30);
  const nearestPlot = nearbyPlots.filter(p => distance(me, p.marker) < 9)
    .sort((a, b) => distance(me, a.marker) - distance(me, b.marker))[0];
  const nearbyResources = state.resources.filter(n => n.region === region && distance(me, n) < 35);
  const nearestResource = nearbyResources.filter(n => distance(me, n) < 8)
    .sort((a, b) => distance(me, a) - distance(me, b))[0];
  // Like island berry trees: choose from a live action menu first; the action walks over.
  const approachResource = (n: typeof state.resources[number], e: any) => {
    useUserInputStore.getState().setClickedOtherObject({ connectionId: resourceTitle(n.item), e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() }, resourceId: n.id });
  };
  const click = (e: any) => {
    if (e.delta > 5) return;
    if (e.nativeEvent?.target instanceof Element && e.nativeEvent.target.closest('button')) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    const native = e.nativeEvent as PointerEvent | undefined;
    if (!draft && native && typeof native.clientX === 'number') {
      const radius = native.pointerType === 'mouse' ? MOUSE_TAP_RADIUS : TOUCH_TAP_RADIUS;
      if (openMenuNear(scene, camera, gl.domElement.getBoundingClientRect(), native.clientX, native.clientY, radius, native)) return;
    }
    useUserInputStore.getState().setClickedOtherObject(null);
    const precise = { x: e.point.x + 25 - (embedded ? MEADOW_OFFSET.x : 0), z: e.point.z + 25 - (embedded ? MEADOW_OFFSET.z : 0) };
    const point = { x: Math.round(precise.x), z: Math.round(precise.z) };
    if (draft && self.region === region) {
      const rotation = PIECES[draft.piece]?.edge ? buildingSideAt(precise, point, draft.rotation) : draft.rotation;
      const reason = previewIssue(state, { ...draft, point, rotation }, players);
      onDraft({ ...draft, point, rotation, valid: !reason, reason });
    } else
      void actions.frontier({
        action: embedded ? "walk" : region === "sea" ? "sail" : "move",
        ...(embedded ? { id: "settlement" } : {}),
        ...point,
      });
  };
  return (
    <>
      {!embedded && <>
      <color attach="background" args={["#d9eadf"]} />
      <fog attach="fog" args={["#d9eadf", 32, 76]} />
      <hemisphereLight args={["#fff7de", "#788e7d", .9]} />
      <directionalLight
        position={[20, 35, 10]}
        intensity={1.1}
        color="#ffeaca"
      />
      <mesh
        userData={{ worldSurface: true }}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[38.5, -0.04, 38.5]}
        onClick={click}
        receiveShadow
      >
        <planeGeometry args={[128, 128]} />
        <meshStandardMaterial
          color={region === "sea" ? def.color : "#579ca8"}
          roughness={0.4}
        />
      </mesh>
      </>}
      {region !== "sea" && (
        <mesh name="land_mesh" geometry={terrain} onClick={click} material={terrainMaterial} />
      )}
      {region !== "sea" && (
        <>
          <MeadowScenery region={region} claimed={state.plots.filter(p=>!!p.claim).map(p=>p.id)}/>
          <IslandShrines3D region={region} profile={state.profile} showLabels={showWorldLabels} disabled={!!draft} />
          <MeadowTownSquare x={def.spawn.x - 24} />
          <group position={[def.spawn.x - 25, 0, 39]} userData={{ hoverTarget: { title: 'Steward', action: 'Open quests & workshop', click: 'panel' } }} onClick={e => { if (!draft && e.delta <= 5) { e.stopPropagation(); if (holdState.active || performance.now() < holdState.suppressClickUntil) return; approachWorldInteraction({ region, ...def.spawn }, () => openSettlement()); } }}>
            <AdventureAssetView asset="gardener" />
            {showWorldLabels && distance(me,def.spawn)<10 && <Html style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]} position={[0, 3, 0]} center>
              <span className="frontier-label">Steward</span>
            </Html>}
          </group>
          {region === 'settlement' && distance(me,def.spawn)<18 && <group position={[def.spawn.x - 27, 0, 41]} userData={{ hoverTarget: { title: 'Harbour', action: 'Walk to Bramblewild', click: 'action' } }} onClick={e => { if (!draft && e.delta <= 5) { e.stopPropagation(); if (holdState.active || performance.now() < holdState.suppressClickUntil) return; void actions.frontier({action:'return'}); } }}>
            <PieceModel piece="sign"/>
            {showWorldLabels && distance(me,def.spawn)<10 && <Html style={{ pointerEvents: 'none' }} position={[0,1.5,0]} center zIndexRange={[3,0]}><span className="frontier-label">← Harbour</span></Html>}
          </group>}
          {nearbyPlots
            .map((p) => (
              <group key={p.id} position={[p.x - 25, 0, p.z - 25]}>
                {(p.claim || draft?.plot === p.id) && <mesh
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[
                    (FRONTIER.sizes[p.claim?.tier ?? 0] - 1) / 2,
                    0.005,
                    (FRONTIER.sizes[p.claim?.tier ?? 0] - 1) / 2,
                  ]}
                >
                  <planeGeometry
                    args={[
                      FRONTIER.sizes[p.claim?.tier ?? 0],
                      FRONTIER.sizes[p.claim?.tier ?? 0],
                    ]}
                  />
                  <meshStandardMaterial
                    color={
                      p.claim?.owner === me.identity.toHexString()
                        ? "#c1cd8e"
                        : p.claim
                          ? "#aeb8a1"
                          : "#b1c193"
                    }
                    transparent
                    opacity={draft?.plot === p.id ? 0.4 : 0.12}
                  />
                </mesh>}
                <group position={[-1, 0, 0]} userData={{ hoverTarget: { title: p.claim?.owner === identity ? 'Your home' : plotName(p), action: 'View land', detail: p.claim ? 'Claimed homestead' : `Available to claim · ${FRONTIER.deed + FRONTIER.taxes[0]} coins`, click: 'panel' } }} onClick={e => { if (!draft && e.delta <= 5) { e.stopPropagation(); if (holdState.active || performance.now() < holdState.suppressClickUntil) return; approachWorldInteraction({ region, ...p.marker }, () => openSettlement("Land", p.id)); } }}>
                  <Box at={[0, .5, 0]} size={[.13, 1, .13]} color="#886948" />
                  <Box at={[0, 1, 0]} size={[.68, .46, .12]} color={p.claim ? "#5b7954" : "#c4a779"} />
                  <mesh position={[0, 1.33, 0]} rotation={[0, Math.PI / 4, 0]}>
                    <coneGeometry args={[.51, .25, 4]} />
                    <meshStandardMaterial color="#70815b" roughness={1} />
                  </mesh>
                  <Box at={[0, 1.02, .075]} size={[.16, .18, .025]} color={p.claim ? "#e5d8a6" : "#6d7e52"} />
                </group>
                {p.claim && [[-.4,-.4], [FRONTIER.sizes[p.claim.tier]-.6,-.4], [-.4,FRONTIER.sizes[p.claim.tier]-.6], [FRONTIER.sizes[p.claim.tier]-.6,FRONTIER.sizes[p.claim.tier]-.6]].map(([x,z],i) => <Box key={i} at={[x,.18,z]} size={[.12,.36,.12]} color="#b2a080" />)}
                {showWorldLabels && nearestPlot?.id === p.id && (
                  <Html style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]} position={[-1, 2.1, 0]} calculatePosition={plotLabelPosition} center>
                    <span className="frontier-label">{p.claim?.owner === identity ? "Your home" : `Plot ${p.id.split("-").at(-1)}`}</span>
                  </Html>
                )}
              </group>
            ))}
          {nearbyResources
            .map((n) => (
              <group key={n.id} position={[n.x - 25, 0, n.z - 25]} userData={{ hoverTarget: resourceHover(n, Date.now(), hasAxe) }} onClick={e => { if (!draft && e.delta <= 5) { e.stopPropagation(); if (holdState.active || performance.now() < holdState.suppressClickUntil) return; approachResource(n, e); } }}>
                <ResourceModel item={n.item} resource={n}/>
                {showWorldLabels && !n.harvest && nearestResource?.id === n.id && <Html style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]} position={[0, n.regrowsAt && n.regrowsAt > Date.now() ? 1 : n.item === 'timber' || n.item.startsWith('berry_') ? 3.2 : 1.3, 0]} center>
                  <span className="frontier-label">{n.regrowsAt && n.regrowsAt > Date.now() ? 'Regrowing' : n.item.replace('berry_', '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())}</span>
                </Html>}
              </group>
            ))}
        </>
      )}
      {around.filter(b => b.piece !== "roof").map((b) => {
        const here = (self.region || "bramblewild") === region || (isHomeRegion(self.region || "bramblewild") && isHomeRegion(region));
        const canBuild = buildableClaims.has(b.claim) && (self.region || "bramblewild") === region;
        const uses = here ? usesFor(b) : [];
        const menu = here && pieceClickable(b, { canBuild, indoors: indoors === b.claim, hasUses: uses.length > 0 });
        return (
          <group
            key={b.id}
            position={[b.x - 25, 0, b.z - 25]}
            rotation={[0, (b.rotation * Math.PI) / 2, 0]}
            onClick={menu ? e => pieceMenu(e, b) : undefined}
            userData={menu ? { hoverTarget: { title: b.label || PIECES[b.piece]?.name || "Building", action: pieceHoverAction(uses, canBuild), detail: canBuild ? `Facing ${BUILDING_SIDES[b.rotation]}` : undefined, click: "panel", radius: .6, tile: homePoint(b, b.region) } } : undefined}
          >
            <PieceModel piece={b.piece} edge={b.edge} cutaway={indoors === b.claim} />
          </group>
        );
      })}
      {[...roofsByClaim].map(([claim, tiles]) => (
        <RoofMesh key={claim} tiles={tiles} at={[-25, 0, -25]} look={myPlot?.id === claim ? "fade" : "normal"} />
      ))}
      {draft?.point && draft.piece === "roof" && (
        <RoofMesh
          tiles={[...state.buildings.filter(b => b.piece === "roof" && b.claim === draft.plot && b.id !== draft.moving), draft.point]}
          only={draft.point} look="ghost" at={[-25, .02, -25]}
        />
      )}
      {draft?.point && (
        <group
          position={[draft.point.x - 25, 0.02, draft.point.z - 25]}
          rotation={[0, (draft.rotation * Math.PI) / 2, 0]}
        >
          {draft.piece !== "roof" && <PieceModel piece={draft.piece} edge={!!PIECES[draft.piece]?.edge} ghost />}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              color={draft.valid === false ? "#db5757" : "#83ddb1"}
              transparent
              opacity={0.7}
            />
          </mesh>
          {isCentred(draft.piece) && !["floor", "roof"].includes(draft.piece) && <FacingArrow valid={draft.valid !== false} />}
        </group>
      )}
      {state.crops
        .filter((c) => c.region === region && distance(me, c) < 35)
        .map((c) => (
          <group key={`crop-${c.id}`} position={[c.x - 25, 0.4, c.z - 25]}>
            <Box at={[0, 0.1, 0]} size={[0.08, 0.3, 0.08]} color="#5b8147" />
            <mesh position={[0, 0.3, 0]} scale={[1, 0.5, 1]}>
              <sphereGeometry
                args={[Date.now() >= c.ripeAt ? 0.28 : 0.15, 6, 4]}
              />
              <meshStandardMaterial color="#80ae58" />
            </mesh>
          </group>
        ))}
      {state.drops
        .filter((d) => d.region === region)
        .map((d) => (
          <group key={d.id} position={[d.x - 25, 0.2, d.z - 25]}>
            <Box size={[0.5, 0.4, 0.5]} color="#947551" />
            {showWorldLabels && distance(me,d)<10 && <Html style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]} position={[0, 0.8, 0]} center>
              <span className="frontier-label">Dropped supplies</span>
            </Html>}
          </group>
        ))}
      {state.creatures
        .filter((c) => c.region === region && distance(me, c) < 35)
        .map((c) => (
          <Animal key={c.id} creature={c} profile={state.profile} showLabel={showWorldLabels && distance(me,c)<10} disabled={!!draft} />
        ))}
      {state.boats
        .filter((b) => b.region === region)
        .map((b) => (
          <Skiff key={b.id} boat={b} showLabel={showWorldLabels && distance(me,b)<12} />
        ))}
      {region === "sea" &&
        state.ports.map((p) => (
          <group key={p.region} position={[p.sea.x - 25, 0, p.sea.z - 25]}>
            <mesh position={[0, -0.1, 0]}>
              <cylinderGeometry args={[2, 3, 0.6, 12]} />
              <meshStandardMaterial color="#c8bb8d" />
            </mesh>
            {showWorldLabels && <Html style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]} position={[0, 2, 0]} center>
              <span className="frontier-label">
                Dock · {state.regions[p.region].name}
              </span>
            </Html>}
          </group>
        ))}
      {!embedded && <>
      {players
        .filter((p) => p.online && p.region === region)
        .map((p) => (
          <PlayerAvatar
            key={`${p.identity.toHexString()}:${region}`}
            row={p}
            isSelf={p.identity.toHexString() === me.identity.toHexString()}
            saved={appearances.get(p.identity.toHexString())}
            setPlayerRef={
              p.identity.toHexString() === me.identity.toHexString()
                ? setPlayerRef
                : undefined
            }
            frontier={avatarFrontier}
          />
        ))}
      <AvatarDecals />
      <AvatarOverlay />
      <AnimationCulling />
      <CameraController playerRef={playerRef} />
      </>}
    </>
  );
}
export default function FrontierWorld(props: {
  draft: BuildDraft | null;
  onDraft: (d: BuildDraft | null) => void;
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{
        position: [8, 12, 15] as [number, number, number],
        fov: 42,
        near: 0.1,
        far: 180,
      }}
      gl={{ antialias: true }}
    >
      <WebGLContextWatch />
      <React.Suspense fallback={null}>
        <FrontierScene {...props} />
      </React.Suspense>
    </Canvas>
  );
}
