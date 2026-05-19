export const normalizeMultiplier = (value: number | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, value);
};

export const tokensForTask = (baseTokens: number, pointMultiplier: number | undefined) =>
  Math.max(0, Math.round(baseTokens * normalizeMultiplier(pointMultiplier)));
