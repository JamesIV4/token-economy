import * as CANNON from "cannon-es";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import * as THREE from "three";

type MasonJarBankProps = {
  accentColor: string;
  kidName: string;
  tokenCount: number;
};

type CoinActor = {
  body: CANNON.Body;
  mesh: THREE.Mesh;
};

type DeviceMotionPermissionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

const baseAssetPath = import.meta.env.BASE_URL;
const jarImage = `${baseAssetPath}mason-jar.png`;
const coinImage = `${baseAssetPath}coin.png`;
const coinRadius = 0.44;
const coinDepth = 0.16;
const maxVisibleCoins = 42;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const addBoxWall = (
  world: CANNON.World,
  material: CANNON.Material,
  size: CANNON.Vec3,
  position: CANNON.Vec3,
  rotationY = 0,
) => {
  const body = new CANNON.Body({ mass: 0, material });
  body.addShape(new CANNON.Box(size));
  body.position.copy(position);
  body.quaternion.setFromEuler(0, rotationY, 0);
  world.addBody(body);
  return body;
};

const addCylinderStopper = (
  world: CANNON.World,
  material: CANNON.Material,
  radius: number,
  depth: number,
  y: number,
) => {
  const body = new CANNON.Body({ mass: 0, material });
  body.addShape(new CANNON.Cylinder(radius, radius, depth, 32));
  body.position.set(0, y, 0);
  world.addBody(body);
  return body;
};

export function MasonJarBank({
  accentColor,
  kidName,
  tokenCount,
}: MasonJarBankProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const actorsRef = useRef<CoinActor[]>([]);
  const shakeRef = useRef({ x: 0, y: 0, z: 0 });
  const motionRef = useRef({ x: 0, y: 0, z: 0 });
  const lastMotionRef = useRef({ x: 0, y: 0, z: 0 });
  const kickCoinsRef = useRef<(x: number, y: number, z: number) => void>(
    () => undefined,
  );
  const detachMotionRef = useRef<(() => void) | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ time: number; x: number; y: number } | null>(
    null,
  );
  const settleTimerRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isHolding, setIsHolding] = useState(false);
  const visibleCoins = useMemo(
    () => clamp(Math.round(tokenCount), 0, maxVisibleCoins),
    [tokenCount],
  );

  const kickCoins = useCallback((x: number, y: number, z: number) => {
    const actors = actorsRef.current;
    actors.forEach(({ body }, index) => {
      const phase = index * 0.81;
      body.wakeUp();
      body.velocity.x += x * randomBetween(0.45, 1.15) + Math.sin(phase) * 0.4;
      body.velocity.y += y * randomBetween(0.45, 1.15) + Math.cos(phase) * 0.5;
      body.velocity.z += z * randomBetween(0.45, 1.15) + Math.sin(phase * 0.7);
      body.angularVelocity.x += randomBetween(-9, 9) + z * 1.8;
      body.angularVelocity.y += randomBetween(-9, 9) + x * 1.7;
      body.angularVelocity.z += randomBetween(-12, 12) + y * 1.4;
    });
  }, []);

  useEffect(() => {
    kickCoinsRef.current = kickCoins;
  }, [kickCoins]);

  const handleDeviceMotion = useCallback((event: DeviceMotionEvent) => {
    const acceleration =
      event.accelerationIncludingGravity ?? event.acceleration;
    if (!acceleration) return;

    const ax = acceleration.x ?? 0;
    const ay = acceleration.y ?? 0;
    const az = acceleration.z ?? 0;
    const last = lastMotionRef.current;
    const jerk = Math.hypot(ax - last.x, ay - last.y, az - last.z);
    lastMotionRef.current = { x: ax, y: ay, z: az };
    motionRef.current = {
      x: clamp(-ax * 2.25, -24, 24),
      y: clamp(ay * 1.55, -18, 22),
      z: clamp(-az * 1.2, -18, 18),
    };

    if (jerk > 5.5) {
      kickCoinsRef.current(
        clamp(-ax * 0.23, -4, 4),
        clamp(ay * 0.22, -4, 4),
        clamp(-az * 0.2, -3, 3),
      );
    }
  }, []);

  const enableDeviceMotion = useCallback(async () => {
    if (detachMotionRef.current || !("DeviceMotionEvent" in window)) return;

    const motionEvent =
      window.DeviceMotionEvent as DeviceMotionPermissionEvent;

    if (motionEvent.requestPermission) {
      try {
        const permission = await motionEvent.requestPermission();
        if (permission !== "granted") {
          return;
        }
      } catch {
        return;
      }
    }

    window.addEventListener("devicemotion", handleDeviceMotion);
    detachMotionRef.current = () => {
      window.removeEventListener("devicemotion", handleDeviceMotion);
      detachMotionRef.current = null;
    };
  }, [handleDeviceMotion]);

  useEffect(
    () => () => {
      detachMotionRef.current?.();
    },
    [],
  );

  useEffect(() => {
    const element = sceneRef.current;
    if (!element) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.1, 10.6);
    camera.lookAt(0, -0.2, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);

    const ambientLight = new THREE.HemisphereLight(0xffffff, 0xb59652, 2.2);
    const keyLight = new THREE.DirectionalLight(0xfff2bd, 3.4);
    keyLight.position.set(-2.8, 5.3, 5);
    const rimLight = new THREE.PointLight(0x95f6ff, 2.6, 13);
    rimLight.position.set(3, 2.2, 4.8);
    scene.add(ambientLight, keyLight, rimLight);

    const textureLoader = new THREE.TextureLoader();
    const coinTexture = textureLoader.load(coinImage);
    coinTexture.colorSpace = THREE.SRGBColorSpace;
    coinTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const geometry = new THREE.CylinderGeometry(
      coinRadius,
      coinRadius,
      coinDepth,
      48,
      1,
      false,
    );
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: 0xd58a12,
      emissive: 0x3d2100,
      emissiveIntensity: 0.16,
      metalness: 0.55,
      roughness: 0.36,
    });
    const faceMaterial = new THREE.MeshStandardMaterial({
      alphaTest: 0.1,
      map: coinTexture,
      metalness: 0.26,
      roughness: 0.42,
    });
    const backMaterial = faceMaterial.clone();
    const coinMaterials = [sideMaterial, faceMaterial, backMaterial];

    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -13.4, 0),
    });
    const solver = new CANNON.GSSolver();
    solver.iterations = 22;
    solver.tolerance = 0.0008;
    world.solver = solver;
    world.allowSleep = false;
    world.broadphase = new CANNON.SAPBroadphase(world);

    const coinPhysicsMaterial = new CANNON.Material("coin");
    const glassPhysicsMaterial = new CANNON.Material("glass");
    world.defaultContactMaterial.friction = 0.18;
    world.defaultContactMaterial.restitution = 0.78;
    world.addContactMaterial(
      new CANNON.ContactMaterial(coinPhysicsMaterial, coinPhysicsMaterial, {
        contactEquationStiffness: 1e8,
        friction: 0.28,
        frictionEquationStiffness: 1e7,
        restitution: 0.76,
      }),
    );
    world.addContactMaterial(
      new CANNON.ContactMaterial(coinPhysicsMaterial, glassPhysicsMaterial, {
        contactEquationStiffness: 1e8,
        friction: 0.08,
        frictionEquationStiffness: 1e7,
        restitution: 0.92,
      }),
    );

    const jarInnerWidth = 1.58;
    const jarFloor = -2.36;
    const jarCeiling = 1.92;
    const jarWallThickness = 0.16;
    const jarWallSegments = 28;
    const jarHeight = jarCeiling - jarFloor;
    const jarCenterY = (jarCeiling + jarFloor) / 2;
    const wallArcHalf =
      ((Math.PI * 2 * (jarInnerWidth + jarWallThickness)) / jarWallSegments) *
      0.56;

    addCylinderStopper(
      world,
      glassPhysicsMaterial,
      jarInnerWidth,
      0.24,
      jarFloor,
    );
    addCylinderStopper(
      world,
      glassPhysicsMaterial,
      jarInnerWidth,
      0.2,
      jarCeiling,
    );

    for (let segment = 0; segment < jarWallSegments; segment += 1) {
      const theta = (segment / jarWallSegments) * Math.PI * 2;
      const wallRadius = jarInnerWidth + jarWallThickness;

      addBoxWall(
        world,
        glassPhysicsMaterial,
        new CANNON.Vec3(wallArcHalf, jarHeight / 2, jarWallThickness),
        new CANNON.Vec3(
          Math.cos(theta) * wallRadius,
          jarCenterY,
          Math.sin(theta) * wallRadius,
        ),
        Math.PI / 2 - theta,
      );
    }

    const coinShape = new CANNON.Cylinder(
      coinRadius,
      coinRadius,
      coinDepth,
      24,
    );
    const actors: CoinActor[] = [];
    const perRow = 3;
    const rowGap = coinRadius * 0.5;
    const scatterX = coinRadius * 1.34;

    for (let index = 0; index < visibleCoins; index += 1) {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const mesh = new THREE.Mesh(geometry, coinMaterials);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const body = new CANNON.Body({
        angularDamping: 0.14,
        linearDamping: 0.045,
        mass: 0.82,
        material: coinPhysicsMaterial,
        position: new CANNON.Vec3(
          (column - (perRow - 1) / 2) * scatterX + randomBetween(-0.06, 0.06),
          -2.0 + row * rowGap + randomBetween(0, 0.08),
          randomBetween(-0.72, 0.72),
        ),
      });
      body.addShape(coinShape);
      body.quaternion.setFromEuler(
        Math.PI / 2 + randomBetween(-0.35, 0.35),
        randomBetween(-0.42, 0.42),
        randomBetween(-Math.PI, Math.PI),
      );
      body.velocity.set(
        randomBetween(-1.6, 1.6),
        randomBetween(1.5, 4.8),
        randomBetween(-1, 1),
      );
      body.angularVelocity.set(
        randomBetween(-7, 7),
        randomBetween(-7, 7),
        randomBetween(-12, 12),
      );
      world.addBody(body);
      scene.add(mesh);
      actors.push({ body, mesh });
    }

    actorsRef.current = actors;

    const resize = () => {
      const width = Math.max(220, element.clientWidth);
      const height = Math.max(220, element.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);
    resize();

    let animationFrame = 0;
    let previousTime = performance.now() / 1000;

    const animate = (timeMs: number) => {
      const time = timeMs / 1000;
      const delta = Math.min(0.033, time - previousTime);
      previousTime = time;
      const shake = shakeRef.current;
      const motion = motionRef.current;
      const gravityX = clamp(shake.x + motion.x, -38, 38);
      const gravityY = clamp(-13.4 + shake.y + motion.y, -40, 28);
      const gravityZ = clamp(shake.z + motion.z, -30, 30);

      world.gravity.set(gravityX, gravityY, gravityZ);
      world.step(1 / 60, delta, 5);

      shake.x *= 0.9;
      shake.y *= 0.9;
      shake.z *= 0.9;
      motion.x *= 0.992;
      motion.y *= 0.992;
      motion.z *= 0.992;

      actors.forEach(({ body, mesh }) => {
        const velocity = body.velocity;
        const speedSq =
          velocity.x * velocity.x +
          velocity.y * velocity.y +
          velocity.z * velocity.z;
        if (speedSq > 324) {
          velocity.scale(18 / Math.sqrt(speedSq), velocity);
        }

        mesh.position.set(body.position.x, body.position.y, body.position.z);
        mesh.quaternion.set(
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w,
        );
      });

      rimLight.intensity = 2.2 + Math.min(1.4, Math.abs(gravityX) / 18);
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      actorsRef.current = [];
      actors.forEach(({ body, mesh }) => {
        world.removeBody(body);
        scene.remove(mesh);
      });
      geometry.dispose();
      sideMaterial.dispose();
      faceMaterial.dispose();
      backMaterial.dispose();
      coinTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [accentColor, visibleCoins]);

  useEffect(
    () => () => {
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  const releaseJar = useCallback(() => {
    pointerIdRef.current = null;
    lastPointerRef.current = null;
    setIsHolding(false);
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      setDragOffset({ x: 0, y: 0 });
    }, 80);
  }, []);

  const beginShake = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      pointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      lastPointerRef.current = {
        time: performance.now(),
        x: event.clientX,
        y: event.clientY,
      };
      setIsHolding(true);
      setDragOffset({ x: 0, y: 0 });
      void enableDeviceMotion();
      kickCoinsRef.current(randomBetween(-2, 2), 3.5, randomBetween(-2, 2));
    },
    [enableDeviceMotion],
  );

  const shakeJar = useCallback((event: PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== event.pointerId || !lastPointerRef.current) {
      return;
    }

    const now = performance.now();
    const last = lastPointerRef.current;
    const elapsed = Math.max(16, now - last.time);
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    const impulseX = clamp((-dx / elapsed) * 120, -25, 25);
    const impulseY = clamp((dy / elapsed) * 130, -22, 24);
    const impulseZ = clamp((Math.abs(dx) + Math.abs(dy)) * 0.035, 0, 15);

    shakeRef.current.x += impulseX;
    shakeRef.current.y += impulseY;
    shakeRef.current.z += (dx > 0 ? 1 : -1) * impulseZ;
    setDragOffset({
      x: clamp(dx * 0.72, -22, 22),
      y: clamp(dy * 0.58, -18, 18),
    });

    if (Math.abs(dx) + Math.abs(dy) > 12) {
      kickCoinsRef.current(impulseX * 0.055, impulseY * 0.06, impulseZ * 0.05);
    }

    lastPointerRef.current = {
      time: now,
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    shakeRef.current.x += randomBetween(-18, 18);
    shakeRef.current.y += randomBetween(6, 24);
    shakeRef.current.z += randomBetween(-12, 12);
    kickCoinsRef.current(randomBetween(-3, 3), 4, randomBetween(-2, 2));
    setIsHolding(true);
    window.setTimeout(() => setIsHolding(false), 180);
  }, []);

  return (
    <div
      className={`jar-bank ${isHolding ? "is-holding" : ""}`}
      style={
        {
          "--jar-accent": accentColor,
          "--jar-tilt": `${dragOffset.x * 0.22}deg`,
          "--jar-x": `${dragOffset.x}px`,
          "--jar-y": `${dragOffset.y}px`,
        } as CSSProperties
      }
    >
      <div className="jar-bank-grabber">
        <div className="jar-bank-scene" ref={sceneRef} />
        <img
          alt=""
          className="jar-bank-image"
          draggable={false}
          src={jarImage}
        />
        <span className="jar-bank-glass" aria-hidden="true" />
        <span
          aria-label={`${kidName}'s mason jar token bank`}
          className="jar-bank-hit-area"
          onKeyDown={handleKeyDown}
          onPointerCancel={releaseJar}
          onPointerDown={beginShake}
          onPointerMove={shakeJar}
          onPointerUp={releaseJar}
          role="button"
          tabIndex={0}
        />
      </div>
    </div>
  );
}
