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
import { Smartphone } from "lucide-react";
import * as THREE from "three";
import {
  coinDepth,
  coinRadius,
  maxVisibleCoins,
  type CoinPhysicsCommand,
  type CoinPhysicsFrame,
  type RuntimeProfile,
} from "../lib/coinPhysics";

type MasonJarBankProps = {
  accentColor: string;
  kidName: string;
  onMotionNotice?: (message: string) => void;
  tokenCount: number;
};

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
};

type DeviceMotionPermissionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

type WindowWithLegacyOrientation = Window & {
  orientation?: number;
};

type MotionAccessState =
  | "blocked"
  | "denied"
  | "enabled"
  | "needs-permission"
  | "ready"
  | "requesting"
  | "unsupported";

const baseAssetPath = import.meta.env.BASE_URL;
const jarImage = `${baseAssetPath}mason-jar.png`;
const coinImage = `${baseAssetPath}coin.png`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const baseGravityY = -13.4;
const planarGravityStrength = Math.abs(baseGravityY);
const minPlanarGravity = 2.2;
const planarGravitySmoothing = 0.22;
const kickShakeThreshold = 5.5;

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

const getInitialMotionAccess = (): MotionAccessState => {
  if (!("DeviceMotionEvent" in window)) return "unsupported";
  if (!window.isSecureContext) return "blocked";

  const motionEvent =
    window.DeviceMotionEvent as DeviceMotionPermissionEvent;
  return motionEvent.requestPermission ? "needs-permission" : "ready";
};

const getScreenRotationAngle = () => {
  const screenAngle = screen.orientation?.angle;
  if (typeof screenAngle === "number") return screenAngle;

  const legacyAngle = (window as WindowWithLegacyOrientation).orientation;
  return typeof legacyAngle === "number" ? legacyAngle : 0;
};

const alignToScreenPlane = (x: number, y: number) => {
  const angle = (getScreenRotationAngle() * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
};

const getPlanarGravity = (x: number, y: number) => {
  const gravityX = x;
  const gravityY = y;
  const magnitude = Math.hypot(gravityX, gravityY);

  if (magnitude < minPlanarGravity) {
    return { x: 0, y: baseGravityY, z: 0 };
  }

  return {
    x: (gravityX / magnitude) * planarGravityStrength,
    y: (gravityY / magnitude) * planarGravityStrength,
    z: 0,
  };
};

const smoothPlanarGravity = (
  current: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
) => ({
  x: lerp(current.x, target.x, planarGravitySmoothing),
  y: lerp(current.y, target.y, planarGravitySmoothing),
  z: 0,
});

const getRuntimeProfile = (): RuntimeProfile => {
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const deviceMemory = (navigator as NavigatorWithMemory).deviceMemory ?? 8;
  const lowerRenderCost = coarsePointer || deviceMemory <= 4;

  return {
    fixedTimeStep: 1 / 60,
    gridCells: {
      x: 5,
      y: 8,
      z: 5,
    },
    maxSubSteps: 4,
    physicsCoinSegments: 16,
    pixelRatioLimit: lowerRenderCost ? 1.35 : 1.75,
    renderCoinSegments: lowerRenderCost ? 28 : 36,
    sleepSpeedLimit: 0.34,
    sleepTimeLimit: 0.48,
    solverIterations: 12,
    solverTolerance: 0.003,
    stopperSegments: 24,
    wallSegments: 24,
  };
};

export function MasonJarBank({
  accentColor,
  kidName,
  onMotionNotice,
  tokenCount,
}: MasonJarBankProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const physicsWorkerRef = useRef<Worker | null>(null);
  const shakeRef = useRef({ x: 0, y: 0, z: 0 });
  const motionRef = useRef({ x: 0, y: baseGravityY, z: 0 });
  const lastMotionRef = useRef({ x: 0, y: 0, z: 0 });
  const motionProbeTimerRef = useRef<number | null>(null);
  const motionSampleReceivedRef = useRef(false);
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
  const [motionAccess, setMotionAccess] = useState<MotionAccessState>(
    getInitialMotionAccess,
  );
  const visibleCoins = useMemo(
    () => clamp(Math.round(tokenCount), 0, maxVisibleCoins),
    [tokenCount],
  );

  const kickCoins = useCallback((x: number, y: number, z: number) => {
    const message: CoinPhysicsCommand = { type: "kick", x, y, z };
    physicsWorkerRef.current?.postMessage(message);
  }, []);

  useEffect(() => {
    kickCoinsRef.current = kickCoins;
  }, [kickCoins]);

  const handleDeviceMotion = useCallback((event: DeviceMotionEvent) => {
    const gravityAcceleration = event.accelerationIncludingGravity;
    const linearAcceleration = event.acceleration;
    const kickAcceleration = linearAcceleration ?? gravityAcceleration;
    if (!gravityAcceleration && !kickAcceleration) return;

    const hadMotionSample = motionSampleReceivedRef.current;
    motionSampleReceivedRef.current = true;

    if (gravityAcceleration) {
      const screenGravity = alignToScreenPlane(
        gravityAcceleration.x ?? 0,
        gravityAcceleration.y ?? 0,
      );
      motionRef.current = smoothPlanarGravity(
        motionRef.current,
        getPlanarGravity(screenGravity.x, screenGravity.y),
      );
    }

    const ax = kickAcceleration?.x ?? 0;
    const ay = kickAcceleration?.y ?? 0;
    const az = kickAcceleration?.z ?? 0;
    const last = lastMotionRef.current;
    const jerk = hadMotionSample
      ? Math.hypot(ax - last.x, ay - last.y, az - last.z)
      : 0;
    lastMotionRef.current = { x: ax, y: ay, z: az };

    if (jerk > kickShakeThreshold) {
      kickCoinsRef.current(
        clamp(-ax * 0.38, -4.8, 4.8),
        clamp(ay * 0.34, -4.8, 4.8),
        clamp(-az * 0.3, -3.8, 3.8),
      );
    }
  }, []);

  const clearMotionProbe = useCallback(() => {
    if (motionProbeTimerRef.current) {
      window.clearTimeout(motionProbeTimerRef.current);
      motionProbeTimerRef.current = null;
    }
  }, []);

  const attachDeviceMotion = useCallback(
    (notify: boolean) => {
      if (detachMotionRef.current) {
        return true;
      }

      motionSampleReceivedRef.current = false;
      window.addEventListener("devicemotion", handleDeviceMotion, {
        passive: true,
      });
      detachMotionRef.current = () => {
        window.removeEventListener("devicemotion", handleDeviceMotion);
        detachMotionRef.current = null;
      };
      setMotionAccess("enabled");

      if (notify) {
        clearMotionProbe();
        motionProbeTimerRef.current = window.setTimeout(() => {
          motionProbeTimerRef.current = null;
          if (!motionSampleReceivedRef.current) {
            onMotionNotice?.(
              "Motion is enabled, but no accelerometer data is arriving.",
            );
          }
        }, 1400);
      }

      return true;
    },
    [clearMotionProbe, handleDeviceMotion, onMotionNotice],
  );

  const enableDeviceMotion = useCallback(
    async (notify = true) => {
      if (detachMotionRef.current) {
        return true;
      }

      if (!("DeviceMotionEvent" in window)) {
        setMotionAccess("unsupported");
        if (notify) {
          onMotionNotice?.("Motion controls are not available in this browser.");
        }
        return false;
      }

      if (!window.isSecureContext) {
        setMotionAccess("blocked");
        if (notify) {
          onMotionNotice?.(
            "Motion controls need HTTPS or localhost to read phone sensors.",
          );
        }
        return false;
      }

      const motionEvent =
        window.DeviceMotionEvent as DeviceMotionPermissionEvent;

      if (motionEvent.requestPermission) {
        try {
          setMotionAccess("requesting");
          const permission = await motionEvent.requestPermission();
          if (permission !== "granted") {
            setMotionAccess("denied");
            if (notify) {
              onMotionNotice?.(
                "Motion access was denied. Enable Motion & Orientation Access for this site, then try again.",
              );
            }
            return false;
          }
        } catch {
          setMotionAccess("needs-permission");
          if (notify) {
            onMotionNotice?.("Tap Enable motion to allow phone shake controls.");
          }
          return false;
        }
      }

      attachDeviceMotion(notify);
      return true;
    },
    [attachDeviceMotion, onMotionNotice],
  );

  useEffect(() => {
    if (motionAccess !== "ready" || detachMotionRef.current) {
      return;
    }

    motionSampleReceivedRef.current = false;
    window.addEventListener("devicemotion", handleDeviceMotion, {
      passive: true,
    });
    detachMotionRef.current = () => {
      window.removeEventListener("devicemotion", handleDeviceMotion);
      detachMotionRef.current = null;
    };

    return () => {
      detachMotionRef.current?.();
    };
  }, [handleDeviceMotion, motionAccess]);

  useEffect(
    () => () => {
      clearMotionProbe();
      detachMotionRef.current?.();
    },
    [clearMotionProbe],
  );

  useEffect(() => {
    const element = sceneRef.current;
    if (!element) return;

    const runtimeProfile = getRuntimeProfile();
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
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, runtimeProfile.pixelRatioLimit),
    );
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
    coinTexture.anisotropy = Math.min(
      4,
      renderer.capabilities.getMaxAnisotropy(),
    );

    const geometry = new THREE.CylinderGeometry(
      coinRadius,
      coinRadius,
      coinDepth,
      runtimeProfile.renderCoinSegments,
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

    const coinMesh = new THREE.InstancedMesh(
      geometry,
      coinMaterials,
      visibleCoins,
    );
    coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    coinMesh.frustumCulled = false;
    scene.add(coinMesh);

    const matrix = new THREE.Matrix4();
    const matrixPosition = new THREE.Vector3();
    const matrixQuaternion = new THREE.Quaternion();
    const matrixScale = new THREE.Vector3(1, 1, 1);
    const latestFrameRef = {
      current: null as Float32Array | null,
    };
    const renderedFrameRef = {
      current: null as Float32Array | null,
    };
    const physicsMovingRef = {
      current: true,
    };
    const frameReceivedRef = {
      current: false,
    };
    const applyLatestFrame = () => {
      const transforms = latestFrameRef.current;
      if (!transforms || transforms === renderedFrameRef.current) {
        return false;
      }

      for (let index = 0; index < visibleCoins; index += 1) {
        const offset = index * 7;
        matrixPosition.set(
          transforms[offset],
          transforms[offset + 1],
          transforms[offset + 2],
        );
        matrixQuaternion.set(
          transforms[offset + 3],
          transforms[offset + 4],
          transforms[offset + 5],
          transforms[offset + 6],
        );
        matrix.compose(matrixPosition, matrixQuaternion, matrixScale);
        coinMesh.setMatrixAt(index, matrix);
      }

      coinMesh.instanceMatrix.needsUpdate = true;
      renderedFrameRef.current = transforms;
      return true;
    };

    const physicsWorker = new Worker(
      new URL("../workers/coinPhysicsWorker.ts", import.meta.url),
      { type: "module" },
    );
    physicsWorkerRef.current = physicsWorker;
    physicsWorker.onmessage = (event: MessageEvent<CoinPhysicsFrame>) => {
      if (event.data.type !== "frame") return;
      latestFrameRef.current = event.data.transforms;
      physicsMovingRef.current = event.data.moving;
      frameReceivedRef.current = true;
    };
    physicsWorker.postMessage({
      profile: runtimeProfile,
      type: "init",
      visibleCoins,
    } satisfies CoinPhysicsCommand);

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
    let lastRenderTime = 0;
    let previousGravityX = 0;
    let previousGravityY = baseGravityY;
    let previousGravityZ = 0;

    const animate = (timeMs: number) => {
      const time = timeMs / 1000;
      const shake = shakeRef.current;
      const motion = motionRef.current;
      const gravityX = clamp(shake.x + motion.x, -38, 38);
      const gravityY = clamp(shake.y + motion.y, -40, 28);
      const gravityZ = clamp(shake.z + motion.z, -30, 30);
      const agitation =
        Math.abs(shake.x) + Math.abs(shake.y) + Math.abs(shake.z);
      const gravityDelta =
        Math.abs(gravityX - previousGravityX) +
        Math.abs(gravityY - previousGravityY) +
        Math.abs(gravityZ - previousGravityZ);

      if (gravityDelta > 0.01) {
        physicsWorker.postMessage({
          type: "gravity",
          x: gravityX,
          y: gravityY,
          z: gravityZ,
        } satisfies CoinPhysicsCommand);
      }
      previousGravityX = gravityX;
      previousGravityY = gravityY;
      previousGravityZ = gravityZ;

      shake.x *= 0.9;
      shake.y *= 0.9;
      shake.z *= 0.9;

      const hasNewPhysicsFrame = applyLatestFrame();

      rimLight.intensity = 2.2 + Math.min(1.4, Math.abs(gravityX) / 18);
      if (
        hasNewPhysicsFrame ||
        (frameReceivedRef.current &&
          (physicsMovingRef.current ||
            agitation > 0.035 ||
            gravityDelta > 0.01 ||
            time - lastRenderTime > 0.25))
      ) {
        renderer.render(scene, camera);
        lastRenderTime = time;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      physicsWorker.postMessage({ type: "stop" } satisfies CoinPhysicsCommand);
      physicsWorker.terminate();
      if (physicsWorkerRef.current === physicsWorker) {
        physicsWorkerRef.current = null;
      }
      scene.remove(coinMesh);
      geometry.dispose();
      sideMaterial.dispose();
      faceMaterial.dispose();
      backMaterial.dispose();
      coinTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [visibleCoins]);

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

  const requestMotionFromButton = useCallback(() => {
    void enableDeviceMotion();
  }, [enableDeviceMotion]);

  const showMotionButton =
    motionAccess !== "enabled" &&
    motionAccess !== "ready" &&
    motionAccess !== "unsupported";
  const motionButtonLabel =
    motionAccess === "blocked" ? "Motion needs HTTPS" : "Enable motion";
  const motionButtonText =
    motionAccess === "requesting"
      ? "Enabling"
      : motionAccess === "blocked"
        ? "HTTPS needed"
        : "Enable motion";

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
        {showMotionButton ? (
          <button
            aria-label={motionButtonLabel}
            className="jar-bank-motion-button"
            disabled={motionAccess === "requesting"}
            onClick={requestMotionFromButton}
            title={motionButtonLabel}
            type="button"
          >
            <Smartphone size={16} />
            <span>{motionButtonText}</span>
          </button>
        ) : null}
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
