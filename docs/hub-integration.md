# Game-hub integration

The hub creates Battleship matches and receives terminal results. It owns player accounts, Elo, rankings, and the policy for bot games. Battleship runs as one persistent service and can host many concurrent matches.

A **Hub Player** is the UUID supplied by the hub. Reusing a human UUID attributes later matches to the same namespaced database identity. A **Seat Token** is the separate match-specific secret embedded in a human controller link; possessing that link grants control of its seat. Hub links neither read nor change the browser's standalone identity.

Enable the integration with:

```dotenv
HUB_ENABLED=true
HUB_BASE_URL=http://hub:8000
PUBLIC_BASE_URL=https://battleship.example
```

`HUB_BASE_URL` is the origin Battleship can reach from its server container. `PUBLIC_BASE_URL` is the browser-reachable Battleship origin used in returned links. Both must be HTTP(S) origins without paths, query strings, or fragments. The protocol has no authentication; deploy the creation endpoint on a trusted network.

Interactive API documentation is available at `/openapi`. Client generators can consume `/openapi/json`; the UUID-keyed participant fields are represented as map-like properties in generated clients.

## Create a match

The hub calls `POST /api/v1/hub/matches`:

```json
{
  "room_uuid": "2743318a-41e2-4d56-bdbb-0035184d24fd",
  "ea0a1a11-56ae-4042-9547-eb1bf4757f70": {
    "name": "Alice",
    "difficulty": "player"
  },
  "01f7113e-f768-4bf4-ab58-f21483ca5cd7": {
    "name": "Bot",
    "difficulty": "normal"
  },
  "config": {
    "mode": "salvo"
  }
}
```

Exactly two UUID-keyed participants are required, with at least one `player`. Their property order assigns seats; the first participant receives seat one and starts. Supported difficulties are `player`, `easy`, `normal`, and `hard`. Supported modes are `singleShot`, `salvo`, and `streak`; omitting `config.mode` selects `singleShot`.

Names are bounded per-match display labels. Human UUIDs are stored in the `hub` identity namespace. Bot UUIDs remain in match metadata so both participants can be identified in the result.

A successful request returns HTTP 200:

```json
{
  "room_uuid": "2743318a-41e2-4d56-bdbb-0035184d24fd",
  "ea0a1a11-56ae-4042-9547-eb1bf4757f70": {
    "controller_link": "https://battleship.example/matches/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/player/cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  },
  "01f7113e-f768-4bf4-ab58-f21483ca5cd7": {
    "controller_link": ""
  },
  "config": {
    "spectator_link": "https://battleship.example/spectate/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  }
}
```

Human controller links contain private **Seat Tokens**. Bot links are empty. The spectator link contains only the shareable internal match ID.

`room_uuid` is the idempotency key. Replaying the same normalized input returns the original links and **Seat Tokens** with HTTP 200. Omitted mode and explicit `singleShot` are equivalent. Changing participant UUIDs, order, names, difficulties, or mode returns `409 hub_match_conflict`.

## Result delivery

After persisting a terminal match and publishing its final browser projection, Battleship makes one asynchronous POST to `{HUB_BASE_URL}/api/result/battleship`:

```json
{
  "room_uuid": "2743318a-41e2-4d56-bdbb-0035184d24fd",
  "ea0a1a11-56ae-4042-9547-eb1bf4757f70": {
    "outcome": "win"
  },
  "01f7113e-f768-4bf4-ab58-f21483ca5cd7": {
    "outcome": "loss"
  },
  "config": {}
}
```

Outcomes are `win`, `loss`, or `premature`. A premature match reports `premature` for both participants. The request includes no bearer token, browser identity, or **Seat Token**. Delivery is attempted once; a rejected response or network failure is logged and not retried. Startup recovery makes the same single attempt for hub matches finalized as `server_restart`.

Bot targeting maps `easy` to uniform random shots, `normal` to bounded probability-density sampling, and `hard` to exhaustive probability-density scoring. Standalone computer games use `hard`.

## Hub deployment contract

The repository contains two deployment paths:

- `Dockerfile` builds the complete service. One Bun process serves the API, WebSockets, and compiled React application on container port `8000`.
- `docker-compose.hub.yml` builds that image, starts its private PostgreSQL service, and keeps both processes running for many rooms. For local integration it publishes Battleship at `127.0.0.1:8001`.

Run the hub stack from the repository root:

```bash
HUB_URL=http://host.docker.internal:8000 docker compose -f docker-compose.hub.yml up --build
```

The Compose adapter accepts these deployment inputs:

| Input                  | Meaning                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `HUB_URL`              | Required hub origin reachable from the Battleship container. It becomes the application's `HUB_BASE_URL`.                                       |
| `PUBLIC_BASE_URL`      | Browser-reachable Battleship origin. It defaults to `http://localhost:8001` for local integration and must be supplied for a hosted deployment. |
| `BATTLESHIP_HOST_PORT` | Optional local published port; defaults to `8001`. If changed, set a matching `PUBLIC_BASE_URL`.                                                |

The hub's existing per-room launcher cannot be used unchanged:

- `ROOM_UUID` is not an environment variable. Each room UUID arrives in one create-match request.
- `PUBLIC_HUB_URL` is not used. It names the public hub, whereas returned controller links require the public Battleship origin.
- Battleship exposes one container port (`8000`) for spectator pages, controller pages, HTTP, and WebSockets. It does not need separate spectator and controller ports.
- The Compose stack is launched once and reused. Per-room `docker run --rm` would discard live sessions and database continuity.

The hub's Compose branch therefore needs to start this stack once, supply its internal hub URL and public Battleship URL, then call `POST /api/v1/hub/matches` for each room.
