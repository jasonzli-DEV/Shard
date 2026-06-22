# Shard

Self-hosted, MongoDB-backed cloud storage with a Google-Drive-like UI.

## Architecture

- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Node 20 + Express + TypeScript + Mongoose
- **Database:** MongoDB Atlas (starter cluster for metadata; per-user M0 clusters for file bytes via GridFS)
- **Auth:** Google / GitHub OAuth via Passport.js + JWT session cookies + API keys
- **Storage:** GridFS across auto-provisioned per-user Atlas M0 clusters (autoscales at 80% of 512 MB)

## Quick Start (development)

```bash
cp .env.example .env
# Fill in STARTER_MONGODB_URI, JWT_SECRET, OAuth credentials, etc.

npm install
npm run dev        # starts backend (port 4000) + frontend (port 5173) concurrently
```

## Production (Docker Compose)

```bash
cp .env.example .env
# Fill in all values

docker compose up -d
# Backend → http://localhost:4000
# Frontend → http://localhost:80
```

On first launch, visit `/setup` to complete the configuration wizard.

## Testing

```bash
cd backend && npm test       # Jest + ts-jest + mongodb-memory-server
cd frontend && npm test      # Vitest
```

## Environment Variables

See `.env.example` for all required and optional variables.

## Structure

```
shard/
├── backend/          Express + Mongoose API
│   ├── src/
│   │   ├── lib/      DB connection
│   │   ├── models/   Mongoose schemas
│   │   ├── routes/   Express routers
│   │   ├── auth/     JWT, sessions, OAuth
│   │   ├── storage/  GridFS, cluster manager, autoscaler
│   │   ├── utils/    Logger, crypto, paths
│   │   └── index.ts  App entrypoint
│   └── Dockerfile
├── frontend/         React + Vite UI
│   ├── src/
│   └── Dockerfile
├── docker-compose.yml
└── .env.example
```
