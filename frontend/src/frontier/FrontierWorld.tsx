import MeadowScenery, { ResourceModel } from "./MeadowScenery";
import { openSettlement } from "./navigation";
import { previewIssue } from "./preview";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute, Group } from "three";
import { useFrontier } from "./useFrontier";
import { useMyPlayer, usePlayers } from "../spacetime/hooks";
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
} from "../../../shared/sim/frontier/model";
import type { BuildDraft } from "./FrontierPanel";
import PlayerAvatar from "../Components/3D/PlayerAvatar";
import CameraController from "../Components/3D/CameraController";
import { useAppearanceByHex } from "../Components/3D/RenderOnlineUsers";
import { AvatarOverlay } from "../Components/3D/AvatarOverlay";
import AvatarDecals from "../Components/3D/AvatarDecals";
import AnimationCulling from "../Components/3D/AnimationCulling";
import { AdventureAssetView } from "../Components/3D/AdventureModels";
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
function PieceModel({
  piece,
  ghost = false,
  cutaway = false,
}: {
  piece: string;
  ghost?: boolean;
  cutaway?: boolean;
}) {
  const opacity = ghost ? 0.5 : 1;
  const box = (
    at: [number, number, number],
    size: [number, number, number],
    color: string,
  ) => <Box at={at} size={size} color={color} opacity={opacity} />;
  if (piece === "floor")
    return box([0, 0.07, 0], [0.98, 0.14, 0.98], "#b38e64");
  if (piece === "roof")
    return (
      <mesh position={[0, 2.1, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.85, 0.8, 4]} />
        <meshStandardMaterial
          color="#b2b77c"
          transparent
          opacity={ghost ? 0.5 : cutaway ? 0.12 : 1}
        />
      </mesh>
    );
  if (["wall", "brick_wall", "window", "door"].includes(piece))
    return (
      <>
        {piece === "window" ? (
          <>
            {box([0, 0.45, 0], [1, 0.9, 0.2], "#c3a37a")}
            {box([0, 1.65, 0], [1, 0.3, 0.2], "#c3a37a")}
            {box([-0.4, 1.15, 0], [0.2, 0.5, 0.2], "#c3a37a")}
            {box([0.4, 1.15, 0], [0.2, 0.5, 0.2], "#c3a37a")}
          </>
        ) : piece === "door" ? (
          <>
            {box([-0.42, 0.9, 0], [0.16, 1.8, 0.2], "#71583e")}
            {box([0.42, 0.9, 0], [0.16, 1.8, 0.2], "#71583e")}
            {box([0, 1.7, 0], [1, 0.2, 0.2], "#71583e")}
          </>
        ) : (
          box(
            [0, 0.9, 0],
            [1, 1.8, 0.2],
            piece === "brick_wall" ? "#bc806c" : "#c3a37a",
          )
        )}
      </>
    );
  if (piece === "fence" || piece === "gate")
    return (
      <>
        {box([-0.4, 0.45, 0], [0.12, 0.9, 0.12], "#97734d")}
        {box([0.4, 0.45, 0], [0.12, 0.9, 0.12], "#97734d")}
        {piece === "fence" && box([0, 0.5, 0], [0.9, 0.15, 0.1], "#ba986b")}
      </>
    );
  if (piece === "planter")
    return (
      <>
        {box([0, 0.15, 0], [0.85, 0.3, 0.85], "#b88b68")}
        {box([0, 0.32, 0], [0.65, 0.04, 0.65], "#584732")}
      </>
    );
  if (piece === "lamp")
    return (
      <>
        {box([0, 0.5, 0], [0.1, 1, 0.1], "#765e45")}
        <mesh position={[0, 1.05, 0]}>
          <sphereGeometry args={[0.2, 8, 6]} />
          <meshStandardMaterial
            color="#ffe9a0"
            emissive="#efb55c"
            emissiveIntensity={0.5}
          />
        </mesh>
      </>
    );
  if (piece === "sign")
    return (
      <>
        {box([0, 0.4, 0], [0.1, 0.8, 0.1], "#98724f")}
        {box([0, 0.85, 0], [0.8, 0.4, 0.12], "#d7ba85")}
      </>
    );
  if (piece === "kiln")
    return (
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.3, 0.48, 1, 8]} />
        <meshStandardMaterial color="#b89479" />
      </mesh>
    );
  if (piece === "stable")
    return (
      <>
        {box([0, 0.5, 0], [0.8, 1, 0.8], "#b2946b")}
        {box([0, 1.1, 0], [1, 0.2, 1], "#859570")}
      </>
    );
  if (piece === "chair")
    return (
      <>
        {box([0, 0.35, 0], [0.6, 0.7, 0.6], "#a17d56")}
        {box([0, 0.8, 0.25], [0.6, 0.4, 0.12], "#a17d56")}
      </>
    );
  return box(
    [0, 0.45, 0],
    [0.85, 0.9, 0.8],
    piece === "chest" ? "#99704b" : piece === "kitchen" ? "#859087" : "#c6a77b",
  );
}
function Animal({ creature }: { creature: Creature }) {
  const ref = useRef<Group>(null);
  const def = SPECIES.find((s) => s.id === creature.species)!;
  useFrame(({ clock }, dt) => {
    if (ref.current) {
      ref.current.position.x +=
        (creature.x - 25 - ref.current.position.x) * Math.min(1, dt * 7);
      ref.current.position.z +=
        (creature.z - 25 - ref.current.position.z) * Math.min(1, dt * 7);
      ref.current.position.y =
        creature.species === "glowmoth"
          ? 1.1 + Math.sin(clock.elapsedTime * 3) * 0.15
          : Math.sin(clock.elapsedTime * 2 + creature.x) * 0.025;
    }
  });
  return (
    <group ref={ref} position={[creature.x - 25, 0, creature.z - 25]}>
      <mesh
        position={[0, 0.42, 0]}
        scale={
          creature.species === "shellback"
            ? [0.8, 0.35, 0.9]
            : [0.45, 0.45, 0.7]
        }
      >
        <icosahedronGeometry args={[0.8, 1]} />
        <meshStandardMaterial color={def.color} />
      </mesh>
      <mesh position={[0, 0.6, 0.48]}>
        <icosahedronGeometry args={[0.27, 1]} />
        <meshStandardMaterial color={def.color} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          {creature.species === "burrowbun" ? (
            <mesh position={[side * 0.14, 1, 0.5]}>
              <capsuleGeometry args={[0.06, 0.4, 2, 5]} />
              <meshStandardMaterial color={def.color} />
            </mesh>
          ) : creature.species === "glowmoth" ? (
            <mesh
              position={[side * 0.55, 0.55, 0]}
              rotation={[0, 0, side * 0.3]}
            >
              <sphereGeometry args={[0.4, 8, 6]} />
              <meshStandardMaterial color="#fff2b9" transparent opacity={0.7} />
            </mesh>
          ) : (
            <Box
              at={[side * 0.25, 0.15, 0.2]}
              size={[0.12, 0.3, 0.16]}
              color={def.color}
            />
          )}
          <mesh position={[side * 0.12, 0.66, 0.69]}>
            <sphereGeometry args={[0.035, 6, 4]} />
            <meshStandardMaterial color="#243a33" />
          </mesh>
        </group>
      ))}
      <Html zIndexRange={[3, 0]} position={[0, 1.6, 0]} center distanceFactor={20}>
        <span className="frontier-label">
          {def.name}
          {creature.owner ? " ♡" : ""}
        </span>
      </Html>
    </group>
  );
}
function Skiff({ boat }: { boat: Boat }) {
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
      <Html zIndexRange={[3, 0]} position={[0, 3, 0]} center distanceFactor={22}>
        <span className="frontier-label">Skiff · {boat.crew.length}/4</span>
      </Html>
    </group>
  );
}
function Scene({
  draft,
  onDraft,
}: {
  draft: BuildDraft | null;
  onDraft: (d: BuildDraft | null) => void;
}) {
  const state = useFrontier(),
    me = useMyPlayer()!,
    players = usePlayers(),
    actions = useGameActions(),
    appearances = useAppearanceByHex();
  const [playerRef, setPlayerRef] = useState<any>();
  const region = (me.region || "bramblewild") as RegionId;
  const def = state.regions[region];
  const pieces = state.buildings.filter((b) => b.region === region);
  const solids = useMemo(
    () =>
      new Set(
        pieces.filter((b) => PIECES[b.piece].solid).map((b) => `${b.x},${b.z}`),
      ),
    [state.buildings, region],
  );
  const terrain = useMemo(() => {
    const vertices: number[] = [];
    for (let z = 0; z < 128; z++)
      for (let x = 0; x < 128; x++)
        if (regionLand(region, { x, z })) {
          const a = x - 25.5,
            b = z - 25.5;
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
    g.computeVertexNormals();
    return g;
  }, [region]);
  useEffect(() => () => terrain.dispose(), [terrain]);
  const around = pieces.filter((b) => distance(me, b) <= 35),
    aboard = state.boats.find((b) =>
      b.crew.includes(me.identity.toHexString()),
    );
  const click = (e: any) => {
    if (e.nativeEvent?.target instanceof Element && e.nativeEvent.target.closest('button')) return;
    e.stopPropagation();
    const point = {
      x: Math.round(e.point.x + 25),
      z: Math.round(e.point.z + 25),
    };
    if (draft) {
      const reason = previewIssue(state, { ...draft, point }, players);
      onDraft({ ...draft, point, valid: !reason, reason });
    } else
      void actions.frontier({
        action: region === "sea" ? "sail" : "move",
        ...point,
      });
  };
  return (
    <>
      <color attach="background" args={["#d9eadf"]} />
      <fog attach="fog" args={["#d9eadf", 32, 76]} />
      <hemisphereLight args={["#fff7de", "#788e7d", .9]} />
      <directionalLight
        position={[20, 35, 10]}
        intensity={1.1}
        color="#ffeaca"
      />
      <mesh
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
      {region !== "sea" && (
        <mesh geometry={terrain} onClick={click}>
          <meshStandardMaterial color={def.color} roughness={1} />
        </mesh>
      )}
      {region !== "sea" && (
        <>
          <MeadowScenery region={region} claimed={state.plots.filter(p=>!!p.claim).map(p=>p.id)}/>
          <Box at={[def.spawn.x - 25, 0.018, 39]} size={[2, 0.02, 114]} color="#cdbb8c" />
          <Box at={[def.spawn.x - 24, 0.025, 39]} size={[7, 0.025, 7]} color="#d8c69a" />
          {Array.from({ length: 6 }, (_, i) => (
            <Box
              key={i}
              at={[30, 0.016, -19 + i * 19]}
              size={[100, 0.02, 1.3]}
              color="#c5bd91"
            />
          ))}
          <group position={[def.spawn.x - 25, 0, 39]} onClick={e => { if (!draft) { e.stopPropagation(); openSettlement(); } }}>
            <AdventureAssetView asset="gardener" />
            <Html zIndexRange={[3, 0]} position={[0, 3, 0]} center>
              <button className="frontier-world-action" onClick={e => { e.stopPropagation(); openSettlement(); }}>Steward · quests & workshop</button>
            </Html>
          </group>
          {region === 'settlement' && <group position={[def.spawn.x - 27, 0, 41]}>
            <PieceModel piece="sign"/>
            <Html position={[0,1.5,0]} center zIndexRange={[3,0]}><button className="frontier-world-action" onClick={e => { e.stopPropagation(); void actions.frontier({action:'return'}); }}>← Trailhead Camp</button></Html>
          </group>}
          {state.plots
            .filter((p) => p.region === region && distance(me, p.marker) < 30)
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
                    opacity={0.55}
                  />
                </mesh>}
                <Box
                  at={[-1, 0.55, 0]}
                  size={[0.16, 1.1, 0.16]}
                  color="#957145"
                />
                {distance(me, p.marker) < 12 && (
                  <Html zIndexRange={[3, 0]} position={[-1, 1.5, 0]} center>
                    <button className="frontier-world-action" onClick={e => { e.stopPropagation(); openSettlement("Land", p.id); }}>{p.claim ? "Homestead" : "Make your home here"} · {p.id.split("-").at(-1)}</button>
                  </Html>
                )}
              </group>
            ))}
          {state.resources
            .filter((n) => n.region === region && distance(me, n) < 35)
            .map((n) => (
              <group key={n.id} position={[n.x - 25, 0, n.z - 25]}>
                <ResourceModel item={n.item}/>
                {distance(me, n) < 18 && <Html zIndexRange={[3, 0]} position={[0, n.item === 'timber' || n.item.startsWith('berry_') ? 3.2 : 1.3, 0]} center>
                  <button className="frontier-world-action" onClick={e => { e.stopPropagation(); void actions.frontier(distance(me,n) <= 2 ? {action:'gather',id:n.id} : {action:'move',x:n.x,z:n.z}); }}>
                    {distance(me,n) <= 2 ? 'Gather' : 'Walk to'} {n.item.replace('berry_', '').replaceAll('_', ' ')}
                  </button>
                </Html>}
              </group>
            ))}
        </>
      )}
      {around.map((b) => (
        <group
          key={b.id}
          position={[b.x - 25, 0, b.z - 25]}
          rotation={[0, (b.rotation * Math.PI) / 2, 0]}
        >
          <PieceModel
            piece={b.piece}
            cutaway={state.plots.some(
              (p) =>
                p.id === b.claim &&
                me.x >= p.x &&
                me.z >= p.z &&
                me.x < p.x + FRONTIER.sizes[p.claim?.tier ?? 0] &&
                me.z < p.z + FRONTIER.sizes[p.claim?.tier ?? 0],
            )}
          />
        </group>
      ))}
      {draft?.point && (
        <group
          position={[draft.point.x - 25, 0.02, draft.point.z - 25]}
          rotation={[0, (draft.rotation * Math.PI) / 2, 0]}
        >
          <PieceModel piece={draft.piece} ghost />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              color={draft.valid === false ? "#db5757" : "#83ddb1"}
              transparent
              opacity={0.7}
            />
          </mesh>
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
            <Html zIndexRange={[3, 0]} position={[0, 0.8, 0]} center>
              <span className="frontier-label">Dropped supplies</span>
            </Html>
          </group>
        ))}
      {state.creatures
        .filter((c) => c.region === region && distance(me, c) < 35)
        .map((c) => (
          <Animal key={c.id} creature={c} />
        ))}
      {state.boats
        .filter((b) => b.region === region)
        .map((b) => (
          <Skiff key={b.id} boat={b} />
        ))}
      {region === "sea" &&
        state.ports.map((p) => (
          <group key={p.region} position={[p.sea.x - 25, 0, p.sea.z - 25]}>
            <mesh position={[0, -0.1, 0]}>
              <cylinderGeometry args={[2, 3, 0.6, 12]} />
              <meshStandardMaterial color="#c8bb8d" />
            </mesh>
            <Html zIndexRange={[3, 0]} position={[0, 2, 0]} center>
              <span className="frontier-label">
                Dock · {state.regions[p.region].name}
              </span>
            </Html>
          </group>
        ))}
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
            frontierBlocked={solids}
          />
        ))}
      <AvatarDecals />
      <AvatarOverlay />
      <AnimationCulling />
      <CameraController playerRef={playerRef} />
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
      <React.Suspense fallback={null}>
        <Scene {...props} />
      </React.Suspense>
    </Canvas>
  );
}
