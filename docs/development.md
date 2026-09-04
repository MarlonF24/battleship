# Development guide

## Environment

Copy `.env.example` to `.env`. Server configuration accepts one canonical shape and no aliases.

Application fields:

- `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_PORT`, `DB_SSL`;
- `SERVER_PORT`, `VITE_PORT` (both optional and defaulted);
- `CORS_ALLOWED_ORIGINS`;
- `LOG_LEVEL`, `NODE_ENV`;
- `HUB_ENABLED`, `HUB_BASE_URL`, `PUBLIC_BASE_URL`.

`CORS_ALLOWED_ORIGINS` is empty for the normal same-origin deployment and accepts comma-separated external browser origins when needed. `DB_PORT` is both the PostgreSQL container port and its published host port. `HUB_ENABLED=false` requires both hub URL fields to be empty; `HUB_ENABLED=true` requires both. `HUB_BASE_URL` is server-to-server, while `PUBLIC_BASE_URL` supplies browser-reachable links returned to the hub.

The server selects only known keys before strict validation, so unrelated shell variables are not treated as configuration. No application module reads `Bun.env` after startup. Drizzle and the server call the same five-field database URL decoder.

## Commands

```bash
bun install --frozen-lockfile
bun run db:push
bun run dev
bun run dev:server
bun run dev:web
bun run check
```

Development uses the PostgreSQL instance already running on `DB_HOST` and `DB_PORT`; no development command starts a database. `db:push` explicitly synchronizes that local database with `apps/server/src/db/schema.ts`. The root `dev` command only starts the server watcher and Vite, so ordinary source changes neither start containers nor alter the schema.

Open `http://localhost:<VITE_PORT>` for the Vite application. The production server serves the built SPA and its deep routes from `SERVER_PORT` instead.

### What runs

- `bun dev` starts two watched development processes: Elysia on `SERVER_PORT` and Vite on `VITE_PORT`.
- Vite proxies relative `/api` and WebSocket requests to Elysia at `http://localhost:<SERVER_PORT>`; returned application links remain relative and therefore stay on the Vite origin.
- Starting only Vite renders the page, but games cannot connect unless the backend and your local PostgreSQL service are also running.
- The production image runs one Bun process. Elysia serves the API, WebSockets, built frontend files, and the React Router fallback. There is no second frontend server in that image.
- `docker compose up` is a separate deployment path: Compose pulls the published GHCR image, starts PostgreSQL, then lets the application container synchronize the schema before starting Elysia.

Run `db:push` after editing the Drizzle schema or creating a fresh database. The watched development server deliberately fails when PostgreSQL is unavailable or its required tables are absent; unlike the deployment container, it never starts PostgreSQL or changes its schema.

## TypeScript and editor checks

The strict base configuration enables unchecked-index protection, exact optional properties, explicit overrides/returns, fallthrough detection, unknown catch values, and verbatim module syntax. `bun run typecheck` invokes the TypeScript 7 native compiler. ESLint uses type-aware strict/stylistic rules, React Hooks, and JSX accessibility with zero warnings.

VS Code uses the native TypeScript service through `typescript.experimental.useTsgo`. Install the ESLint and Prettier extensions to receive the same feedback as CI.

## Testing

```bash
bun run test
bun run test:coverage
bun run test:e2e
```

Domain tests cover fleet invariants, arbitrary legal sequences, and the custom PDF agent. Server tests use deterministic clocks, schedulers, random sources, and capture sockets. Browser tests cover the responsive no-scroll layout, touch Pointer Events, and live bot sessions. The suite deliberately concentrates on project-owned rules and boundaries rather than retesting framework behavior.

If the host lacks browser system libraries, run Playwright in the matching image while the Compose application is running:

```bash
docker run --rm --network host \
  --volume "$PWD:/work" --workdir /work \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  npx playwright test
```

## Debugging multiple roles

Use separate browser contexts or profiles so each context can hold a different anonymous UUID. Create a human match, open the join path in the second context, and open `/spectate/{matchId}` in any number of additional contexts. Player URLs contain private **Seat Tokens**; the plain match ID is intentionally shareable for spectators.

The browser never reconstructs accepted gameplay. Debug live discrepancies by comparing the latest WebSocket projection revision with server session logs and the role privacy rules in the protocol document.
