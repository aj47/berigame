import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { CameraControls } from "@react-three/drei";
import { useAppearancePreview } from '../../appearance/store';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { HOLD_EVENT } from './HoldToWalk';
import { configureWorldCameraInput, guardWorldCameraClicks } from './cameraInput';
import { tileToWorld } from '@sim';
import { useBossStore } from '../../bosses/bossStore';
import { useClatterFxStore } from '../../bosses/clatterhorn/clatterFx';

/** A fixed point the camera frames instead of following your avatar (the Spire's arena). */
export interface CameraFocus {
	/** World x, z of the point to frame. */
	target: [number, number];
	/** Landscape distance; portrait screens use 1.25x so the whole floor still fits. */
	distance: number;
	/** Zoom clamp while focused. */
	min: number;
	max: number;
}

/** The default follow camera's zoom range (restored when a focus ends). */
const FOLLOW_MIN = 9, FOLLOW_MAX = 32;

/** Follow-camera distance for a viewport: closer on short landscape screens, wider on portrait ones. */
export function followDistance(width: number, height: number): number {
	return height < 500 ? 13 : width / height < 0.8 ? 23 : 18;
}

/** Focus distance for a viewport (24 landscape, 30 portrait for the Spire), inside the focus clamp. */
export function focusDistance(focus: CameraFocus, width: number, height: number): number {
	const d = width / height < 0.8 ? focus.distance * 1.25 : focus.distance;
	return Math.max(focus.min, Math.min(focus.max, d));
}

/** A Clatterhorn flip's shake: duration, peak focal-offset swing, and the camera-to-beetle range it fades over. */
export const FLIP_SHAKE_MS = 420;
const FLIP_SHAKE_AMP = 0.3;
const FLIP_SHAKE_NEAR = 10, FLIP_SHAKE_FAR = 26;
/** The follow camera's resting focal offset (camera-local x right, y up). */
const BASE_FOCAL: readonly [number, number] = [0, 0.5];

/**
 * The camera-local [x, y] jolt of a Clatterhorn flip at `now` (performance.now()), or null when still:
 * it starts at `flipAt` (when the flip lands on the avatar timeline), decays over FLIP_SHAKE_MS, is full
 * within 10 tiles of the beetle and gone beyond 26. Reduced motion never shakes.
 */
export function flipShake(now: number, flipAt: number, beetle: { x: number; z: number } | null, target: { x: number; z: number } | null, reduced: boolean): [number, number] | null {
	if (reduced || !beetle || !target) return null;
	const age = now - flipAt;
	if (!(age >= 0 && age < FLIP_SHAKE_MS)) return null;
	const d = Math.hypot(beetle.x - target.x, beetle.z - target.z);
	const reach = d <= FLIP_SHAKE_NEAR ? 1 : d >= FLIP_SHAKE_FAR ? 0 : (FLIP_SHAKE_FAR - d) / (FLIP_SHAKE_FAR - FLIP_SHAKE_NEAR);
	if (reach <= 0) return null;
	const k = FLIP_SHAKE_AMP * reach * (1 - age / FLIP_SHAKE_MS) ** 2, t = age / 1000;
	return [Math.sin(t * 71) * k, Math.sin(t * 53 + 1.3) * k * 0.6];
}

const CameraController = (props: { playerRef?: any; focus?: CameraFocus }) => {
	const ref = useRef<CameraControls | null>(null);
	const { size, gl, events } = useThree();
	const focus = props.focus;
	const focusKey = focus ? `${focus.target[0]},${focus.target[1]},${focus.distance},${focus.min},${focus.max}` : '';
	const editing = useAppearancePreview((s) => s.draft !== null);
	const beforePreviewDistance = useRef<number | null>(null);
	useEffect(() => {
		if (ref.current) {
			ref.current.setFocalOffset(BASE_FOCAL[0], BASE_FOCAL[1], 0);
			ref.current.minPolarAngle = Math.PI / 7;
			ref.current.maxPolarAngle = Math.PI / 2.6;
			ref.current.minDistance = FOLLOW_MIN;
			ref.current.maxDistance = FOLLOW_MAX;
		}
	}, []);
	// Inside the Spire: frame the arena centre with the whole floor in view; rotation stays free.
	// Restores the follow camera's zoom range and distance when the focus ends.
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		if (focus) {
			c.minDistance = focus.min;
			c.maxDistance = focus.max;
			c.moveTo(focus.target[0], 0, focus.target[1], false);
			c.dollyTo(focusDistance(focus, size.width, size.height), true);
			return;
		}
		c.minDistance = FOLLOW_MIN;
		c.maxDistance = FOLLOW_MAX;
		c.dollyTo(followDistance(size.width, size.height), true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focusKey, size.width, size.height]);
	useEffect(() => guardWorldCameraClicks(gl.domElement, events.connected), [gl, events.connected]);
	useEffect(() => {
		// Preserve readable body size in short landscape viewports; widen portrait discovery.
		if (focus) return;
		const distance = followDistance(size.width, size.height);
		if (beforePreviewDistance.current !== null) beforePreviewDistance.current = distance;
		ref.current?.dollyTo(distance, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [size.width, size.height]);
	useEffect(() => {
		if (!ref.current) return;
		const compactLandscape = size.width >= 540 && size.width <= 700 && size.height <= 500 && size.width > size.height;
		const previewPortrait = editing && (size.width <= 600 || compactLandscape);
		if (previewPortrait) {
			if (beforePreviewDistance.current === null) beforePreviewDistance.current = ref.current.distance;
			ref.current.setFocalOffset(compactLandscape ? -4.4 : 0, compactLandscape ? -0.3 : 2.2, 0, true);
			ref.current.dollyTo(compactLandscape ? 13 : 18, true);
		} else if (beforePreviewDistance.current !== null) {
			ref.current.setFocalOffset(BASE_FOCAL[0], BASE_FOCAL[1], 0, true);
			ref.current.dollyTo(beforePreviewDistance.current, true);
			beforePreviewDistance.current = null;
		}
	}, [editing, size.width, size.height]);
	useEffect(() => {
		const reset = () => { ref.current?.rotateTo(0.45, 0.78, true); ref.current?.dollyTo(focus ? focusDistance(focus, size.width, size.height) : followDistance(size.width, size.height), true); };
		window.addEventListener('berigame-camera-reset', reset);
		return () => window.removeEventListener('berigame-camera-reset', reset);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [size.width, size.height, focusKey]);

	// Settings > Camera sensitivity scales drag, rotate and zoom speeds.
	const sensitivity = useSettingsStore((s) => s.cameraSensitivity);
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		c.azimuthRotateSpeed = sensitivity;
		c.polarRotateSpeed = sensitivity;
		c.dollySpeed = sensitivity;
		c.truckSpeed = 2 * sensitivity;
	}, [sensitivity]);
	// Settings > Camera rotate button: right drag (default) or left drag.
	const rotateButton = useSettingsStore((s) => s.cameraRotateButton);
	useEffect(() => {
		if (ref.current) configureWorldCameraInput(ref.current, rotateButton);
	}, [rotateButton]);
	// Hold-to-walk owns the finger while it lasts: pause camera dragging.
	useEffect(() => {
		const onHold = (e: Event) => { if (ref.current) ref.current.enabled = !(e as CustomEvent).detail; };
		window.addEventListener(HOLD_EVENT, onHold);
		return () => window.removeEventListener(HOLD_EVENT, onHold);
	}, []);

	// Clatterhorn flips jolt the follow camera (FINAL_SPEC 7.8: never with reduced motion, never while previewing).
	const reduceMotion = useSettingsStore((s) => s.reduceMotion);
	const reducedRef = useRef(reduceMotion);
	reducedRef.current = reduceMotion;
	const shaking = useRef(false);

	const focusRef = useRef(focus);
	focusRef.current = focus;
	useFrame(() => {
		const f = focusRef.current;
		if (f) {
			ref.current?.moveTo(f.target[0], 0, f.target[1], true);
			return;
		}
		const position = props.playerRef?.current?.position;
		if (position) {
			const { x, y, z } = position;
			ref.current?.moveTo(x, y, z, true);
		}
		const c = ref.current;
		if (!c || beforePreviewDistance.current !== null) return;
		const row = useBossStore.getState().clatter;
		let jolt: [number, number] | null = null;
		if (row) {
			const [bx, , bz] = tileToWorld(row);
			jolt = flipShake(performance.now(), useClatterFxStore.getState().flipAt, { x: bx, z: bz }, position ?? null, reducedRef.current);
		}
		if (jolt) {
			c.setFocalOffset(BASE_FOCAL[0] + jolt[0], BASE_FOCAL[1] + jolt[1], 0, false);
			shaking.current = true;
		} else if (shaking.current) {
			c.setFocalOffset(BASE_FOCAL[0], BASE_FOCAL[1], 0, false);
			shaking.current = false;
		}
	});

	return <CameraControls ref={ref}/>;
};

export default CameraController;
