import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { CameraControls } from "@react-three/drei";
import { useAppearancePreview } from '../../appearance/store';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { HOLD_EVENT } from './HoldToWalk';
import { configureWorldCameraInput, guardWorldCameraClicks } from './cameraInput';

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

const CameraController = (props: { playerRef?: any; focus?: CameraFocus }) => {
	const ref = useRef<CameraControls | null>(null);
	const { size, gl, events } = useThree();
	const focus = props.focus;
	const focusKey = focus ? `${focus.target[0]},${focus.target[1]},${focus.distance},${focus.min},${focus.max}` : '';
	const editing = useAppearancePreview((s) => s.draft !== null);
	const beforePreviewDistance = useRef<number | null>(null);
	useEffect(() => {
		if (ref.current) {
			ref.current.setFocalOffset(0, 0.5, 0);
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
			ref.current.setFocalOffset(0, 0.5, 0, true);
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

	const focusRef = useRef(focus);
	focusRef.current = focus;
	useFrame(() => {
		const f = focusRef.current;
		if (f) {
			ref.current?.moveTo(f.target[0], 0, f.target[1], true);
			return;
		}
		if (props.playerRef?.current?.position) {
			const { x, y, z } = props.playerRef?.current?.position;
			ref.current?.moveTo(x, y, z, true);
		}
	});

	return <CameraControls ref={ref}/>;
};

export default CameraController;
