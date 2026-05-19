import type { Reward, TokenTask } from "../types";

export const kidColors = ["#1f9d8a", "#f97316", "#3b82f6", "#d946ef", "#84cc16", "#ef4444"];

export const starterTasks: Array<Omit<TokenTask, "createdAt" | "updatedAt">> = [
  {
    id: "get-dressed-without-being-told",
    title: "Get dressed without being told",
    tokens: 4,
    active: true,
    sortOrder: 10,
  },
  {
    id: "brush-hair-on-your-own",
    title: "Brush your hair on your own",
    tokens: 1,
    active: true,
    sortOrder: 20,
  },
  {
    id: "read-for-20-minutes",
    title: "Read for 20 minutes",
    tokens: 5,
    active: true,
    sortOrder: 30,
  },
  {
    id: "make-your-bed",
    title: "Make your bed",
    tokens: 2,
    active: true,
    sortOrder: 40,
  },
  {
    id: "brush-your-teeth",
    title: "Brush your teeth",
    tokens: 3,
    active: true,
    sortOrder: 50,
  },
  {
    id: "set-the-table",
    title: "Set the table",
    tokens: 2,
    active: true,
    sortOrder: 60,
  },
  {
    id: "nice-for-sibling",
    title: "Do something nice for a sibling",
    tokens: 3,
    active: true,
    sortOrder: 70,
  },
  {
    id: "pjs-without-being-told",
    title: "Put on PJs without being told",
    tokens: 4,
    active: true,
    sortOrder: 80,
  },
  {
    id: "kind-to-sibling",
    title: "Say something kind to a sibling",
    tokens: 1,
    active: true,
    sortOrder: 90,
    maxPerDay: 10,
  },
];

export const starterRewards: Array<Omit<Reward, "createdAt" | "updatedAt">> = [
  {
    id: "screen-time-30",
    title: "30 minutes of screen time",
    cost: 12,
    active: true,
    sortOrder: 10,
  },
  {
    id: "treasure-chest",
    title: "Visit treasure chest",
    cost: 12,
    active: true,
    sortOrder: 20,
  },
  {
    id: "stevie-bs-trip",
    title: "Trip to Stevie B's",
    cost: 100,
    active: true,
    sortOrder: 30,
  },
  {
    id: "ten-dollar-toy",
    title: "$10 toy",
    cost: 65,
    active: true,
    sortOrder: 40,
  },
  {
    id: "piece-of-candy",
    title: "Piece of candy",
    cost: 5,
    active: true,
    sortOrder: 50,
  },
  {
    id: "pizza-dinner",
    title: "Pizza dinner",
    cost: 75,
    active: true,
    sortOrder: 60,
  },
  {
    id: "stay-up-20",
    title: "Stay up 20 minutes past bedtime with mom and dad",
    cost: 12,
    active: true,
    sortOrder: 70,
  },
  {
    id: "dad-plays-your-game",
    title: "Dad plays your game with you for 20 minutes",
    cost: 12,
    active: true,
    sortOrder: 80,
  },
];
