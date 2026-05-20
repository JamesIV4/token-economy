# Summer Token Economy

A Vite + React + Zustand PWA for tracking summer token tasks, physical bank totals, and reward redemptions in Google Firestore.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add Firebase config:

   ```bash
   Copy-Item .env.local.example .env.local
   ```

   Fill in the values from Firebase project settings for `token-economy-b08ac`.

3. Run locally:

   ```bash
   npm run dev
   ```

## Firestore Collections

This follows the same nested collection style as the pinball app:

- `data/kids/kids`
- `data/tasks/tasks`
- `data/rewards/rewards`
- `data/earnings/earnings`
- `data/redemptions/redemptions`

Starter tasks and rewards seed automatically when those collections are empty.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the PWA with the `/token-economy/` base path and publishes `dist`.
