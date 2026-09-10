# Deployment guide

## Container topology

The production Compose file defines:

- PostgreSQL with a readiness healthcheck;
- a one-shot migration job that starts after PostgreSQL is healthy;
- one Elysia server that starts after all migrations succeed.

The multi-stage Dockerfile performs a frozen workspace install and builds the server bundle and Vite SPA. Pushes to `main` publish `ghcr.io/marlonf24/battleship:latest` plus a commit-specific tag for both AMD64 and ARM64; `v1.2.3`-style Git tags additionally publish semantic `1.2.3`, `1.2`, and `1` image tags. Pull requests build without publishing. The default Compose file pulls `latest` rather than building locally. The GHCR package must be made public after its first publication if unauthenticated users should be able to run Compose directly.

The Docker image starts only Elysia. Compose overrides the same image's command for the migration job, so database changes remain a deployment concern and the application process never mutates its schema. Elysia serves the SPA while keeping `/api`, `/health`, and `/openapi` outside the history fallback.

## Single-replica requirement

Run exactly one server process/replica. Active aggregates, timers, sockets, and terminal board publication are process-local and deliberately undistributed. A load-balanced second process would not share sessions.

PostgreSQL stores enough information to report that a match ended, not enough to resume it. Startup marks every nonterminal row premature with reason `server_restart`; recovered hub matches receive one result-delivery attempt.

## Configuration

Use the canonical variables documented directly in `.env.example` and set `NODE_ENV=production`. Keep `CORS_ALLOWED_ORIGINS` empty when Elysia serves both the page and API; list only external browser origins that must call the API directly. Do not publish PostgreSQL outside its trusted network in production unless operations require it.

Leave both hub URLs empty to disable integration. To enable it, set `HUB_BASE_URL` to the hub origin reachable by the Battleship container and `PUBLIC_BASE_URL` to the Battleship origin reachable by players' browsers. A partial pair fails startup validation. The hub backend calls the API over a trusted deployment network; `CORS_ALLOWED_ORIGINS` can remain empty because no cross-origin browser request is involved.

Configure `.env`, then launch the standalone stack once:

```bash
docker compose up
```

The Game Night repository has its own top-level Compose file. It runs this image, a dedicated PostgreSQL service, and the same one-shot migration command while supplying the hub's internal and browser-facing origins.

## Readiness and shutdown

`GET /health/live` proves the process can answer. `GET /health/ready` queries an application table, proving database access and schema readiness.

On shutdown, the server stops accepting work, closes sockets with a restart reason, cancels cleanup, and gives persistence a bounded drain. Any row that remains nonterminal is finalized during the next startup.

## Database operations

Generate and inspect a migration whenever `apps/server/src/db/schema.ts` changes:

```bash
bun run db:generate
```

Commit the generated SQL and metadata in `drizzle/`. Compose runs `bun run db:migrate` once per startup; Drizzle records applied migrations and executes only pending files. A failed migration prevents the server from starting.

`bun run db:push` remains available for disposable development databases. It is not used by the image or Compose because schema pushes can require interactive decisions and `--force` could approve destructive changes.

The initial migration expects a fresh database. Databases created earlier with `db:push` have no migration journal and should be explicitly recreated or baselined by an operator before adopting this deployment flow. To discard the local Compose database:

```bash
docker compose down --volumes
docker compose up
```

There is no automatic drop/reset switch or legacy-schema compatibility layer.
