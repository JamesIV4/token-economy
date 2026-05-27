export type RuntimeProfile = {
  fixedTimeStep: number;
  gridCells: {
    x: number;
    y: number;
    z: number;
  };
  maxSubSteps: number;
  physicsCoinSegments: number;
  pixelRatioLimit: number;
  renderCoinSegments: number;
  sleepSpeedLimit: number;
  sleepTimeLimit: number;
  solverIterations: number;
  solverTolerance: number;
  stopperSegments: number;
  wallSegments: number;
};

export type CoinPhysicsCommand =
  | {
      type: "gravity";
      x: number;
      y: number;
      z: number;
    }
  | {
      type: "init";
      profile: RuntimeProfile;
      visibleCoins: number;
    }
  | {
      type: "kick";
      x: number;
      y: number;
      z: number;
    }
  | {
      type: "stop";
    };

export type CoinPhysicsFrame = {
  moving: boolean;
  transforms: Float32Array;
  type: "frame";
};

export const coinRadius = 0.44;
export const coinDepth = 0.16;
export const maxVisibleCoins = 100;

export const jarInnerWidth = 1.58;
export const jarFloor = -2.36;
export const jarCeiling = 1.92;
export const jarWallThickness = 0.16;

export const physicsBounds = {
  max: {
    x: 2.35,
    y: 2.25,
    z: 2.35,
  },
  min: {
    x: -2.35,
    y: -2.72,
    z: -2.35,
  },
};
