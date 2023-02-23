import { useFrame } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { CameraControls } from "@react-three/drei";

const CameraController = (props) => {
	const ref = useRef<CameraControls | null>(null);
	useEffect(() => {
		if (ref.current) {
			ref.current.setFocalOffset(0, -2, 4);
			ref.current.maxPolarAngle = Math.PI/2 - 0.1; 
			ref.current.minDistance = 0;
			ref.current.maxDistance = 8;
			ref.current.dolly(4);
			ref.current.zoomTo(0.40);
		}
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
