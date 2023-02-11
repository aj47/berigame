import { useFrame } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { CameraControls } from "@react-three/drei";

const CameraController = (props) => {
	const ref = useRef<CameraControls | null>(null);
	useEffect(() => {
		ref.current?.setFocalOffset(0, -2, 4);
	}, []);

	useFrame(() => {
		if (props.playerRef?.current?.position) {
			const { x, y, z } = props.playerRef?.current?.position;
			ref.current?.moveTo(x, y, z, true);
		}
	});

	return <CameraControls ref={ref} minDistance={10} />;
};

export default CameraController;
