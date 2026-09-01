# JustX Business Tools (JBT)

Multi-tenant business tools for quotations, site surveys, and more — by **JustXSystems**.

| | |
|--|--|
| **Production** | https://justxsystems.com/jbt/ |
| **Stack** | Next.js (web) · Express (API) · MySQL 8 |
| **Repo** | https://github.com/JustXSystems/JustxBusinessTools |

## Documentation map

| Goal | Document |
|------|----------|
| **This file** | Overview + local development |
| **Product setup** (OAuth, env, clients) | [`docs/SETUP.md`](docs/SETUP.md) |
| **Production deploy** (VPS + GitHub Actions + PM2) | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| **Production support** (on-call, runbooks, triage) | [`docs/PRODUCTION_SUPPORT.md`](docs/PRODUCTION_SUPPORT.md) |
| **Env template** | [`.env.example`](.env.example) → `server/.env` |
| **Mobile (Capacitor)** | [`docs/MOBILE.md`](docs/MOBILE.md) |
| Desktop UNC sync | [`desktop-sync-agent/README.md`](desktop-sync-agent/README.md) |

## Local development

```bash
cp .env.example server/.env
npm install
npm run db:up          # optional Docker MySQL
npm run db:setup       # schemas + seed
npm run dev
```

Open http://localhost:3000 (API on **4000** via proxy).

Do **not** set `WEB_BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` for local root UI.

## Production (short)

1. One-time VPS + nginx + `server/.env` + MySQL — [`docs/DEPLOY.md`](docs/DEPLOY.md) Part 1  
2. Add GitHub secrets → push to `master` (or run **Deploy** workflow) — Part 2  
3. Google OAuth once — [`docs/SETUP.md`](docs/SETUP.md)

Ports: web **3002** · API **4002**. Port **3001** is reserved for Zigma.

## Layout

```
web/       Next.js UI
server/    Express API
shared/    @jbt/shared
mysql/     SQL schemas
scripts/   vps-deploy.sh
.github/   Deploy workflow
```
