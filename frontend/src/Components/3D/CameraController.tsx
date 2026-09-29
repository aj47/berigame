import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { CameraControls } from "@react-three/drei";
import { useAppearancePreview } from '../../appearance/store';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { HOLD_EVENT } from './HoldToWalk';

const CameraController = (props) => {
	const ref = useRef<CameraControls | null>(null);
	const { size } = useThree();
	const editing = useAppearancePreview((s) => s.draft !== null);
	const beforePreviewDistance = useRef<number | null>(null);
	useEffect(() => {
		if (ref.current) {
			ref.current.setFocalOffset(0, 0.5, 0);
			ref.current.minPolarAngle = Math.PI / 7;
			ref.current.maxPolarAngle = Math.PI / 2.6;
			ref.current.minDistance = 9;
			ref.current.maxDistance = 32;
		}
	}, []);
	useEffect(() => {
		// Preserve readable body size in short landscape viewports; widen portrait discovery.
		const distance = size.height < 500 ? 13 : size.width / size.height < 0.8 ? 23 : 18;
		if (beforePreviewDistance.current !== null) beforePreviewDistance.current = distance;
		ref.current?.dollyTo(distance, true);
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
		const reset = () => { ref.current?.rotateTo(0.45, 0.78, true); ref.current?.dollyTo(size.height < 500 ? 13 : size.width / size.height < 0.8 ? 23 : 18, true); };
		window.addEventListener('berigame-camera-reset', reset);
		return () => window.removeEventListener('berigame-camera-reset', reset);
	}, [size.width, size.height]);

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
	// Hold-to-walk owns the finger while it lasts: pause camera dragging.
	useEffect(() => {
		const onHold = (e: Event) => { if (ref.current) ref.current.enabled = !(e as CustomEvent).detail; };
		window.addEventListener(HOLD_EVENT, onHold);
		return () => window.removeEventListener(HOLD_EVENT, onHold);
	}, []);

	useFrame(() => {
		if (props.playerRef?.current?.position) {
			const { x, y, z } = props.playerRef?.current?.position;
			ref.current?.moveTo(x, y, z, true);
		}
	});

	return <CameraControls ref={ref}/>;
};

export default CameraController;
