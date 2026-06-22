FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# npm install (not ci): workspaces monorepo, lockfile is at the repo root.
RUN npm install

COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

RUN npm run build

FROM nginx:alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
