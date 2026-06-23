# Shard

Self-hosted cloud storage on your own MongoDB Atlas clusters. A Google-Drive-like UI backed entirely by MongoDB — per-user M0 autoscaling, OAuth sign-in, GridFS file storage, and a first-run setup wizard.

## What Shard Is

Shard turns a free Atlas M0 cluster into a fully featured personal cloud drive. You own the data, you own the clusters. There is no Shard service, no account, no pricing tier.

Each user supplies their own Atlas org API key pair. Shard provisions free M0 clusters on their behalf as storage fills up (threshold: 80% of 512 MB). When one cluster nears capacity a new one is provisioned automatically. Files are stored as GridFS blobs, split across clusters if a single file exceeds remaining capacity.

The operator (the person running Shard) provides a single "starter" Atlas cluster that holds all metadata: user records, folder trees, shares, and public links. File bytes never touch the starter cluster.

## Architecture

| Layer | Stack |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Node 20 + Express + TypeScript + Mongoose 8 |
| Metadata DB | MongoDB Atlas (operator-supplied starter cluster) |
| File storage | MongoDB GridFS across per-user Atlas M0 fleet |
| Auth | Google / GitHub OAuth (Passport.js) + JWT session cookies + API keys |
| Autoscaling | Atlas Admin API (digest auth), M0 / TENANT / AWS / US_EAST_1 |

## Autoscaling model (M0)

Every user's files are stored in one or more free M0 clusters inside their own Atlas orgs:

- **Provision threshold:** 80% of 512 MB (≈ 409 MB stored)
- **Warn threshold:** 75%
- **Check interval:** 10 minutes
- **Keepalive:** 60 seconds
- **Org cap:** ~250 clusters per org; rolls to the user's next API key pair when full
- **Cluster spec:** M0, TENANT, AWS, US_EAST_1, REPLICASET

When `runStorageCheck` detects a cluster above the provision threshold, `provisionNextCluster` creates a new project + cluster, waits for it to be ready, creates a database user, whitelists the connection IP, builds the URI, and activates the new cluster. The old cluster stays online; new writes go to the new cluster.

## Setup

On first launch visit `/setup`. The setup wizard walks you through:

1. **Starter cluster** — paste a MongoDB Atlas URI; the wizard pings it to confirm connectivity. *(Skipped automatically when `STARTER_MONGODB_URI` is already set as an env var, e.g. on Vercel.)*
2. **OAuth providers** — enable Google and/or GitHub, paste Client ID + Client Secret. The wizard shows where to find these in the provider console.
3. **Site config** — your public URL and CORS allowed origins.
4. **Apply** — saves the configuration to the **database** (not a file) and activates the app immediately. No restart required.

All configuration except `STARTER_MONGODB_URI` lives in the starter database, so deployments stay stateless and portable.

The **first user** to sign in becomes **admin**. Access is governed by an admin toggle in **Settings → Access**:

- **Approval** (default) — new sign-ins land on an "awaiting approval" screen until an admin approves them (or pre-invites their email).
- **Open** — anyone who signs in with Google/GitHub gets immediate access.

> **OAuth redirect URI:** in your Google/GitHub OAuth app, set the callback to
> `https://<your-domain>/api/auth/google/callback` and `https://<your-domain>/api/auth/github/callback`.

## Installation

You need one free **MongoDB Atlas M0 cluster** to act as the *starter* (metadata) store. Create it, add a database user, and set Network Access to allow your host (`0.0.0.0/0` for a serverless/remote deploy). Its connection string is your `STARTER_MONGODB_URI`. Everything else is entered through the in-app setup wizard.

### Option A — Deploy on Vercel (one click)

1. Push/import this repo into Vercel (**vercel.com/new** → import the repo). `vercel.json` configures the build, the API serverless function, SPA routing, and cron.
2. In **Project → Settings → Environment Variables**, add:
   - `STARTER_MONGODB_URI` — your Atlas starter connection string *(required)*
   - `CRON_SECRET` — any random string, used to authorize the maintenance cron *(recommended)*
   - `COOKIE_SECURE` = `true` *(Vercel serves HTTPS)*
3. Deploy. Open the deployment URL → the wizard skips the starter step (it's the env var) and asks only for OAuth + site config.
4. Set your OAuth app callback to `https://<your-vercel-domain>/api/auth/<provider>/callback`.

Or via CLI:

```bash
vercel link
vercel env add STARTER_MONGODB_URI production
vercel --prod
```

> **Note:** cluster auto-provisioning runs inline during uploads (Atlas M0 comes up in seconds). The cron jobs only do periodic cleanup/stats; the Vercel **Hobby** plan limits cron to once daily (upgrade to Pro for more frequent maintenance).

### Option B — Docker (self-hosted: Pi, VPS, homelab)

```bash
git clone https://github.com/jasonzli-DEV/Shard
cd Shard
cp .env.example .env
# Set STARTER_MONGODB_URI (+ optional JWT_SECRET, COOKIE_SECURE). Everything
# else is configured through the setup wizard.

docker compose up -d
# Backend  → :4000        Frontend → :80 (nginx serves the build, proxies /api)
```

Open `http://<host>` and complete the wizard. To enable HTTPS, put a reverse proxy in front and set `COOKIE_SECURE=true`.

### Option C — Local development

```bash
git clone https://github.com/jasonzli-DEV/Shard
cd Shard
cp .env.example .env          # set STARTER_MONGODB_URI (or leave blank for setup mode)
npm install
npm run dev                   # backend :4000 + frontend :5173 concurrently
```

## Testing

```bash
cd backend && npm test       # Jest + supertest + mongodb-memory-server
cd frontend && npm test      # Vitest + @testing-library/react
```

## Environment variables

Only `STARTER_MONGODB_URI` is required as an env var. Everything else is set through the setup wizard and stored in the database (env values, where present, act as fallbacks/overrides).

| Variable | Required | Description |
|---|---|---|
| `STARTER_MONGODB_URI` | **Yes** | Atlas URI for the starter (metadata) cluster — the one bootstrap value |
| `CRON_SECRET` | Recommended | Authorizes `/api/cron/*` maintenance endpoints (Vercel Cron) |
| `COOKIE_SECURE` | No | `true` when served over HTTPS (set this on Vercel / behind TLS); default `false` |
| `JWT_SECRET` | No | Auto-generated and stored in the DB if absent |
| `PORT` | No | Backend port (default 4000; ignored on serverless) |
| `SERVERLESS` | No | Set to `1` on Vercel (via `vercel.json`) to disable in-process background loops |

Configured **through the wizard → stored in the DB:** OAuth client IDs/secrets (Google and/or GitHub — at least one), public URL, allowed origins, and the access mode. They can also be supplied as env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PUBLIC_URL`, `ALLOWED_ORIGINS`) as a fallback.

## Structure

```
shard/
├── backend/
│   └── src/
│       ├── auth/       JWT, sessions, OAuth (Passport)
│       ├── atlas/      Atlas Admin API client (digest auth)
│       ├── storage/    Cluster manager, autoscaler, GridFS service
│       ├── models/     Mongoose schemas
│       ├── routes/     Express routers (setup, auth, files, shares, ...)
│       ├── middleware/ requireAuth (session cookie + API key)
│       └── utils/      Logger, crypto (AES-256-GCM), paths
├── frontend/
│   └── src/
│       ├── api/        Axios client + per-resource helpers
│       ├── components/ Drive UI, dialogs, ShardMark, setup Stepper, ...
│       ├── pages/      Setup, Login, Drive, Trash, Starred, Search, ...
│       ├── context/    AuthContext
│       └── styles/     theme.css (design tokens), global.css
├── docker-compose.yml
└── .env.example
```

## Design

Shard uses a mineral / crystal visual identity. The UI is built on a sharp, angular design system — no pill buttons, no gradient cards, no rounded panels. The signature element is the `ShardMark`: a three-faced SVG crystal with distinct shadow, mid, and lit polygon faces. One accent color: Shard blue `#4A90D9`. Typography: DM Serif Display for headings, Inter for body, JetBrains Mono for metadata and inputs.
