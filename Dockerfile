# ── Build stage ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Tools for native modules (better-sqlite3) if no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/prisma.config.ts
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ───────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_URL=file:./data/smart-mis.db \
    UPLOAD_DIR=./uploads \
    BACKUP_DIR=./backups
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/prisma ./server/prisma
COPY --from=build --chown=node:node /app/client/dist ./client/dist

RUN mkdir -p /app/server/data /app/server/uploads /app/server/backups && chown -R node:node /app/server
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
