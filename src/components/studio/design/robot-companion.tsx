import { useEffect, useRef } from "react";
import * as THREE from "three";

type RobotState =
  | "IDLE"
  | "WALKING"
  | "RUNNING"
  | "JUMPING"
  | "HIDING"
  | "PEEKING"
  | "CLIMBING"
  | "SITTING"
  | "WAVING"
  | "SLEEPING";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smooth = (current: number, target: number, speed: number, delta: number) =>
  THREE.MathUtils.damp(current, target, speed, delta);

/** A small procedural, jointed 3D companion. The canvas sits below the print
 * sheets, so the real DOM cards occlude its geometry as it moves behind them. */
export function RobotCompanion() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (
      !host ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.studioMotion === "quiet"
    )
      return;

    let active = false;
    let frameTime = 0;
    let scrollImpulse = 0;
    let pointerX = 0;
    let pointerY = 0;
    let visible = true;
    let width = 1;
    let height = 1;
    let viewHeight = 4.2;
    let state: RobotState = "PEEKING";
    let stateTime = 0;
    let phase = 0;
    let cycle = 0;
    let targetX = 0;
    let targetY = 0;
    let stumble = 0;
    let resizeObserver: ResizeObserver | undefined;
    let intersectionObserver: IntersectionObserver | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let scene: THREE.Scene | undefined;
    let camera: THREE.OrthographicCamera | undefined;
    let robot: THREE.Group | undefined;
    let torso: THREE.Group | undefined;
    let head: THREE.Group | undefined;
    let leftLeg: THREE.Group | undefined;
    let rightLeg: THREE.Group | undefined;
    let leftArm: THREE.Group | undefined;
    let rightArm: THREE.Group | undefined;
    let eyeLeft: THREE.Mesh | undefined;
    let eyeRight: THREE.Mesh | undefined;
    let timer: THREE.Timer | undefined;
    let onPointerMove: ((event: PointerEvent) => void) | undefined;
    let onInteract: (() => void) | undefined;
    let onScroll: (() => void) | undefined;
    let onVisibility: (() => void) | undefined;
    let onContextLost: ((event: Event) => void) | undefined;

    const toWorld = (x: number, y: number) => ({
      x: (x / width - 0.5) * viewHeight * (width / height),
      y: (0.5 - y / height) * viewHeight,
    });
    const cardPoint = (selector: string, side: "left" | "right", vertical: number) => {
      const card = host.querySelector<HTMLElement>(selector);
      const bounds = host.getBoundingClientRect();
      const rect = card?.getBoundingClientRect();
      if (!rect) return toWorld(width * (side === "left" ? 0.28 : 0.72), height * 0.72);
      const px = side === "left" ? rect.left - bounds.left : rect.right - bounds.left;
      const py = rect.top - bounds.top + rect.height * vertical;
      return toWorld(px, py);
    };
    const setTarget = (point: { x: number; y: number }) => {
      targetX = clamp(
        point.x,
        -viewHeight * (width / height) * 0.46,
        viewHeight * (width / height) * 0.46,
      );
      targetY = clamp(point.y, -viewHeight * 0.39, viewHeight * 0.35);
    };
    const transition = (next: RobotState) => {
      state = next;
      stateTime = 0;
      if (next === "PEEKING") setTarget(cardPoint(".sheet-front", "left", 0.76));
      if (next === "WALKING") setTarget(toWorld(width * 0.1, height * 0.8));
      if (next === "RUNNING") setTarget(toWorld(width * 0.9, height * 0.84));
      if (next === "JUMPING") setTarget(toWorld(width * 0.54, height * 0.82));
      if (next === "HIDING") setTarget(cardPoint(".sheet-mid", "right", 0.75));
      if (next === "CLIMBING") setTarget(cardPoint(".sheet-mid", "right", 0.08));
      if (next === "SITTING") setTarget(cardPoint(".sheet-front", "left", 0.88));
      if (next === "WAVING") setTarget(cardPoint(".sheet-front", "left", 0.75));
      if (next === "IDLE") setTarget(toWorld(width * 0.28, height * 0.8));
      if (next === "SLEEPING") setTarget(toWorld(width * 0.28, height * 0.8));
    };
    const makeRobot = () => {
      if (!scene) return;
      const ceramic = new THREE.MeshStandardMaterial({
        color: 0xe9efec,
        roughness: 0.3,
        metalness: 0.24,
      });
      const dark = new THREE.MeshStandardMaterial({
        color: 0x26302f,
        roughness: 0.38,
        metalness: 0.72,
      });
      const joint = new THREE.MeshStandardMaterial({
        color: 0x768481,
        roughness: 0.27,
        metalness: 0.86,
      });
      const mint = new THREE.MeshStandardMaterial({
        color: 0xa4efd6,
        emissive: 0x50d9ae,
        emissiveIntensity: 2.1,
        roughness: 0.18,
      });
      const geometries: THREE.BufferGeometry[] = [];
      const mesh = (
        geometry: THREE.BufferGeometry,
        material: THREE.Material,
        parent: THREE.Object3D,
      ) => {
        geometries.push(geometry);
        const item = new THREE.Mesh(geometry, material);
        item.castShadow = true;
        item.receiveShadow = true;
        parent.add(item);
        return item;
      };
      const sphere = (
        parent: THREE.Object3D,
        material: THREE.Material,
        size: [number, number, number],
        position: [number, number, number],
      ) => {
        const item = mesh(new THREE.SphereGeometry(1, 18, 12), material, parent);
        item.scale.set(...size);
        item.position.set(...position);
        return item;
      };
      const cylinder = (
        parent: THREE.Object3D,
        material: THREE.Material,
        radius: number,
        length: number,
        y: number,
      ) => {
        const item = mesh(
          new THREE.CylinderGeometry(radius * 0.84, radius, length, 12),
          material,
          parent,
        );
        item.position.y = y;
        return item;
      };

      robot = new THREE.Group();
      robot.scale.setScalar(0.58);
      scene.add(robot);
      torso = new THREE.Group();
      robot.add(torso);
      const chest = mesh(new THREE.CapsuleGeometry(0.27, 0.42, 4, 12), ceramic, torso);
      chest.position.y = 0.18;
      chest.scale.set(1.18, 1, 0.88);
      const chestPlate = mesh(new THREE.BoxGeometry(0.31, 0.19, 0.09), dark, torso);
      chestPlate.position.set(0, 0.28, 0.25);
      sphere(torso, mint, [0.035, 0.035, 0.025], [0, 0.12, 0.31]);
      sphere(torso, joint, [0.08, 0.08, 0.08], [0, -0.16, 0]);

      head = new THREE.Group();
      head.position.set(0, 0.58, 0.02);
      torso.add(head);
      sphere(head, ceramic, [0.34, 0.3, 0.29], [0, 0.08, 0]);
      const face = mesh(new THREE.BoxGeometry(0.43, 0.22, 0.075), dark, head);
      face.position.set(0, 0.07, 0.255);
      eyeLeft = sphere(head, mint, [0.052, 0.07, 0.036], [-0.105, 0.08, 0.305]);
      eyeRight = sphere(head, mint, [0.052, 0.07, 0.036], [0.105, 0.08, 0.305]);
      const antenna = cylinder(head, joint, 0.035, 0.2, 0.39);
      antenna.position.z = -0.02;
      sphere(head, mint, [0.07, 0.07, 0.07], [0, 0.5, -0.02]);
      sphere(head, dark, [0.09, 0.04, 0.04], [-0.36, 0.08, 0]);
      sphere(head, dark, [0.09, 0.04, 0.04], [0.36, 0.08, 0]);

      const makeLimb = (x: number, arm: boolean) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, arm ? 0.39 : -0.2, 0);
        torso?.add(pivot);
        sphere(pivot, joint, [0.1, 0.1, 0.1], [0, 0, 0]);
        cylinder(pivot, ceramic, arm ? 0.075 : 0.085, arm ? 0.29 : 0.34, arm ? -0.2 : -0.2);
        sphere(pivot, dark, [0.08, 0.08, 0.08], [0, arm ? -0.36 : -0.38, 0]);
        if (arm) {
          sphere(pivot, ceramic, [0.095, 0.09, 0.075], [0, -0.42, 0.03]);
          sphere(pivot, dark, [0.045, 0.045, 0.045], [0, -0.43, 0.105]);
        } else {
          const foot = mesh(new THREE.BoxGeometry(0.2, 0.09, 0.3), dark, pivot);
          foot.position.set(0, -0.44, 0.08);
        }
        return pivot;
      };
      leftArm = makeLimb(-0.34, true);
      rightArm = makeLimb(0.34, true);
      leftLeg = makeLimb(-0.16, false);
      rightLeg = makeLimb(0.16, false);

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 32),
        new THREE.MeshBasicMaterial({
          color: 0x06120f,
          transparent: true,
          opacity: 0.27,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -0.78;
      shadow.scale.set(1, 0.48, 1);
      robot.add(shadow);
      // Geometry/material ownership stays local to this scene and is released on unmount.
      (
        robot.userData as { geometries?: THREE.BufferGeometry[]; materials?: THREE.Material[] }
      ).geometries = geometries;
      (
        robot.userData as { geometries?: THREE.BufferGeometry[]; materials?: THREE.Material[] }
      ).materials = [ceramic, dark, joint, mint, shadow.material];
      scene.add(new THREE.HemisphereLight(0xd8fff1, 0x18201e, 1.35));
      const key = new THREE.DirectionalLight(0xf4fff9, 2.4);
      key.position.set(-3, 5, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(512, 512);
      key.shadow.camera.left = -3;
      key.shadow.camera.right = 3;
      key.shadow.camera.top = 3;
      key.shadow.camera.bottom = -3;
      scene.add(key);
      const rim = new THREE.PointLight(0x7df3cb, 3, 6);
      rim.position.set(1.8, 1.2, 2.2);
      scene.add(rim);
    };

    const durations: Record<RobotState, number> = {
      IDLE: 1.8,
      WALKING: 1.35,
      RUNNING: 1.8,
      JUMPING: 0.9,
      HIDING: 0.8,
      PEEKING: 1.15,
      CLIMBING: 1.4,
      SITTING: 1.3,
      WAVING: 1.35,
      SLEEPING: 2.8,
    };
    const nextState = (): RobotState => {
      if (state === "PEEKING") return "WALKING";
      if (state === "WALKING") return "RUNNING";
      if (state === "RUNNING") return Math.random() < 0.35 ? "JUMPING" : "HIDING";
      if (state === "JUMPING") return "HIDING";
      if (state === "HIDING") return "CLIMBING";
      if (state === "CLIMBING") return "SITTING";
      if (state === "SITTING") return "WAVING";
      if (state === "WAVING") return "IDLE";
      if (state === "IDLE") {
        cycle += 1;
        if (cycle % 3 === 0) return "SLEEPING";
        return Math.random() < 0.45 ? "WALKING" : "PEEKING";
      }
      if (state === "SLEEPING") return "PEEKING";
      return "IDLE";
    };

    try {
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
      camera.position.set(0, 0, 9);
      camera.lookAt(0, 0, 0);
      const mobile = matchMedia("(max-width: 48rem)").matches;
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !mobile,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6));
      renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
      renderer.shadowMap.enabled = !mobile;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.domElement.className = "robot-companion-canvas";
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.prepend(renderer.domElement);
      onContextLost = (event: Event) => {
        event.preventDefault();
        active = false;
        renderer?.setAnimationLoop(null);
        renderer?.domElement.remove();
      };
      renderer.domElement.addEventListener("webglcontextlost", onContextLost);
      makeRobot();
      timer = new THREE.Timer();
      active = true;

      const resize = () => {
        if (!host || !renderer || !camera) return;
        width = Math.max(1, host.clientWidth);
        height = Math.max(1, host.clientHeight);
        viewHeight = width < 420 ? 3.8 : 4.2;
        const viewWidth = viewHeight * (width / height);
        camera.left = -viewWidth / 2;
        camera.right = viewWidth / 2;
        camera.top = viewHeight / 2;
        camera.bottom = -viewHeight / 2;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        if (robot && state === "PEEKING") setTarget(cardPoint(".sheet-front", "left", 0.76));
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();
      transition("PEEKING");
      if (robot) robot.position.set(targetX + 0.32, targetY, 0);
      intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (!visible || document.hidden) renderer?.setAnimationLoop(null);
        else if (active) renderer?.setAnimationLoop(animate);
      });
      intersectionObserver.observe(host);

      onPointerMove = (event: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        pointerX = clamp((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5, -0.5, 0.5);
        pointerY = clamp((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5, -0.5, 0.5);
      };
      onInteract = () => transition("WAVING");
      onScroll = () => {
        scrollImpulse = Math.min(1, scrollImpulse + 0.35);
      };
      onVisibility = () => {
        if (document.hidden || !visible) renderer?.setAnimationLoop(null);
        else if (active) renderer?.setAnimationLoop(animate);
      };
      host.addEventListener("pointermove", onPointerMove, { passive: true });
      host.addEventListener("pointerdown", onInteract, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);

      function animate() {
        if (!active || !renderer || !scene || !camera || !robot || !timer) return;
        timer.update();
        const delta = Math.min(timer.getDelta(), 0.08);
        const mobile = matchMedia("(max-width: 48rem)").matches;
        const frameBudget =
          state === "IDLE" || state === "SLEEPING" ? 1 / 12 : mobile ? 1 / 30 : 1 / 60;
        frameTime += delta;
        if (frameTime < frameBudget) return;
        const step = Math.min(frameTime, 0.08);
        frameTime = 0;
        phase += step;
        stateTime += step;
        scrollImpulse = smooth(scrollImpulse, 0, 3, step);
        if (state === "WALKING" || state === "RUNNING" || state === "CLIMBING") {
          robot.position.x = smooth(
            robot.position.x,
            targetX,
            state === "RUNNING" ? 4.8 : state === "CLIMBING" ? 2.4 : 2.8,
            step,
          );
          robot.position.y = smooth(
            robot.position.y,
            targetY + Math.abs(Math.sin(phase * (state === "CLIMBING" ? 8 : 11))) *
              (state === "CLIMBING" ? 0.035 : 0.07) + scrollImpulse * 0.14,
            5,
            step,
          );
          robot.rotation.y = smooth(
            robot.rotation.y,
            targetX >= robot.position.x ? Math.PI / 2 : -Math.PI / 2,
            4,
            step,
          );
        } else if (state === "JUMPING") {
          const jumpProgress = clamp(stateTime / durations.JUMPING, 0, 1);
          robot.position.x = smooth(robot.position.x, targetX, 3.8, step);
          robot.position.y = targetY + Math.sin(jumpProgress * Math.PI) * 0.72;
          robot.rotation.z = smooth(robot.rotation.z, Math.sin(jumpProgress * Math.PI) * 0.16, 4, step);
        } else if (state === "SITTING") {
          robot.position.x = smooth(robot.position.x, targetX, 4, step);
          robot.position.y = smooth(robot.position.y, targetY, 4, step);
          robot.rotation.z = smooth(robot.rotation.z, 0, 4, step);
        } else if (state === "SLEEPING") {
          robot.position.x = smooth(robot.position.x, targetX, 2, step);
          robot.position.y = smooth(robot.position.y, targetY - 0.22, 3, step);
          robot.rotation.z = smooth(robot.rotation.z, -0.4, 2.5, step);
        } else {
          robot.position.x = smooth(
            robot.position.x,
            targetX + Math.sin(phase * 2.2) * 0.025,
            5,
            step,
          );
          robot.position.y = smooth(
            robot.position.y,
            targetY + Math.sin(phase * 3.1) * 0.025 + scrollImpulse * 0.16,
            5,
            step,
          );
          robot.rotation.z = smooth(robot.rotation.z, 0, 5, step);
        }
        const gait = state === "RUNNING" ? 10 : state === "WALKING" ? 6 : state === "CLIMBING" ? 7 : 0;
        const limb = Math.sin(phase * gait) * (state === "RUNNING" ? 0.72 : state === "CLIMBING" ? 0.48 : 0.38);
        const seatedLeg = state === "SITTING" ? -1.05 : 0;
        if (leftLeg) leftLeg.rotation.x = smooth(leftLeg.rotation.x, seatedLeg + limb + stumble, 9, step);
        if (rightLeg) rightLeg.rotation.x = smooth(rightLeg.rotation.x, seatedLeg - limb, 9, step);
        if (leftArm) leftArm.rotation.x = smooth(leftArm.rotation.x, state === "CLIMBING" ? limb - 0.65 : -limb * 0.72, 8, step);
        if (rightArm) {
          const wave = state === "WAVING" ? Math.sin(phase * 10) * 0.8 : 0;
          rightArm.rotation.z = smooth(rightArm.rotation.z, state === "WAVING" ? -1.6 : 0, 8, step);
          rightArm.rotation.x = smooth(rightArm.rotation.x, state === "CLIMBING" ? -limb - 0.65 : -limb * 0.72 + wave, 8, step);
        }
        if (torso) {
          torso.position.y =
            Math.sin(phase * (state === "RUNNING" ? 20 : 3)) *
            (state === "RUNNING" ? 0.045 : 0.018);
          torso.rotation.z = smooth(torso.rotation.z, state === "RUNNING" ? -0.12 : 0, 5, step);
        }
        if (head) {
          const curiousGlance = state === "PEEKING" ? Math.sin(phase * 2.6) * 0.2 : 0;
          head.rotation.y = smooth(
            head.rotation.y,
            clamp(pointerX * 0.55 + curiousGlance, -0.35, 0.35),
            5,
            step,
          );
          head.rotation.x = smooth(
            head.rotation.x,
            clamp(
              -pointerY * 0.28 + (state === "PEEKING" ? Math.sin(phase * 2) * 0.06 : 0),
              -0.18,
              0.18,
            ),
            5,
            step,
          );
          head.rotation.z = smooth(head.rotation.z, state === "SLEEPING" ? -0.25 : 0, 4, step);
        }
        const wide =
          state === "RUNNING" || state === "WAVING" ? 1.18 : state === "SLEEPING" ? 0.65 : 1;
        eyeLeft?.scale.set(0.052 * wide, 0.07 * wide, 0.036);
        eyeRight?.scale.set(0.052 * wide, 0.07 * wide, 0.036);
        stumble = smooth(stumble, 0, 4, step);
        if (stateTime >= durations[state]) {
          if (state === "RUNNING" && cycle % 2 === 1) stumble = 0.24;
          transition(nextState());
        }
        renderer.render(scene, camera);
      }
      renderer.setAnimationLoop(animate);
    } catch {
      // WebGL is optional decoration; unsupported devices keep the full 2D interface.
      scene?.traverse((object) => {
        const item = object as THREE.Mesh;
        item.geometry?.dispose?.();
        if (Array.isArray(item.material)) item.material.forEach((material) => material.dispose());
        else item.material?.dispose?.();
      });
      renderer?.dispose();
      renderer?.domElement.remove();
      return;
    }

    return () => {
      active = false;
      if (onPointerMove) host.removeEventListener("pointermove", onPointerMove);
      if (onInteract) host.removeEventListener("pointerdown", onInteract);
      if (onScroll) window.removeEventListener("scroll", onScroll);
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      if (onContextLost)
        renderer?.domElement.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      renderer?.setAnimationLoop(null);
      if (scene) {
        scene.traverse((object) => {
          const item = object as THREE.Mesh;
          item.geometry?.dispose?.();
          if (Array.isArray(item.material)) item.material.forEach((material) => material.dispose());
          else item.material?.dispose?.();
        });
      }
      renderer?.renderLists.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="robot-companion" aria-hidden="true" />;
}
