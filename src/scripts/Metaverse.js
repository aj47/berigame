import { useEffect, useMemo, useRef, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "THREE";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { CharacterController } from "./CharacterController.js";
import {
  connectToChatRoom,
  getUserPositions,
  serverGET,
  serverPOST,
  webSocketConnect,
  webSocketSendMessage,
  webSocketSendPosition,
} from "./helpers/Api";
import { auth } from "./helpers/Auth";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import "./style.css";
class Metaverse {
  constructor(props) {
    this.init(props.canvasRef);
  }

  async init(canvasRef) {
    //Connect to backend
    this.renderedUsers = {};
    this.renderedUsersPositions = {};
    this.userId = "guest" + Math.random() * 10;
    // const response = await serverPOST(
    //   "login",
    //   { email: "1", password: "1" },
    //   false
    // );
    // this.apiToken = response.token;
    // auth.setToken(this.apiToken);
    // connectToChatRoom(null);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    window.addEventListener(
      "resize",
      () => {
        this.onWindowResize();
      },
      false
    );

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      100,
      window.innerWidth / window.innerHeight,
      0.1,
      100000
    );
    this.camera.position.set(0, 10, 50);
    this.orbitControls = new OrbitControls(
      this.camera,
      this.renderer.domElement
    );
    this.orbitControls.minDistance = 20;
    this.orbitControls.maxDistance = 34;
    this.orbitControls.enablePan = false;
    this.generateEnvironment();

    // Array of animations mixers
    this.mixers = [];

    this.totalTimeElapsed = 0;
    this.previousRAF = null;
    this.loadPlayer(canvasRef);
    this.animate();
    setInterval(this.renderOtherUsers.bind(this), 1000);
  }

  loadPlayer(canvasRef) {
    const params = {
      canvasRef,
      renderer: this.renderer,
      camera: this.camera,
      scene: this.scene,
      userId: this.userId,
    };
    if (!this.controls) {
      this.controls = {};
    }
    this.controls["player"] = new CharacterController(params);
  }

  animate() {
    requestAnimationFrame((t) => {
      if (this.previousRAF === null) {
        this.previousRAF = t;
      }

      this.animate();
      this.renderer.render(this.scene, this.camera);

      this.step(t - this.previousRAF);

      this.previousRAF = t;
    });
  }

  //Compute tick
  step(timeElapsedMs) {
    const timeElapsedSeconds = timeElapsedMs * 0.001;

    if (this.mixers) {
      this.mixers.map((m) => {
        m.update(timeElapsedSeconds);
      });
    }

    if (this.controls) {
      for (let key in this.controls) {
        this.controls[key].update(timeElapsedSeconds);
      }
    }

    if (this.controls["player"].target) {
      this.orbitControls.target = this.controls["player"].target.position;
      this.orbitControls.update();
    }
  }

  // Update connected users positions
  renderOtherUsers() {
    const allUserPositions = getUserPositions();
    const userKeys = Object.keys(allUserPositions);
    for (const userId of userKeys) {
      if (userId === this.userId) continue;
      if (this.renderedUsers[userId]) {
        //If user is already heading to same position dont move it
        if (
          JSON.stringify(this.renderedUsersPositions[userId]) ===
          JSON.stringify(allUserPositions[userId])
        )
          continue;
        const { x, y, z } = allUserPositions[userId].position;
        const { _x, _y, _z } = allUserPositions[userId].rotation;
        this.renderedUsers[userId].position.set(x, y, z);
        this.renderedUsers[userId].rotation.set(_x, _y, _z);
        this.renderedUsersPositions[userId] = allUserPositions[userId];
      } else {
        this.instantiateUser(allUserPositions[userId], userId);
      }
    }
  }

  async instantiateUser(position, userId) {
    const gltfLoader = new GLTFLoader;
    const gltf = await gltfLoader.loadAsync("/source/bald.glb")
    const target = gltf.scene.children[0];
    this.renderedUsers[userId] = target;
    target.position.set(position.x, position.y, position.z);
    this.scene.add(gltf.scene);
  }

  // Window resizing
  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  generateEnvironment() {
    //Create floor plane
    const geometry = new THREE.PlaneGeometry(10000, 10000, 1, 1);
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
    });
    // material.color.setHSL( 0.095, 1, 0.75 );
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    plane.name = "land_mesh";
    this.scene.add(plane);

    //Create Sky/Background
    // this.scene.background = new THREE.Color(20,0,100).setHSL(0.6, 0, 1);
    // this.scene.fog = new THREE.Fog(this.scene.background, 1, 1000);

    //Lights
    const light = new THREE.AmbientLight(0x404040); // soft white light
    light.position.set(-50, 50, 50);
    this.scene.add(light);
    const sun = new THREE.SpotLight(0xffa95c, 0.5);
    sun.position.set(-50, 50, 50);
    sun.castShadow = true;
    this.scene.add(sun);
  }
}

export default Metaverse;
