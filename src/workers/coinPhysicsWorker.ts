/// <reference lib="webworker" />

import * as CANNON from "cannon-es";
import {
  coinDepth,
  coinRadius,
  jarCeiling,
  jarFloor,
  jarInnerWidth,
  jarWallThickness,
  physicsBounds,
  type CoinPhysicsCommand,
  type CoinPhysicsFrame,
  type RuntimeProfile,
} from "../lib/coinPhysics";

type CoinActor = {
  body: CANNON.Body;
};

const ctx = self as DedicatedWorkerGlobalScope;
const wallCollisionGroup = 1;
const coinCollisionGroup = 2;
const wallAndCoinCollisionMask = wallCollisionGroup | coinCollisionGroup;

let world: CANNON.World | null = null;
let actors: CoinActor[] = [];
let profile: RuntimeProfile | null = null;
let timerId: number | undefined;
let previousTime = 0;
let activeUntil = 0;
let lastFrameTime = 0;
let gravityX = 0;
let gravityY = -13.4;
let gravityZ = 0;

class JarGridBroadphase extends CANNON.Broadphase {
  private readonly aabbMax: CANNON.Vec3;
  private readonly aabbMin: CANNON.Vec3;
  private readonly bins: CANNON.Body[][];
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly seenPairs = new Set<string>();

  constructor(
    aabbMin: CANNON.Vec3,
    aabbMax: CANNON.Vec3,
    nx: number,
    ny: number,
    nz: number,
  ) {
    super();
    this.aabbMin = aabbMin;
    this.aabbMax = aabbMax;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.useBoundingBoxes = true;
    this.bins = Array.from({ length: nx * ny * nz }, () => []);
  }

  collisionPairs(
    targetWorld: CANNON.World,
    pairs1: CANNON.Body[],
    pairs2: CANNON.Body[],
  ) {
    this.seenPairs.clear();
    this.bins.forEach((bin) => {
      bin.length = 0;
    });

    targetWorld.bodies.forEach((body) => {
      if (body.shapes.length === 0) return;
      if (body.aabbNeedsUpdate) {
        body.updateAABB();
      }
      this.addAabbToBins(body);
    });

    this.bins.forEach((bin) => {
      for (let i = 0; i < bin.length; i += 1) {
        const bodyA = bin[i];
        for (let j = 0; j < i; j += 1) {
          const bodyB = bin[j];
          if (bodyA === bodyB || !this.needBroadphaseCollision(bodyA, bodyB)) {
            continue;
          }

          const minId = Math.min(bodyA.id, bodyB.id);
          const maxId = Math.max(bodyA.id, bodyB.id);
          const pairKey = `${minId}:${maxId}`;
          if (this.seenPairs.has(pairKey)) {
            continue;
          }

          this.seenPairs.add(pairKey);
          this.intersectionTest(bodyA, bodyB, pairs1, pairs2);
        }
      }
    });
  }

  private addAabbToBins(body: CANNON.Body) {
    const lowerBound = body.aabb.lowerBound;
    const upperBound = body.aabb.upperBound;
    const minX = this.toCell(lowerBound.x, this.aabbMin.x, this.aabbMax.x, this.nx);
    const minY = this.toCell(lowerBound.y, this.aabbMin.y, this.aabbMax.y, this.ny);
    const minZ = this.toCell(lowerBound.z, this.aabbMin.z, this.aabbMax.z, this.nz);
    const maxX = this.toCell(upperBound.x, this.aabbMin.x, this.aabbMax.x, this.nx);
    const maxY = this.toCell(upperBound.y, this.aabbMin.y, this.aabbMax.y, this.ny);
    const maxZ = this.toCell(upperBound.z, this.aabbMin.z, this.aabbMax.z, this.nz);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          this.bins[this.toBinIndex(x, y, z)].push(body);
        }
      }
    }
  }

  private toBinIndex(x: number, y: number, z: number) {
    return x * this.ny * this.nz + y * this.nz + z;
  }

  private toCell(value: number, min: number, max: number, cells: number) {
    const normalized = (value - min) / (max - min);
    return Math.min(cells - 1, Math.max(0, Math.floor(normalized * cells)));
  }
}

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const applyCollisionFilter = (
  body: CANNON.Body,
  group: number,
  mask: number,
) => {
  body.collisionFilterGroup = group;
  body.collisionFilterMask = mask;
};

const addBoxWall = (
  targetWorld: CANNON.World,
  material: CANNON.Material,
  size: CANNON.Vec3,
  position: CANNON.Vec3,
  rotationY = 0,
) => {
  const body = new CANNON.Body({ mass: 0, material });
  body.addShape(new CANNON.Box(size));
  body.position.copy(position);
  body.quaternion.setFromEuler(0, rotationY, 0);
  targetWorld.addBody(body);
  return body;
};

const addCylinderStopper = (
  targetWorld: CANNON.World,
  material: CANNON.Material,
  radius: number,
  depth: number,
  y: number,
  segments: number,
) => {
  const body = new CANNON.Body({ mass: 0, material });
  body.addShape(new CANNON.Cylinder(radius, radius, depth, segments));
  body.position.set(0, y, 0);
  targetWorld.addBody(body);
  return body;
};

const getSpawnPosition = (index: number, visibleCoins: number) => {
  const coinsPerLayer = visibleCoins > 72 ? 8 : visibleCoins > 42 ? 5 : 3;
  const layerGap = coinRadius * (visibleCoins > 72 ? 0.64 : 0.5);
  const scatterX = coinRadius * 1.34;
  const layer = Math.floor(index / coinsPerLayer);
  const slot = index % coinsPerLayer;
  const y = -2.0 + layer * layerGap + randomBetween(0, 0.08);

  if (coinsPerLayer === 3) {
    return new CANNON.Vec3(
      (slot - (coinsPerLayer - 1) / 2) * scatterX +
        randomBetween(-0.06, 0.06),
      y,
      randomBetween(-0.72, 0.72),
    );
  }

  const outerSlots = coinsPerLayer - 1;
  const isCenterSlot = slot === outerSlots;
  const theta = (slot / outerSlots) * Math.PI * 2 + layer * 0.58;
  const radius = isCenterSlot
    ? randomBetween(0, 0.14)
    : jarInnerWidth * (visibleCoins > 72 ? 0.54 : 0.48);

  return new CANNON.Vec3(
    Math.cos(theta) * radius + randomBetween(-0.05, 0.05),
    y,
    Math.sin(theta) * radius + randomBetween(-0.05, 0.05),
  );
};

const postFrame = (moving: boolean) => {
  const transforms = new Float32Array(actors.length * 7);

  actors.forEach(({ body }, index) => {
    const offset = index * 7;
    transforms[offset] = body.position.x;
    transforms[offset + 1] = body.position.y;
    transforms[offset + 2] = body.position.z;
    transforms[offset + 3] = body.quaternion.x;
    transforms[offset + 4] = body.quaternion.y;
    transforms[offset + 5] = body.quaternion.z;
    transforms[offset + 6] = body.quaternion.w;
  });

  const frame: CoinPhysicsFrame = {
    moving,
    transforms,
    type: "frame",
  };
  ctx.postMessage(frame, [transforms.buffer]);
  lastFrameTime = performance.now() / 1000;
};

const kickCoins = (x: number, y: number, z: number) => {
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
  activeUntil = performance.now() / 1000 + 0.65;
};

const tick = () => {
  if (!world || !profile) return;

  const time = performance.now() / 1000;
  const delta = Math.min(0.05, time - previousTime);
  previousTime = time;
  const hasMovingBodies = actors.some(
    ({ body }) => body.sleepState !== CANNON.Body.SLEEPING,
  );
  const shouldStep = hasMovingBodies || time < activeUntil;

  world.gravity.set(gravityX, gravityY, gravityZ);

  if (shouldStep) {
    world.step(profile.fixedTimeStep, delta, profile.maxSubSteps);

    actors.forEach(({ body }) => {
      const velocity = body.velocity;
      const speedSq =
        velocity.x * velocity.x +
        velocity.y * velocity.y +
        velocity.z * velocity.z;
      if (speedSq > 324) {
        velocity.scale(18 / Math.sqrt(speedSq), velocity);
      }
    });
  }

  if (shouldStep || time - lastFrameTime > 0.25) {
    postFrame(shouldStep);
  }
};

const stop = () => {
  if (timerId !== undefined) {
    clearInterval(timerId);
    timerId = undefined;
  }
  world = null;
  actors = [];
  profile = null;
};

const init = (visibleCoins: number, nextProfile: RuntimeProfile) => {
  stop();

  profile = nextProfile;
  const nextWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -13.4, 0),
  });
  const solver = new CANNON.GSSolver();
  solver.iterations = nextProfile.solverIterations;
  solver.tolerance = nextProfile.solverTolerance;
  nextWorld.solver = solver;
  nextWorld.allowSleep = true;
  nextWorld.broadphase = new JarGridBroadphase(
    new CANNON.Vec3(
      physicsBounds.min.x,
      physicsBounds.min.y,
      physicsBounds.min.z,
    ),
    new CANNON.Vec3(
      physicsBounds.max.x,
      physicsBounds.max.y,
      physicsBounds.max.z,
    ),
    nextProfile.gridCells.x,
    nextProfile.gridCells.y,
    nextProfile.gridCells.z,
  );

  const coinPhysicsMaterial = new CANNON.Material("coin");
  const glassPhysicsMaterial = new CANNON.Material("glass");
  nextWorld.defaultContactMaterial.friction = 0.18;
  nextWorld.defaultContactMaterial.restitution = 0.78;
  nextWorld.addContactMaterial(
    new CANNON.ContactMaterial(coinPhysicsMaterial, coinPhysicsMaterial, {
      contactEquationStiffness: 8e6,
      friction: 0.24,
      frictionEquationStiffness: 2e6,
      restitution: 0.76,
    }),
  );
  nextWorld.addContactMaterial(
    new CANNON.ContactMaterial(coinPhysicsMaterial, glassPhysicsMaterial, {
      contactEquationStiffness: 8e6,
      friction: 0.08,
      frictionEquationStiffness: 2e6,
      restitution: 0.92,
    }),
  );

  const jarWallSegments = nextProfile.wallSegments;
  const jarHeight = jarCeiling - jarFloor;
  const jarCenterY = (jarCeiling + jarFloor) / 2;
  const wallArcHalf =
    ((Math.PI * 2 * (jarInnerWidth + jarWallThickness)) / jarWallSegments) *
    0.56;

  applyCollisionFilter(
    addCylinderStopper(
      nextWorld,
      glassPhysicsMaterial,
      jarInnerWidth,
      0.24,
      jarFloor,
      nextProfile.stopperSegments,
    ),
    wallCollisionGroup,
    coinCollisionGroup,
  );
  applyCollisionFilter(
    addCylinderStopper(
      nextWorld,
      glassPhysicsMaterial,
      jarInnerWidth,
      0.2,
      jarCeiling,
      nextProfile.stopperSegments,
    ),
    wallCollisionGroup,
    coinCollisionGroup,
  );

  for (let segment = 0; segment < jarWallSegments; segment += 1) {
    const theta = (segment / jarWallSegments) * Math.PI * 2;
    const wallRadius = jarInnerWidth + jarWallThickness;

    applyCollisionFilter(
      addBoxWall(
        nextWorld,
        glassPhysicsMaterial,
        new CANNON.Vec3(wallArcHalf, jarHeight / 2, jarWallThickness),
        new CANNON.Vec3(
          Math.cos(theta) * wallRadius,
          jarCenterY,
          Math.sin(theta) * wallRadius,
        ),
        Math.PI / 2 - theta,
      ),
      wallCollisionGroup,
      coinCollisionGroup,
    );
  }

  const coinShape = new CANNON.Cylinder(
    coinRadius,
    coinRadius,
    coinDepth,
    nextProfile.physicsCoinSegments,
  );
  const nextActors: CoinActor[] = [];

  for (let index = 0; index < visibleCoins; index += 1) {
    const body = new CANNON.Body({
      angularDamping: 0.16,
      linearDamping: 0.05,
      mass: 0.82,
      material: coinPhysicsMaterial,
      position: getSpawnPosition(index, visibleCoins),
    });
    body.allowSleep = true;
    body.sleepSpeedLimit = nextProfile.sleepSpeedLimit;
    body.sleepTimeLimit = nextProfile.sleepTimeLimit;
    applyCollisionFilter(body, coinCollisionGroup, wallAndCoinCollisionMask);
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
    nextWorld.addBody(body);
    nextActors.push({ body });
  }

  world = nextWorld;
  actors = nextActors;
  gravityX = 0;
  gravityY = -13.4;
  gravityZ = 0;
  previousTime = performance.now() / 1000;
  activeUntil = previousTime + 1.25;
  lastFrameTime = 0;
  postFrame(true);
  timerId = setInterval(tick, 1000 / 60);
};

ctx.onmessage = (event: MessageEvent<CoinPhysicsCommand>) => {
  const message = event.data;

  if (message.type === "init") {
    init(message.visibleCoins, message.profile);
    return;
  }

  if (message.type === "stop") {
    stop();
    return;
  }

  if (message.type === "kick") {
    kickCoins(message.x, message.y, message.z);
    return;
  }

  const gravityDelta =
    Math.abs(message.x - gravityX) +
    Math.abs(message.y - gravityY) +
    Math.abs(message.z - gravityZ);
  gravityX = message.x;
  gravityY = message.y;
  gravityZ = message.z;

  if (gravityDelta > 5) {
    actors.forEach(({ body }) => body.wakeUp());
  }
  if (gravityDelta > 0.035) {
    activeUntil = performance.now() / 1000 + 0.25;
  }
};
