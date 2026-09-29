import { useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3, type Camera, type Object3D } from 'three';
import { useBeforeRender } from './beforeRender';
import { visibleNameplates, type NameplateBounds } from './nameplateLayout';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';

/**
 * Avatar labels (name, health bar, chat bubble) as plain DOM in one layer over the
 * canvas, positioned by one projection pass per rendered frame. Replaces a drei
 * <Html> (a React root and a useFrame each) per label.
 */
export interface AvatarLabels {
  id: string;
  name: string;
  /** Extra class on the name: 'self' or 'targeted'. */
  tone: string;
  /** Overlap priority: you 3, your target 2, others 1. */
  priority: number;
  /** Health fraction 0..1, or null to hide the bar. */
  health: number | null;
  chat: string | null;
}

/** World heights of each label above the avatar's feet (as the old <Html> anchors). */
const NAME_Y = 2.63, HEALTH_Y = 2.45, CHAT_Y = 3.0;

interface Label { anchor: HTMLDivElement; y: number; layer: number; shown: boolean; x: number; sy: number; z: number; }
interface Entry {
  group: Object3D;
  labels: AvatarLabels;
  name: Label & { span: HTMLSpanElement; width: number; height: number; measured: boolean; visible: boolean };
  health: Label & { fill: HTMLDivElement };
  chat: Label & { bubble: HTMLDivElement };
}

const entries = new Map<string, Entry>();
let layer: HTMLDivElement | null = null;
let nextLayout = 0;

function anchorDiv(): HTMLDivElement {
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;display:none;';
  return div;
}

function create(group: Object3D): Entry {
  const nameAnchor = anchorDiv();
  const nameBox = document.createElement('div');
  nameBox.style.cssText = 'position:absolute;transform:translate3d(-50%,-50%,0);pointer-events:none;';
  const span = document.createElement('span');
  nameBox.appendChild(span);
  nameAnchor.appendChild(nameBox);

  const healthAnchor = anchorDiv();
  const bar = document.createElement('div');
  bar.className = 'health-bar';
  bar.style.cssText = 'position:absolute;transform:translate3d(-50%,-50%,0);';
  const fill = document.createElement('div');
  fill.className = 'fill';
  bar.appendChild(fill);
  healthAnchor.appendChild(bar);

  const chatAnchor = anchorDiv();
  const bubble = document.createElement('div');
  bubble.className = 'player-chat-bubble';
  bubble.style.cssText = 'position:absolute;transform:translate(-50%,-100%);pointer-events:none;';
  chatAnchor.appendChild(bubble);

  const label = (anchor: HTMLDivElement, y: number, layer: number) => ({ anchor, y, layer, shown: false, x: NaN, sy: NaN, z: NaN });
  return {
    group,
    // Matches nothing, so the first apply() writes every field.
    labels: { id: '\0', name: '\0', tone: '\0', priority: -1, health: -1, chat: '\0' },
    name: { ...label(nameAnchor, NAME_Y, 0), span, width: 0, height: 0, measured: false, visible: true, shown: true },
    health: { ...label(healthAnchor, HEALTH_Y, 1), fill },
    chat: { ...label(chatAnchor, CHAT_Y, 2), bubble },
  };
}

/** Names join the layer at once; health bars and chat bubbles the first time they show. */
function mount(entry: Entry) {
  if (layer && entry.name.anchor.parentNode !== layer) layer.appendChild(entry.name.anchor);
}

function apply(entry: Entry, next: AvatarLabels) {
  const prev = entry.labels;
  if (prev.id !== next.id) entry.name.span.dataset.playerName = next.id;
  if (prev.tone !== next.tone) entry.name.span.className = `adventurer-name ${next.tone}`;
  if (prev.name !== next.name) entry.name.span.textContent = next.name;
  if (prev.name !== next.name || prev.tone !== next.tone) { entry.name.measured = false; nextLayout = 0; }
  if (prev.priority !== next.priority) nextLayout = 0;
  if (next.health !== null && prev.health !== next.health) entry.health.fill.style.width = `${next.health * 100}%`;
  if (next.chat && prev.chat !== next.chat) entry.chat.bubble.textContent = next.chat;
  entry.labels = { ...next };
}

/** Show this avatar's labels. `labels` may be a new object every render; only changes touch the DOM. */
export function useAvatarLabels(group: React.RefObject<Object3D>, labels: AvatarLabels): void {
  const entry = useRef<Entry | null>(null);
  useLayoutEffect(() => {
    const object = group.current;
    if (!object) return;
    const created = create(object);
    entry.current = created;
    entries.set(labels.id, created);
    apply(created, labels);
    mount(created);
    nextLayout = 0;
    return () => {
      for (const label of [created.health, created.name, created.chat]) label.anchor.remove();
      if (entries.get(labels.id) === created) entries.delete(labels.id);
      entry.current = null;
    };
  }, [group, labels.id]);
  useLayoutEffect(() => { if (entry.current) apply(entry.current, labels); });
}

const world = new Vector3();
const delta = new Vector3();
const cameraPosition = new Vector3();
const cameraDirection = new Vector3();

/** Place a label; hide it behind the camera. Writes the DOM only when it moved. */
function place(label: Label, group: Object3D, camera: Camera, width: number, height: number, show: boolean) {
  const style = label.anchor.style;
  let distance = 0;
  if (show) {
    const m = group.matrixWorld.elements;
    world.set(m[12], m[13] + label.y, m[14]);
    delta.subVectors(world, cameraPosition);
    // Behind the camera the projection wraps round: hide instead (as drei's <Html> did).
    if (delta.dot(cameraDirection) <= 0) show = false;
    distance = delta.length();
  }
  if (!show) { if (style.display !== 'none') style.display = 'none'; label.shown = false; return; }
  world.project(camera);
  const x = Math.round(((world.x + 1) / 2) * width * 10) / 10, y = Math.round(((1 - world.y) / 2) * height * 10) / 10;
  if (label.anchor.parentNode !== layer) layer!.appendChild(label.anchor);
  if (style.display !== 'block') style.display = 'block';
  if (x !== label.x || y !== label.sy) { style.transform = `translate3d(${x}px,${y}px,0)`; label.x = x; label.sy = y; }
  // As with the old <Html> z ranges: chat bubbles over health bars over names; within each, nearer on top.
  const z = label.layer * 1000 + Math.max(0, Math.min(999, Math.round(999 - distance * 5)));
  if (z !== label.z) { style.zIndex = `${z}`; label.z = z; }
  label.shown = true;
}

/** The label layer and its per-frame placement. Mount once, inside the Canvas. */
export const AvatarOverlay = () => {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(() => {
    const parent = gl.domElement.parentNode as HTMLElement | null;
    if (!parent) return;
    const div = document.createElement('div');
    div.className = 'avatar-labels';
    // Above the canvas (drei <Html> raises the canvas to at most z-index 3), below damage numbers.
    div.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;';
    parent.appendChild(div);
    layer = div;
    // Settings > Show name plates: hide names only (health bars and chat stay).
    const applyNames = (show: boolean) => div.classList.toggle('hide-names', !show);
    applyNames(useSettingsStore.getState().showNameplates);
    const unsubscribe = useSettingsStore.subscribe((s) => applyNames(s.showNameplates));
    for (const entry of entries.values()) mount(entry);
    return () => { unsubscribe(); div.remove(); if (layer === div) layer = null; };
  }, [gl]);
  useBeforeRender((_, camera) => {
    if (!layer) return;
    const { width, height } = sizeRef.current;
    camera.getWorldDirection(cameraDirection);
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    for (const entry of entries.values()) {
      place(entry.name, entry.group, camera, width, height, true);
      place(entry.health, entry.group, camera, width, height, entry.labels.health !== null);
      place(entry.chat, entry.group, camera, width, height, !!entry.labels.chat);
    }
    // Hide overlapping names at 10Hz from the positions just projected; sizes are measured only when a name changes.
    const now = performance.now();
    if (now < nextLayout) return;
    nextLayout = now + 100;
    const boxes: NameplateBounds[] = [];
    for (const entry of entries.values()) {
      const name = entry.name;
      if (!name.shown) continue;
      if (!name.measured) { name.width = name.span.offsetWidth; name.height = name.span.offsetHeight; name.measured = name.width > 0; }
      boxes.push({ id: entry.labels.id, priority: entry.labels.priority, left: name.x - name.width / 2, right: name.x + name.width / 2, top: name.sy - name.height / 2, bottom: name.sy + name.height / 2 });
    }
    const visible = visibleNameplates(boxes);
    for (const entry of entries.values()) {
      const show = visible.has(entry.labels.id);
      if (show !== entry.name.visible) { entry.name.visible = show; entry.name.span.style.visibility = show ? 'visible' : 'hidden'; }
    }
  });
  return null;
};

/** Test hook: the live label entries. */
export const avatarLabelEntries = () => entries;
