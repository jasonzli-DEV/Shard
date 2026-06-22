FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Install ALL deps (including devDeps such as typescript) for the build step.
# npm install (not ci) because this is an npm-workspaces monorepo — the
# lockfile lives at the repo root, not in this per-package build context.
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

RUN addgroup -S shard && adduser -S shard -G shard

COPY --from=builder /app/package*.json ./
# Production-only deps in the final image
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p logs && chown -R shard:shard /app

USER shard

EXPOSE 4000

CMD ["node", "dist/index.js"]
