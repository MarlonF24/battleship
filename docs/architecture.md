# Architecture and state ownership

## System boundaries

`packages/game-domain` is browser-safe, synchronous, and framework-free. It owns legal fleets, shot resolution, mode policy, public knowledge, random placement, and PDF targeting. It knows only whether a seat is `human`, `bot`, or `open`; identity and access never enter the rules package.

`packages/contracts` owns strict JSON schemas. Elysia validates untrusted HTTP and WebSocket input with these TypeBox schemas, and TypeScript types are inferred from the same definitions. Contract objects reject additional properties.

`apps/server` owns orchestration and durability. A `MatchSession` serializes every command, timer, connection transition, and bot action around one synchronous `Match` aggregate. Drizzle repositories store identity and result metadata; they never store boards.

`apps/web` owns only the local unsubmitted fleet and the latest role-filtered server projection. MobX state stays outside React rendering and outside domain models.

## State ownership

| Concern                                         | Sole owner                                    |
| ----------------------------------------------- | --------------------------------------------- |
| Classic rules and mode transitions              | `game-domain`                                 |
| Editable, unsubmitted fleet                     | Browser `PlacementDraftStore`                 |
| Provisional drag clone and suggestion           | Browser `PlacementDragSession`                |
| Accepted fleets, shots, turn, outcome           | Server `Match` aggregate                      |
| Connections, deadlines, bot pacing, publication | Server `MatchSession`                         |
| Live privacy filtering                          | Server projection builders                    |
| Rendered live state                             | Browser `MatchSessionStore` latest projection |
| Identity, participants, terminal metadata       | PostgreSQL through Drizzle                    |
| Hub result delivery                             | One-shot server-to-server reporter            |
| Elo and rankings                                | External game hub                             |

The browser validates draft placement previews with the shared semantic fleet validator because that state is still editable. It never calculates an accepted hit, sink, impossible cell, deadline action, turn, or result.

## Request and live-data flow

1. A standalone or hub controller validates JSON input.
2. `MatchService` normalizes seat requests, resolves durable identities, creates **Seat Tokens**, commits metadata, and registers one in-memory session.
3. A player connects with the **Seat Token** from their private URL. A spectator connects with only the public match ID.
4. Elysia validates player commands before `MatchSession` serializes them.
5. The aggregate accepts or rejects the semantic command synchronously.
6. An accepted transition increments the revision and publishes a complete role-specific projection. A rejected command returns `commandRejected` without mutation.
7. Terminal metadata commits before the terminal projection is published and sockets close normally. Hub matches then trigger one asynchronous result request.

Complete projections avoid frontend event replay and recovery logic. A newer revision atomically replaces the prior browser value; older or duplicate revisions are ignored.

Eden Treaty derives both lifecycle requests and live socket paths from the composed Elysia `App` type. The browser therefore does not assemble API/WebSocket URLs or manually parse JSON messages; the route plugins form the typed server source of truth.

## Identities and seat tokens

A `players` row has an internal UUID plus `(identity_source, external_id)`. The unique pair keeps anonymous browser UUIDs and hub UUIDs separate even when their text is identical. Human `match_seats` rows reference that internal player and contain a unique match-scoped **Seat Token**. Bot rows contain neither.

Ordinary projections contain participant display names, kinds, readiness, connectivity, and seat numbers. They contain no player UUID or **Seat Token**. Hub result payloads recover participant UUIDs from persisted match metadata, never from live authority.

## In-memory lifecycle

The registry contains one session per live match and one server process contains the registry. The database is not a session cache. At startup, nonterminal rows are completed with `server_restart`; no aggregate is reconstructed.

Placement sessions expire after ten minutes without meaningful activity and battle sessions after thirty-five minutes. Cleanup uses `updated_at`/last activity, not creation time. Completion removes the session after publishing one terminal projection. Browsers retain that projection locally for final review.

## Persistence boundary

PostgreSQL stores:

- namespaced players;
- matches, source, mode, phase, timestamps, and terminal result;
- human/bot seats, player references, seat tokens, bot difficulties, and outcomes;
- the normalized hub match definition needed for idempotency and result reporting.

It does not store fleets, cells, shots, deadlines, WebSocket connections, spectators, or the aggregate.
