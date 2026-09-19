# Staines &rarr; Twickenham Trains

A fast, installable live-departures board for the South Western Railway route
between **Staines**, **Twickenham** and **London Waterloo**. Built as a
progressive web app (PWA) so it can be added to a phone home screen and opened
like a native app.

Live board on GitHub Pages, refreshed automatically every 30 minutes.

## Features

- **Next-train hero** &mdash; the one train you're most likely after, shown large:
  destination, departure time, live countdown, platform and status.
- **Live board** for any pair of the three stations, with a one-tap direction swap.
- **Rolling "next 90 minutes" default**, plus jump-to-hour and *arrive by* filters.
- **Countdown urgency** &mdash; green normally, amber under ~5 min, red (pulsing)
  under ~2 min, so time pressure is legible at a glance.
- **Tap a train** to expand its calling points on a small timeline.
- **Per-train alarms** with browser notifications (10 minutes before, and at departure)
  while the app is open.
- **Staleness indicator** &mdash; the board flags when its data is more than a few
  minutes old rather than always claiming to be live.
- **Native-style pull-to-refresh** on mobile, and a manual refresh button.
- **Installable PWA** with an offline-capable app shell.

## How it works

The app is deliberately simple to host: it reads a **static JSON snapshot**
rather than calling a live API from the browser.

1. A **GitHub Action** runs on every push to `main` and on a `*/30 * * * *`
   schedule. It fetches departures for all six station pairs from National Rail's
   live-info service and writes them to `public/data/departures.json`.
2. `vite build` bundles that snapshot into the deployed site, which is published
   to **GitHub Pages**.
3. In the browser the app polls the static snapshot every 30 seconds and updates
   countdowns every second. There is no server to run in production.

For local development an Express server (`server/index.js`) also exposes a live
`/api/departures` endpoint, which the app uses as a fallback if the snapshot
can't be loaded.

## Tech stack

- [React 18](https://react.dev/) + [Vite 5](https://vitejs.dev/)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (service worker + manifest)
- [Express](https://expressjs.com/) for the local dev API
- GitHub Actions + GitHub Pages for the scheduled build and hosting

## Getting started

Requires Node 20+.

```bash
npm install

# Dev: fetches a fresh snapshot, then runs the Vite app + the Express API together
npm run dev

# Production build (also refreshes the snapshot via the prebuild hook)
npm run build

# Serve the built app + API locally
npm run start
```

Other scripts:

```bash
npm run snapshot   # fetch a fresh departures.json only
npm run preview    # preview the production build
```

## Configuration

- **Stations** are defined in two places &mdash; keep them in sync if you change
  the route: `STATIONS` in `src/App.jsx` (the UI) and in
  `server/fetch-snapshot.mjs` (the data fetch).
- **Refresh cadence** is the `cron` schedule in `.github/workflows/deploy.yml`
  (default every 30 minutes). Lower it to `*/15` for fresher data.
- **In-app polling / countdown intervals** are the constants at the top of
  `src/App.jsx` (`REFRESH_MS`, `ROLLING_WINDOW_MS`).

## Deployment

Pushing to `main` triggers the Action, which builds the site (refreshing the
snapshot) and deploys it to GitHub Pages. Enable Pages for the repository with
the **GitHub Actions** source to use it.

## Data source

Departure data comes from National Rail's live-info service and is used here for
personal, non-commercial purposes. This project is not affiliated with, endorsed
by, or connected to National Rail or South Western Railway. Train times are
provided on a best-effort basis &mdash; always check official sources for
travel-critical decisions.

## License

Released under the [MIT License](LICENSE).
