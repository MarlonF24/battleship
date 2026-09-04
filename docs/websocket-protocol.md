# HTTP and WebSocket protocol

OpenAPI is served at `/openapi`. All JSON input schemas are strict: unknown properties and structurally invalid values are rejected.

## Standalone lifecycle

### Create a match

`POST /api/v1/matches`

```json
{
  "standalonePlayerId": "11111111-1111-4111-8111-111111111111",
  "mode": "singleShot",
  "opponent": "bot",
  "difficulty": "normal"
}
```

Human matches return:

```json
{
  "kind": "humanMatch",
  "matchId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "playerUrl": "/matches/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/player/22222222-2222-4222-8222-222222222222",
  "joinUrl": "/join/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "spectatorUrl": "/spectate/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

Computer matches require `difficulty` as `easy`, `normal`, or `hard`; human matches use `opponent: "human"` and do not accept that field. Bot responses use `kind: "botMatch"` and omit `joinUrl` entirely.

### Join a match

`POST /api/v1/matches/{matchId}/join`

```json
{
  "standalonePlayerId": "33333333-3333-4333-8333-333333333333"
}
```

The response contains `matchId`, that player's private `playerUrl`, and the public `spectatorUrl`. Repeating the request for the player already in seat two returns the same **Seat Token** URL. Expected conflicts are `already_participating`, `match_full`, and `match_closed`; a missing match returns `match_not_found`.

## Socket routes

Player:

```text
/api/v1/ws/player/{matchId}?seatToken={UUID}
```

Spectator:

```text
/api/v1/ws/spectator/{matchId}
```

The **Seat Token** resolves to one human seat. Unknown, bot, mismatched, or expired values close with code `1008`. Spectators have no query credential and may never send messages; sending one closes only that socket with `1008`.

## Player commands

Every command includes a request UUID.

```json
{
  "type": "ready",
  "requestId": "44444444-4444-4444-8444-444444444444",
  "fleet": [
    {
      "length": 5,
      "orientation": "horizontal",
      "headRow": 0,
      "headColumn": 0
    }
  ]
}
```

```json
{
  "type": "shoot",
  "requestId": "55555555-5555-4555-8555-555555555555",
  "row": 3,
  "column": 7
}
```

A semantically invalid command does not close the connection:

```json
{
  "type": "commandRejected",
  "requestId": "55555555-5555-4555-8555-555555555555",
  "code": "not_your_turn",
  "message": "Wait for your turn.",
  "revision": 12
}
```

Stable domain error codes are `already_ready`, `already_shot`, `fleet_adjacency`, `fleet_bounds`, `fleet_composition`, `fleet_overlap`, `invalid_coordinate`, `invalid_phase`, `invalid_placement`, `no_legal_target`, `not_ready`, and `not_your_turn`.

Structurally invalid socket payloads are protocol violations. Elysia's WebSocket validation rejects them rather than passing partially shaped data to the session.

## Complete projections

Every accepted command, automatic action, connection transition, or phase transition increments `revision` and publishes a complete projection. All projections include:

- `revision` and `serverTimeMs`;
- `matchId`, mode, and rules;
- ordered participant display names, kinds, readiness, and connectivity;
- viewer role.

Placement adds `placementDeadlineMs`. Opponent fleets are never included.

Battle adds `turnSeat`, `shotsRemaining`, `actionDeadlineMs`, the authoritative `lastShot`, and a role view. A player receives their complete own board plus the opponent's public cells, sunk ships, and impossible cells. A spectator receives two public boards. CSS is never relied upon to hide secret data.

Completed projections retain `lastShot` and add `winnerSeat` and `reason`. A player receives the player-safe final view. A connected spectator receives both complete final fleets. A match that ends before battle has `view: null` and `lastShot: null`.

Absolute deadlines may be null when no timer is relevant to the receiving role. Browser state replaces its projection atomically only when the revision is newer.

## Close behavior

Normal completion sends one terminal projection and then closes with code `1000`. A replaced player socket, invalid **Seat Token**, unavailable live session, or spectator protocol violation closes with `1008` and a safe reason. Graceful server shutdown closes live sockets with service-restart code `1012`; the browser retains the last projection and explains that active games are intentionally not resumed. Native WebSocket ping/pong and the server idle timeout provide liveness; there is no application heartbeat envelope.
