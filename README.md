# Plant Tracker

A lightweight React app for tracking houseplant watering schedules. Live at [cing.net/plant-tracker](https://cing.net/plant-tracker).

## Features

- **Plant collection** — Add plants from a catalog of 15+ types (Pothos, Monstera, Snake Plant, Succulents, and more), each with a nickname and location
- **Watering schedules** — Tracks last watered date and calculates the next watering based on each plant's needs (2–21 day intervals)
- **Status indicators** — Color-coded urgency: Overdue, Today, Soon, and OK
- **One-click watering** — Mark a plant as watered instantly
- **Filter & sort** — Filter by watering urgency, sort by name, type, or urgency
- **Care tips** — Per-plant modal with difficulty level, light requirements, and tailored care advice
- **Persistent storage** — Plant data is saved to localStorage and restored on reload

## Tech Stack

- React 19 + Vite
- No CSS framework — custom styles only
- No backend — fully client-side with localStorage

## Getting Started

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Deployment

Deployed to GitHub Pages via GitHub Actions on every push to `main`. The workflow builds the app and publishes the `dist/` folder.
