import TWEEN from "@tweenjs/tween.js";
import * as THREE from "THREE";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { CharacterControllerInput } from "./CharacterControllerInput";
import { webSocketSendPosition } from "./helpers/Api";

class CharacterController {
  constructor(params) {
    this.init(params);
  }

  init(params) {
    this.params = params;

    this.deceleration = new THREE.Vector3(-0.0005, -0.0001, -5.0);
    this.acceleration = new THREE.Vector3(1.5, 0.25, 50.0);
    this.velocity = new THREE.Vector3(0, 0, 0);

    this.animations = {};

    this.input = new CharacterControllerInput();

    // To debounce clicking movment
    this.justClicked = false;

    this.walkingToClick = false;

    this.loadPlayer();

    //Start broadcasting position
    setInterval(this.broadcastPosition.bind(this), 2000);
  }

  broadcastPosition() {
    if (this.target) {
      const positionData = {
        userId: this.params.userId,
        position: this.target.position,
        rotation: this.target.rotation,
      };
      webSocketSendPosition(JSON.stringify(positionData));
    }
  }

  loadPlayer() {
    const fbxLoader = new FBXLoader();
    // https://sketchfab.com/3d-models/low-poly-woman-752778128b9a4b578586dbce40c0366f
    const rootPath = "../public/";
    fbxLoader.setPath(rootPath + "source/");
    fbxLoader.load("woman.fbx", (fbx) => {
      fbx.scale.setScalar(0.01);
      fbx.traverse((c) => {
        c.castShadow = true;
        c.receiveShadow = true;
      });
      this.target = fbx;

      this.params.scene.add(this.target);
      this.target.position.set(0, 0, 0);
      this.target.rotateY(9.95);

      // Animations
      this.mixer = new THREE.AnimationMixer(this.target);
      const loadAnimation = (animationName, index) => {
        const clip = fbx.animations[index];
        const action = this.mixer.clipAction(clip);

        this.animations[animationName] = {
          clip,
          action,
        };
      };
      loadAnimation("idle", 3);
      loadAnimation("walk", 4);
      loadAnimation("run", 4);
      this.animations["idle"].action.play();
    });
  }

  onClick() {
    //Avoid click spamming
    if (this.justClicked) return;
    this.justClicked = true;
    setTimeout(() => {
      this.justClicked = false;
    }, 250);

    //Get mouse click position
    const clickPosition = {
      x:
        (this.input.keys.clicked.x * 2) /
          this.params.renderer.domElement.clientWidth -
        1,
      y:
        (this.input.keys.clicked.y * -2) /
          this.params.renderer.domElement.clientHeight +
        1,
    };

    //Throw a 3d raycast vector from camera to clicked position
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(clickPosition, this.params.camera);
    // this.params.scene.add(new THREE.ArrowHelper(raycaster.ray.direction, raycaster.ray.origin, 300, 0xff0000) );

    //Sending the whole scene children into intersectObjects can be expensive
    //Maybe limit to land mesh in future
    // if (this.params.scene.children[0].type === "Mesh")
    const intersects = raycaster.intersectObjects(
      this.params.scene.children,
      false
    );
    let clickPointOnLand = null;
    for (const intersect of intersects) {
      switch (intersect.object.name) {
        case "land_mesh":
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(2, 32, 16),
            new THREE.MeshBasicMaterial({ color: 0xffff00 })
          );
          const { x, y, z } = intersect.point;
          sphere.position.set(x, y, z);
          this.params.scene.add(sphere);
          clickPointOnLand = intersect.point;
          break;
      }
    }

    if (!clickPointOnLand) return;
    this.animations["walk"].action.paused = false;

    this.walkingToClick = true;
    this.target.lookAt(clickPointOnLand);
    new TWEEN.Tween(this.target.position)
      .to(
        clickPointOnLand,
        this.target.position.distanceTo(clickPointOnLand) * 100
      )
      .onComplete(() => {
        this.walkingToClick = false;
      })
      .start();
    this.input.keys.clicked = false;
  }

  update(timeInSeconds) {
    if (!this.target) {
      return;
    }

    // frame deceleration
    let velocity = this.velocity;
    const frameDeceleration = new THREE.Vector3(
      velocity.x * this.deceleration.x,
      velocity.y * this.deceleration.y,
      velocity.z * this.deceleration.z
    );
    frameDeceleration.multiplyScalar(timeInSeconds);
    frameDeceleration.z =
      Math.sign(frameDeceleration.z) *
      Math.min(Math.abs(frameDeceleration.z), Math.abs(velocity.z));
    velocity.add(frameDeceleration);

    const controlObject = this.target;
    const Q = new THREE.Quaternion();
    const A = new THREE.Vector3();
    const R = controlObject.quaternion.clone();

    // sprint?
    const acc = this.acceleration.clone();
    if (this.input.keys.shift) {
      acc.multiplyScalar(2.0);
    }

    // walk
    if (this.input.keys.clicked) {
      this.onClick();
    }
    if (this.walkingToClick) this.animations["walk"].action.play();
    else this.animations["walk"].action.paused = true;

    if (this.input.keys.backward) {
      velocity.z -= acc.z * timeInSeconds;
    }

    if (this.mixer) {
      this.mixer.update(timeInSeconds);
    }
    TWEEN.update();
  }
}

export { CharacterController };
