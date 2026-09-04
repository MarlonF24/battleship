# Deployment guide

## Container topology

The production Compose file defines:

- PostgreSQL with a readiness healthcheck;
- one Elysia server that starts after PostgreSQL is healthy.

The multi-stage Dockerfile performs a frozen workspace install and builds the server bundle and Vite SPA. Pushes to `main` publish `ghcr.io/marlonf24/battleship:latest` plus a commit-specific tag for both AMD64 and ARM64; `v1.2.3`-style Git tags additionally publish semantic `1.2.3`, `1.2`, and `1` image tags. Pull requests build without publishing. The default Compose file pulls `latest` rather than building locally. The GHCR package must be made public after its first publication if unauthenticated users should be able to run Compose directly.

At container startup, the runtime runs `drizzle-kit push` without `--force`; the server starts only after schema synchronization succeeds. A destructive or ambiguous schema change therefore requires explicit operator handling rather than automatic approval. Elysia then serves the SPA while keeping `/api`, `/health`, and `/openapi` outside the history fallback.

## Single-replica requirement

Run exactly one server process/replica. Active aggregates, timers, sockets, and terminal board publication are process-local and deliberately undistributed. A load-balanced second process would not share sessions.

PostgreSQL stores enough information to report that a match ended, not enough to resume it. Startup marks every nonterminal row premature with reason `server_restart`; recovered hub matches receive one result-delivery attempt.

## Configuration

Use the canonical variables documented directly in `.env.example` and set `NODE_ENV=production`. Keep `CORS_ALLOWED_ORIGINS` empty when Elysia serves both the page and API; list only external browser origins that must call the API directly. Do not publish PostgreSQL outside its trusted network in production unless operations require it.

Hub integration is explicitly enabled or disabled. When enabled, set `HUB_BASE_URL` to the hub origin reachable by the Battleship container and `PUBLIC_BASE_URL` to the Battleship origin reachable by players' browsers. The hub backend calls the API over a trusted deployment network; `CORS_ALLOWED_ORIGINS` can remain empty because no cross-origin browser request is involved.

The regular Compose stack is reusable by the hub. Configure `.env`, then launch it once:

```bash
docker compose up
```

For a source checkout embedded directly in the hub repository, `docker-compose.hub.yml` instead provides a self-contained build with internal database settings. It requires `HUB_URL`, defaults to local browser access at `http://localhost:8001`, and accepts `PUBLIC_BASE_URL` for hosted routing. See the hub integration guide for the exact launch contract.

## Readiness and shutdown

`GET /health/live` proves the process can answer. `GET /health/ready` queries an application table, proving database access and schema readiness.

On shutdown, the server stops accepting work, closes sockets with a restart reason, cancels cleanup, and gives persistence a bounded drain. Any row that remains nonterminal is finalized during the next startup.

## Database operations

Deployments created with the former `match_seats.capability` column must run this statement once through the database provider before deploying an image that expects `seat_token`:

```sql
BEGIN;
ALTER TABLE match_seats RENAME COLUMN capability TO seat_token;
ALTER INDEX match_seats_capability_unique
  RENAME TO match_seats_seat_token_unique;
COMMIT;
```

Fresh databases already receive `seat_token` and must skip that statement.

Synchronize the configured database with the current Drizzle schema before server rollout:

```bash
bun run db:push
```

Container startup performs the same operation before launching Elysia. `drizzle-kit push` compares the live database with the declared schema and may require operator input for destructive changes, so resolve and back up the target before production deployment.

Before deploying this hub protocol over a database containing disposable provisional hub data, delete matches with `source = 'hub'` and then remove unreferenced `hub` players. Apply the schema synchronization afterward so the obsolete result-outbox table can be removed. Retain standalone matches and players.

```sql
BEGIN;
DELETE FROM matches WHERE source = 'hub';
DELETE FROM players
WHERE identity_source = 'hub'
  AND NOT EXISTS (
    SELECT 1 FROM match_seats WHERE match_seats.player_id = players.id
  );
COMMIT;
```

For a deliberate pre-cutover development reset only:

```bash
docker compose down --volumes
docker compose up
```

There is no automatic drop/reset switch or legacy-schema compatibility layer.
