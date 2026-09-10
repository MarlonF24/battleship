FROM oven/bun:1.3.9-alpine AS dependencies

WORKDIR /app

# Workspace manifests are copied first so dependency installation remains cached.
COPY package.json bun.lock tsconfig*.json eslint.config.js .prettierrc.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-domain/package.json packages/game-domain/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS builder

# Build outputs contain the bundled server and the complete static SPA.
COPY apps ./apps
COPY packages ./packages
RUN bun run build

FROM dependencies AS runtime

ENV NODE_ENV=production
EXPOSE 8000

# The runtime includes the migration inputs used by the Compose migration job,
# followed by the bundled server and static frontend used by the server process.
COPY apps/server/drizzle.config.ts apps/server/drizzle.config.ts
COPY apps/server/src/config.ts apps/server/src/config.ts
COPY apps/server/src/db/schema.ts apps/server/src/db/schema.ts
COPY drizzle ./drizzle
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

CMD ["bun", "apps/server/dist/index.js"]
