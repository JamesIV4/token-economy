import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { create } from "zustand";
import { getFirebase, hasFirebaseConfig, missingFirebaseConfig } from "../lib/firebase";
import { kidColors, starterRewards, starterTasks } from "../lib/seedData";
import { normalizeMultiplier, tokensForTask } from "../lib/tokens";
import type { Kid, Reward, RewardRedemption, TokenEarning, TokenTask } from "../types";

const paths = {
  kids: "data/kids/kids",
  tasks: "data/tasks/tasks",
  rewards: "data/rewards/rewards",
  earnings: "data/earnings/earnings",
  redemptions: "data/redemptions/redemptions",
};

type TokenState = {
  kids: Kid[];
  tasks: TokenTask[];
  rewards: Reward[];
  earnings: TokenEarning[];
  redemptions: RewardRedemption[];
  selectedKidId?: string;
  loading: boolean;
  error?: string;
  subscribe: () => Unsubscribe;
  setSelectedKid: (kidId: string) => void;
  seedStarterData: () => Promise<void>;
  addKid: (input: { name: string; color?: string; bankedTokens?: number; pointMultiplier?: number }) => Promise<void>;
  updateKid: (kidId: string, patch: Partial<Pick<Kid, "name" | "color" | "bankedTokens" | "pointMultiplier" | "active">>) => Promise<void>;
  addTask: (input: { title: string; tokens: number; maxPerDay?: number }) => Promise<void>;
  updateTask: (taskId: string, patch: Partial<Pick<TokenTask, "title" | "tokens" | "maxPerDay" | "active">>) => Promise<void>;
  addReward: (input: { title: string; cost: number }) => Promise<void>;
  updateReward: (rewardId: string, patch: Partial<Pick<Reward, "title" | "cost" | "active">>) => Promise<void>;
  addEarning: (input: { kidId: string; taskId: string; notes?: string }) => Promise<number>;
  addCustomEarning: (input: { kidId: string; title: string; tokens: number; notes?: string }) => Promise<number>;
  deleteEarning: (earningId: string) => Promise<void>;
  redeemReward: (input: { kidId: string; rewardId: string; notes?: string }) => Promise<number>;
  deleteRedemption: (redemptionId: string) => Promise<void>;
};

let liveUnsubscribe: Unsubscribe | undefined;

const toMillis = (value: unknown): number | undefined => {
  if (!value) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  return undefined;
};

const numberValue = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const stringValue = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

const booleanValue = (value: unknown, fallback = true) => (typeof value === "boolean" ? value : fallback);

const cleanNote = (notes?: string) => notes?.trim() ?? "";

const byTaskWorth = (a: TokenTask, b: TokenTask) => {
  const tokenOrder = a.tokens - b.tokens;
  if (tokenOrder !== 0) return tokenOrder;
  return a.title.localeCompare(b.title);
};

const byRewardWorth = (a: Reward, b: Reward) => {
  const costOrder = a.cost - b.cost;
  if (costOrder !== 0) return costOrder;
  return a.title.localeCompare(b.title);
};

const byNewest = <T extends { createdAt?: number }>(a: T, b: T) => numberValue(b.createdAt) - numberValue(a.createdAt);

const readKid = (id: string, data: DocumentData): Kid => ({
  id,
  name: stringValue(data.name, "Kid"),
  color: stringValue(data.color, kidColors[0]),
  active: booleanValue(data.active, true),
  bankedTokens: numberValue(data.bankedTokens),
  pointMultiplier: normalizeMultiplier(numberValue(data.pointMultiplier, 1)),
  lifetimeEarned: numberValue(data.lifetimeEarned),
  lifetimeRedeemed: numberValue(data.lifetimeRedeemed),
  createdAt: toMillis(data.createdAt),
  updatedAt: toMillis(data.updatedAt),
});

const readTask = (id: string, data: DocumentData): TokenTask => ({
  id,
  title: stringValue(data.title, "Task"),
  tokens: numberValue(data.tokens, 1),
  active: booleanValue(data.active, true),
  sortOrder: numberValue(data.sortOrder),
  maxPerDay: typeof data.maxPerDay === "number" ? data.maxPerDay : undefined,
  createdAt: toMillis(data.createdAt),
  updatedAt: toMillis(data.updatedAt),
});

const readReward = (id: string, data: DocumentData): Reward => ({
  id,
  title: stringValue(data.title, "Reward"),
  cost: numberValue(data.cost, 1),
  active: booleanValue(data.active, true),
  sortOrder: numberValue(data.sortOrder),
  createdAt: toMillis(data.createdAt),
  updatedAt: toMillis(data.updatedAt),
});

const readEarning = (id: string, data: DocumentData): TokenEarning => ({
  id,
  kidId: stringValue(data.kidId),
  taskId: stringValue(data.taskId),
  taskTitle: stringValue(data.taskTitle, "Task"),
  tokens: numberValue(data.tokens, 1),
  notes: stringValue(data.notes),
  createdAt: toMillis(data.createdAt),
  updatedAt: toMillis(data.updatedAt),
});

const readRedemption = (id: string, data: DocumentData): RewardRedemption => ({
  id,
  kidId: stringValue(data.kidId),
  rewardId: stringValue(data.rewardId),
  rewardTitle: stringValue(data.rewardTitle, "Reward"),
  cost: numberValue(data.cost, 1),
  notes: stringValue(data.notes),
  createdAt: toMillis(data.createdAt),
});

export const useTokenStore = create<TokenState>((set, get) => ({
  kids: [],
  tasks: [],
  rewards: [],
  earnings: [],
  redemptions: [],
  loading: true,
  subscribe: () => {
    if (liveUnsubscribe) return liveUnsubscribe;

    if (!hasFirebaseConfig) {
      set({
        loading: false,
        error: `Missing Firebase config: ${missingFirebaseConfig.join(", ")}`,
      });
      return () => undefined;
    }

    const { db } = getFirebase();
    const loaded = new Set<string>();
    const markLoaded = (key: string) => {
      loaded.add(key);
      if (loaded.size === 5) set({ loading: false });
    };
    const fail = (error: unknown) => {
      set({ loading: false, error: error instanceof Error ? error.message : "Firestore subscription failed." });
    };

    set({ loading: true, error: undefined });

    const unsubs = [
      onSnapshot(
        collection(db, paths.kids),
        (snapshot) => {
          const kids = snapshot.docs.map((item) => readKid(item.id, item.data())).sort((a, b) => a.name.localeCompare(b.name));
          const selectedKidId = get().selectedKidId;
          const activeKids = kids.filter((kid) => kid.active);
          set({
            kids,
            selectedKidId: selectedKidId && kids.some((kid) => kid.id === selectedKidId && kid.active) ? selectedKidId : activeKids[0]?.id,
          });
          markLoaded("kids");
        },
        fail,
      ),
      onSnapshot(
        collection(db, paths.tasks),
        (snapshot) => {
          set({ tasks: snapshot.docs.map((item) => readTask(item.id, item.data())).sort(byTaskWorth) });
          markLoaded("tasks");
        },
        fail,
      ),
      onSnapshot(
        collection(db, paths.rewards),
        (snapshot) => {
          set({ rewards: snapshot.docs.map((item) => readReward(item.id, item.data())).sort(byRewardWorth) });
          markLoaded("rewards");
        },
        fail,
      ),
      onSnapshot(
        collection(db, paths.earnings),
        (snapshot) => {
          set({ earnings: snapshot.docs.map((item) => readEarning(item.id, item.data())).sort(byNewest) });
          markLoaded("earnings");
        },
        fail,
      ),
      onSnapshot(
        collection(db, paths.redemptions),
        (snapshot) => {
          set({ redemptions: snapshot.docs.map((item) => readRedemption(item.id, item.data())).sort(byNewest) });
          markLoaded("redemptions");
        },
        fail,
      ),
    ];

    liveUnsubscribe = () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
      liveUnsubscribe = undefined;
    };

    return liveUnsubscribe;
  },
  setSelectedKid: (selectedKidId) => set({ selectedKidId }),
  seedStarterData: async () => {
    const { db } = getFirebase();
    const [tasksSnapshot, rewardsSnapshot] = await Promise.all([
      getDocs(collection(db, paths.tasks)),
      getDocs(collection(db, paths.rewards)),
    ]);

    const batch = writeBatch(db);
    if (tasksSnapshot.empty) {
      starterTasks.forEach((task) => {
        batch.set(
          doc(db, paths.tasks, task.id),
          {
            ...task,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
    }

    if (rewardsSnapshot.empty) {
      starterRewards.forEach((reward) => {
        batch.set(
          doc(db, paths.rewards, reward.id),
          {
            ...reward,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
    }

    if (tasksSnapshot.empty || rewardsSnapshot.empty) {
      await batch.commit();
    }
  },
  addKid: async ({ name, color, bankedTokens = 0, pointMultiplier = 1 }) => {
    const { db } = getFirebase();
    const kids = get().kids;
    await addDoc(collection(db, paths.kids), {
      name: name.trim(),
      color: color ?? kidColors[kids.length % kidColors.length],
      active: true,
      bankedTokens,
      pointMultiplier: normalizeMultiplier(pointMultiplier),
      lifetimeEarned: 0,
      lifetimeRedeemed: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },
  updateKid: async (kidId, patch) => {
    const { db } = getFirebase();
    await updateDoc(doc(db, paths.kids, kidId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  },
  addTask: async ({ title, tokens, maxPerDay }) => {
    const { db } = getFirebase();
    await addDoc(collection(db, paths.tasks), {
      title: title.trim(),
      tokens,
      maxPerDay: maxPerDay || null,
      active: true,
      sortOrder: (get().tasks.length + 1) * 10,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },
  updateTask: async (taskId, patch) => {
    const { db } = getFirebase();
    const { maxPerDay, ...rest } = patch;
    const payload = {
      ...rest,
      ...(Object.prototype.hasOwnProperty.call(patch, "maxPerDay") ? { maxPerDay: maxPerDay || null } : {}),
      updatedAt: serverTimestamp(),
    };
    await updateDoc(doc(db, paths.tasks, taskId), {
      ...payload,
    });
  },
  addReward: async ({ title, cost }) => {
    const { db } = getFirebase();
    await addDoc(collection(db, paths.rewards), {
      title: title.trim(),
      cost,
      active: true,
      sortOrder: (get().rewards.length + 1) * 10,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },
  updateReward: async (rewardId, patch) => {
    const { db } = getFirebase();
    await updateDoc(doc(db, paths.rewards, rewardId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  },
  addEarning: async ({ kidId, taskId, notes }) => {
    const { db } = getFirebase();
    const task = get().tasks.find((item) => item.id === taskId);
    const kid = get().kids.find((item) => item.id === kidId);
    if (!task) throw new Error("Task not found.");
    if (!kid) throw new Error("Kid not found.");
    const earnedTokens = tokensForTask(task.tokens, kid.pointMultiplier);

    const batch = writeBatch(db);
    const earningRef = doc(collection(db, paths.earnings));
    batch.set(earningRef, {
      kidId,
      taskId,
      taskTitle: task.title,
      tokens: earnedTokens,
      notes: cleanNote(notes),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, paths.kids, kidId), {
      bankedTokens: increment(earnedTokens),
      lifetimeEarned: increment(earnedTokens),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return earnedTokens;
  },
  addCustomEarning: async ({ kidId, title, tokens, notes }) => {
    const { db } = getFirebase();
    const kid = get().kids.find((item) => item.id === kidId);
    if (!kid) throw new Error("Kid not found.");
    const earnedTokens = tokens;

    const batch = writeBatch(db);
    const earningRef = doc(collection(db, paths.earnings));
    batch.set(earningRef, {
      kidId,
      taskId: "custom",
      taskTitle: title.trim(),
      tokens: earnedTokens,
      notes: cleanNote(notes),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, paths.kids, kidId), {
      bankedTokens: increment(earnedTokens),
      lifetimeEarned: increment(earnedTokens),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return earnedTokens;
  },
  deleteEarning: async (earningId) => {
    const { db } = getFirebase();
    const current = get().earnings.find((item) => item.id === earningId);
    if (!current) return;

    const batch = writeBatch(db);
    batch.delete(doc(db, paths.earnings, earningId));
    batch.update(doc(db, paths.kids, current.kidId), {
      bankedTokens: increment(-current.tokens),
      lifetimeEarned: increment(-current.tokens),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  },
  redeemReward: async ({ kidId, rewardId, notes }) => {
    const reward = get().rewards.find((item) => item.id === rewardId);
    const kid = get().kids.find((item) => item.id === kidId);
    if (!reward) throw new Error("Reward not found.");
    if (!kid) throw new Error("Kid not found.");
    if (kid.bankedTokens < reward.cost) throw new Error(`${kid.name} needs ${reward.cost - kid.bankedTokens} more tokens.`);

    const { db } = getFirebase();
    const batch = writeBatch(db);
    batch.set(doc(collection(db, paths.redemptions)), {
      kidId,
      rewardId,
      rewardTitle: reward.title,
      cost: reward.cost,
      notes: cleanNote(notes),
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, paths.kids, kidId), {
      bankedTokens: increment(-reward.cost),
      lifetimeRedeemed: increment(reward.cost),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return reward.cost;
  },
  deleteRedemption: async (redemptionId) => {
    const { db } = getFirebase();
    const current = get().redemptions.find((item) => item.id === redemptionId);
    if (!current) return;

    const batch = writeBatch(db);
    batch.delete(doc(db, paths.redemptions, redemptionId));
    batch.update(doc(db, paths.kids, current.kidId), {
      bankedTokens: increment(current.cost),
      lifetimeRedeemed: increment(-current.cost),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  },
}));
