export type Kid = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  bankedTokens: number;
  pointMultiplier: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  createdAt?: number;
  updatedAt?: number;
};

export type TokenTask = {
  id: string;
  title: string;
  tokens: number;
  active: boolean;
  sortOrder: number;
  maxPerDay?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type Reward = {
  id: string;
  title: string;
  cost: number;
  active: boolean;
  sortOrder: number;
  createdAt?: number;
  updatedAt?: number;
};

export type TokenEarning = {
  id: string;
  kidId: string;
  taskId: string;
  taskTitle: string;
  tokens: number;
  notes: string;
  createdAt?: number;
  updatedAt?: number;
};

export type RewardRedemption = {
  id: string;
  kidId: string;
  rewardId: string;
  rewardTitle: string;
  cost: number;
  notes: string;
  createdAt?: number;
};

export type BurstKind = "earn" | "reward";
